"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { cn } from "@/app/lib/utils";

/* ---------- ECharts ---------- */
function Chart({ option, height = 320 }: { option: any; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, null, { renderer: "canvas" });
    const onR = () => inst.current && inst.current.resize();
    window.addEventListener("resize", onR);
    return () => { window.removeEventListener("resize", onR); if (inst.current) inst.current.dispose(); };
  }, []);
  useEffect(() => { if (inst.current && option) inst.current.setOption(option, true); }, [option]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

const ANIM = { animationDuration: 600, animationEasing: "cubicOut" as const };
const short = (ep: string) => ep.replace(/^(admin|portal)_/, "");

function num(x: any, d = 0, s = "") {
  return x === undefined || x === null || isNaN(x) ? "—" : Number(x).toFixed(d) + s;
}
function bOverA(a: any, b: any) {
  if (!a || !b) return null;
  return (b / a) * 100;
}
function RateBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="l2num text-muted-foreground">—</span>;
  return (
    <span className={cn("l2num inline-block rounded-md px-2 py-0.5 text-xs font-semibold",
      v >= 100 ? "bg-emerald-600/10 text-emerald-600 dark:text-emerald-500"
               : "bg-red-600/10 text-red-600 dark:text-red-500")}>
      {v.toFixed(1)}%
    </span>
  );
}

const SECTIONS = [["smoke", "冒烟健康"], ["read", "读接口"], ["write", "写测试"], ["resource", "资源"]];

export default function SuitesPage() {
  const [suites, setSuites] = useState<any[]>([]);
  const [keyA, setKeyA] = useState("");
  const [keyB, setKeyB] = useState("");
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState("smoke");

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const d = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    fetch("api/suites").then((r) => r.json()).then((list: any[]) => {
      list.sort((x, y) => String(x.key).localeCompare(String(y.key)));
      setSuites(list);
      const lastA = [...list].reverse().find((s) => s.key.endsWith("abA"));
      const lastB = [...list].reverse().find((s) => s.key.endsWith("abB"));
      if (lastA) setKeyA(lastA.key);
      if (lastB) setKeyB(lastB.key);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-30% 0px -60% 0px" }
    );
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  const toggleTheme = () => {
    const nd = !dark;
    setDark(nd);
    document.documentElement.classList.toggle("dark", nd);
    localStorage.setItem("theme", nd ? "dark" : "light");
  };

  const A = useMemo(() => suites.find((s) => s.key === keyA), [suites, keyA]);
  const B = useMemo(() => suites.find((s) => s.key === keyB), [suites, keyB]);

  const pal = dark
    ? { a: "#64748b", b: "#60a5fa", grid: "rgba(255,255,255,0.07)", txt: "#a3a3a3" }
    : { a: "#94a3b8", b: "#2563eb", grid: "rgba(0,0,0,0.06)", txt: "#6b7280" };
  const axis = {
    axisLine: { lineStyle: { color: pal.grid } }, axisLabel: { color: pal.txt },
    splitLine: { lineStyle: { color: pal.grid } }, nameTextStyle: { color: pal.txt },
  };
  const catAxis = (labels: string[], name: string) => ({
    type: "category" as const, data: labels, name, ...axis,
    axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0, fontSize: 10 },
  });
  const valAxis = (name: string) => ({ type: "value" as const, name, ...axis });
  const pairBars = (labels: string[], aData: any[], bData: any[], yName: string, fmt?: (v: any) => string) => ({
    ...ANIM,
    tooltip: { trigger: "axis", valueFormatter: fmt },
    legend: { top: 0, textStyle: { color: pal.txt } },
    grid: { left: 56, right: 16, top: 40, bottom: 86 },
    xAxis: catAxis(labels, ""),
    yAxis: valAxis(yName),
    series: [
      { name: "A", type: "bar", barMaxWidth: 20, itemStyle: { color: pal.a }, data: aData },
      { name: "B", type: "bar", barMaxWidth: 20, itemStyle: { color: pal.b }, data: bData },
    ],
  });

  const eps = useMemo(() => {
    const set = new Set<string>();
    A?.read?.forEach((r: any) => set.add(r.api));
    B?.read?.forEach((r: any) => set.add(r.api));
    return Array.from(set);
  }, [A, B]);
  const getRead = (s: any, ep: string) => s?.read?.find((r: any) => r.api === ep);
  const broken = (s: any, ep: string) => {
    const r = getRead(s, ep);
    const sm = s?.smoke?.find((x: any) => x.api === ep && x.verdict !== "OK");
    return !!sm || (r?.err_med ?? 0) >= 5;
  };

  const okTps = (s: any, ep: string) => {
    const r = getRead(s, ep);
    return r ? (r.tps_ok_med ?? r.tps_med) : null;
  };
  const tpsChart = useMemo(() => (eps.length ? pairBars(
    eps.map(short),
    eps.map((ep) => okTps(A, ep)),
    eps.map((ep) => okTps(B, ep)),
    "有效TPS 中位", (v: any) => `${v} TPS`) : null), [eps, A, B, dark]);
  const p50Chart = useMemo(() => (eps.length ? pairBars(
    eps.map(short),
    eps.map((ep) => getRead(A, ep)?.p50_ok_med ?? null),
    eps.map((ep) => getRead(B, ep)?.p50_ok_med ?? null),
    "P50 ms(成功样本)", (v: any) => `${v} ms`) : null), [eps, A, B, dark]);
  const errChart = useMemo(() => (eps.length ? pairBars(
    eps.map(short),
    eps.map((ep) => getRead(A, ep)?.err_med ?? null),
    eps.map((ep) => getRead(B, ep)?.err_med ?? null),
    "错误率 %", (v: any) => `${v}%`) : null), [eps, A, B, dark]);

  const SVCS = useMemo(() => Object.keys(A?.resources || B?.resources || {}).sort(), [A, B]);

  const containers = useMemo(() => {
    const set = new Set([...Object.keys(A?.res_series || {}), ...Object.keys(B?.res_series || {})]);
    return Array.from(set);
  }, [A, B]);
  const [container, setContainer] = useState("");
  useEffect(() => {
    if (!container && containers.length) setContainer(containers[0]);
  }, [containers, container]);

  const distChart = (kind, yName, fmt) => useMemo(() => {
    const ha = A?.res_series?.[container]?.[kind];
    const hb = B?.res_series?.[container]?.[kind];
    if (!ha && !hb) return null;
    const labels = (ha || hb).labels;
    const valKey = kind === "gc_hist" ? "counts" : "seconds";
    const line = (name, color, h) => ({
      name, type: "line", symbol: "circle", symbolSize: 5,
      lineStyle: { width: 2.2 }, itemStyle: { color },
      data: labels.map((_, i) => (h?.[valKey]?.[i] ?? null)),
    });
    return {
      ...ANIM,
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 16, top: 40, bottom: 70 },
      xAxis: catAxis(labels, ""),
      yAxis: valAxis(yName),
      series: [line("A", pal.a, ha), line("B", pal.b, hb)],
    };
  }, [A, B, dark, container, kind]);

  const cpuDist = distChart("cpu_hist", "累计时长 s", (v: any) => `${v}s`);
  const memDist = distChart("mem_hist", "累计时长 s", (v: any) => `${v}s`);
  const gcDist = distChart("gc_hist", "次数", (v: any) => `${v}次`);

  if (!suites.length) {
    return (
      <div className="shell items-center justify-center">
        <div className="text-sm text-muted-foreground">
          暂无 suite_* 数据 · 跑 <code>bash ab_compare.sh warm</code> / <code>run</code> 后自动出现
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="brand">套件对比</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={cn(active === id && "active")}>{label}</a>
        ))}
      </nav>

      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background/85 px-8 py-3 backdrop-blur">
          <span className="ink-title text-base font-bold tracking-widest">A/B 套件对比</span>
          <div className="ml-auto flex items-center gap-2">
            <select className="tsel" value={keyA} onChange={(e) => setKeyA(e.target.value)}>
              {suites.filter((s) => s.key.endsWith("abA")).map((s) => (
                <option key={s.key} value={s.key}>A {s.key}</option>
              ))}
            </select>
            <select className="tsel" value={keyB} onChange={(e) => setKeyB(e.target.value)}>
              {suites.filter((s) => s.key.endsWith("abB")).map((s) => (
                <option key={s.key} value={s.key}>B {s.key}</option>
              ))}
            </select>
            <button className="tbtn" onClick={toggleTheme}>{dark ? "亮色" : "暗色"}</button>
          </div>
        </div>

        <div className="content"><div className="inner">
          {/* ============ 冒烟健康 ============ */}
          <section id="smoke" className="l2section l2fade scroll-mt-24 pt-2">
            <h2 className="ink-title text-lg font-bold tracking-widest">冒烟健康表</h2>
            <div className="mt-3 overflow-x-auto rounded-xl border bg-card p-2">
              <table className="dtable">
                <thead>
                  <tr><th>接口</th><th className="text-right">A verdict</th><th className="text-right">A http/biz</th><th className="text-right">A 耗时</th>
                      <th className="text-right">B verdict</th><th className="text-right">B http/biz</th><th className="text-right">B 耗时</th></tr>
                </thead>
                <tbody>
                  {eps.map((ep) => {
                    const sa = A?.smoke?.find((x: any) => x.api === ep);
                    const sb = B?.smoke?.find((x: any) => x.api === ep);
                    const verdict = (s: any) => (
                      <span className={cn("l2num", s?.verdict !== "OK" && "text-red-500 font-semibold")}>{s?.verdict ?? "—"}</span>
                    );
                    const hb = (s: any) => (
                      <span className="l2num text-muted-foreground">{s ? `${s.http}/${s.biz}` : "—"}</span>
                    );
                    const ms = (s: any) => (
                      <span className="l2num text-muted-foreground">{s?.ms != null ? `${s.ms}ms` : "—"}</span>
                    );
                    return (
                      <tr key={ep}>
                        <td className="whitespace-nowrap">{ep}</td>
                        <td className="text-right">{verdict(sa)}</td>
                        <td className="text-right">{hb(sa)}</td>
                        <td className="text-right">{ms(sa)}</td>
                        <td className="text-right">{verdict(sb)}</td>
                        <td className="text-right">{hb(sb)}</td>
                        <td className="text-right">{ms(sb)}</td>
                      </tr>
                    );
                  })}
                  {!eps.length && <tr><td colSpan={7} className="text-center text-muted-foreground">暂无数据</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* ============ 读接口 ============ */}
          <section id="read" className="l2section l2fade mt-14 scroll-mt-24">
            <h2 className="ink-title text-lg font-bold tracking-widest">读接口对比</h2>
            {tpsChart && <div className="mt-4 rounded-xl border bg-card p-3"><Chart option={tpsChart} height={300} /></div>}
            {p50Chart && <div className="mt-3 rounded-xl border bg-card p-3"><Chart option={p50Chart} height={300} /></div>}
            {errChart && (
              <>
                <h3 className="mt-6 text-sm font-semibold text-muted-foreground">错误率</h3>
                <div className="mt-2 rounded-xl border bg-card p-3"><Chart option={errChart} height={280} /></div>
              </>
            )}
            <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
              <table className="dtable">
                <thead>
                  <tr><th>接口</th><th className="text-right">A 有效TPS</th><th className="text-right">B 有效TPS</th><th className="text-right">B/A</th>
                      <th className="text-right">A P50</th><th className="text-right">B P50</th>
                      <th className="text-right">A P99</th><th className="text-right">B P99</th>
                      <th className="text-right">A err%</th><th className="text-right">B err%</th>
                      <th className="text-right">SQL/req A→B</th></tr>
                </thead>
                <tbody>
                  {eps.map((ep) => {
                    const ra = getRead(A, ep), rb = getRead(B, ep);
                    const bad = broken(A, ep) || broken(B, ep);
                    return (
                      <tr key={ep} className={cn(bad && "opacity-60")}>
                        <td className="whitespace-nowrap">
                          {ep}{bad && <span className="ml-2 rounded bg-red-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">不可比</span>}
                        </td>
                        <td className="l2num text-right">{num(okTps(A, ep), 1)}</td>
                        <td className="l2num text-right">{num(okTps(B, ep), 1)}</td>
                        <td className="text-right"><RateBadge v={bOverA(okTps(A, ep), okTps(B, ep))} /></td>
                        <td className="l2num text-right">{ra?.p50_ok_med ?? "—"}</td>
                        <td className="l2num text-right">{rb?.p50_ok_med ?? "—"}</td>
                        <td className="l2num text-right">{ra?.p99_ok_med ?? "—"}</td>
                        <td className="l2num text-right">{rb?.p99_ok_med ?? "—"}</td>
                        <td className={cn("l2num text-right", (ra?.err_med ?? 0) >= 5 && "text-red-500 font-semibold")}>{num(ra?.err_med, 2)}</td>
                        <td className={cn("l2num text-right", (rb?.err_med ?? 0) >= 5 && "text-red-500 font-semibold")}>{num(rb?.err_med, 2)}</td>
                        <td className="l2num text-right text-muted-foreground">{ra?.sql_med ?? "—"}→{rb?.sql_med ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ============ 写测试 ============ */}
          <section id="write" className="l2section l2fade mt-14 scroll-mt-24">
            <h2 className="ink-title text-lg font-bold tracking-widest">写测试</h2>
            <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
              <table className="dtable">
                <thead>
                  <tr><th>场景</th><th className="text-right">成功单</th><th className="text-right">落库单</th>
                      <th className="text-right">lock_stock</th><th className="text-right">齐射P50</th><th className="text-right">判定</th></tr>
                </thead>
                <tbody>
                  {[["稀缺库存抢购(5件/200人)", "write"], ["充足库存对照(1000件/200人)", "throughput"]].map(([scene, field]: any) => (
                    <Fragment key={scene}>
                      {[["A", A], ["B", B]].map(([label, s]: any) => {
                        const rows = field === "write"
                          ? (s?.write || []).filter((m: any) => m.mode === "correctness")
                          : (s?.throughput || []);
                        const isCorr = field === "write";
                        const failures: string[] = [];
                        if (rows.length) {
                          if (isCorr && !rows.every((m: any) => !m.oversell && m.success === m.db_orders)) failures.push("超卖");
                          if (!isCorr && !rows.every((m: any) => m.failed === 0)) failures.push("误杀");
                          if (!rows.every((m: any) => m.final_lock_stock === m.success)) failures.push("账实不符");
                        }
                        const verdict = rows.length ? (failures.length ? failures.join("、") : "正常") : "—";
                        const vcls = rows.length ? (failures.length ? "text-red-500 font-semibold" : "text-emerald-600") : "text-muted-foreground";
                        const p50v = (() => {
                          const v = rows.map((m: any) => m.p50_ms).filter((x: any) => x !== null && x !== undefined).sort((a: number, b: number) => a - b);
                          if (!v.length) return "—";
                          const mid = Math.floor(v.length / 2);
                          return num(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, 0);
                        })();
                        return (
                          <tr key={scene + label}>
                            <td className="whitespace-nowrap">{scene} · {label} × {rows.length}轮</td>
                            <td className="l2num text-right">{rows.map((m: any) => m.success).join("/") || "—"}</td>
                            <td className="l2num text-right">{rows.map((m: any) => m.db_orders).join("/") || "—"}</td>
                            <td className="l2num text-right">{rows.map((m: any) => m.final_lock_stock).join("/") || "—"}</td>
                            <td className="l2num text-right">{p50v}</td>
                            <td className={cn("l2num text-right", vcls)}>{verdict}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border bg-card p-2">
              <table className="dtable">
                <thead>
                  <tr><th>读写混合</th><th className="text-right">读有效TPS</th><th className="text-right">读P50(成功)</th>
                      <th className="text-right">读err%</th><th className="text-right">写成功</th></tr>
                </thead>
                <tbody>
                  {[["A", A], ["B", B]].map(([label, s]: any) => {
                    const mix = s?.mixed || [];
                    const med = (f: (m: any) => any) => {
                      const v = mix.map(f).filter((x: any) => x !== null && x !== undefined).sort((a: number, b: number) => a - b);
                      if (!v.length) return "—";
                      const mid = Math.floor(v.length / 2);
                      return num(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, 1);
                    };
                    return (
                      <tr key={label}>
                        <td>{label} × {mix.length}轮</td>
                        <td className="l2num text-right">{med((m: any) => m.read_ok_tps_under_mix ?? m.read_tps_under_mix)}</td>
                        <td className="l2num text-right">{med((m: any) => m.read_p50_ok_under_mix ?? m.read_p50_under_mix)}</td>
                        <td className="l2num text-right">{med((m: any) => m.read_err_under_mix)}</td>
                        <td className="l2num text-right">{mix.map((m: any) => m.write_success_under_mix).join("/") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ============ 资源 ============ */}
          <section id="resource" className="l2section l2fade mt-14 mb-20 scroll-mt-24">
            <div className="flex items-center justify-between">
              <h2 className="ink-title text-lg font-bold tracking-widest">资源占时分布</h2>
              <div className="seg flex-wrap">
                {containers.map((c) => (
                  <button key={c} className={cn(container === c && "on")} onClick={() => setContainer(c)}>{c}</button>
                ))}
              </div>
            </div>
            {cpuDist && (
              <>
                <h3 className="mt-6 text-sm font-semibold text-muted-foreground">CPU 占时分布</h3>
                <div className="mt-2 rounded-xl border bg-card p-3"><Chart option={cpuDist} height={300} /></div>
              </>
            )}
            {memDist && (
              <>
                <h3 className="mt-6 text-sm font-semibold text-muted-foreground">内存占时分布</h3>
                <div className="mt-2 rounded-xl border bg-card p-3"><Chart option={memDist} height={300} /></div>
              </>
            )}
            {gcDist && (
              <>
                <h3 className="mt-6 text-sm font-semibold text-muted-foreground">GC 暂停时长分布</h3>
                <div className="mt-2 rounded-xl border bg-card p-3"><Chart option={gcDist} height={280} /></div>
              </>
            )}
          </section>
        </div></div>
      </div>
    </div>
  );
}
