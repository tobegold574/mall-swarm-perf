"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { cn } from "@/app/lib/utils";

/* ---------- ECharts ---------- */
function Chart({ option, height = 360 }: { option: any; height?: number }) {
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

const RUNGS = [100, 200, 500, 1000];
const SECTIONS = [
  ["summary", "总体对比"], ["scalability", "并发扩展性"], ["endpoints", "接口对比"],
  ["write", "写路径"], ["resource", "资源消耗"], ["errors", "错误与超时"],
];
const ANIM = { animationDuration: 600, animationEasing: "cubicOut" as const };
const key = (img: string, vt: string, t: number) => `${img}|${vt}|${t}`;
const short = (ep: string) => ep.replace(/^(admin|portal)_/, "");

function num(x: any, d = 0, s = "") {
  return x === undefined || x === null || isNaN(x) ? "—" : x.toFixed(d) + s;
}
function pct(a: any, b: any) {
  if (!a || !b) return null;
  return (b / a - 1) * 100;
}
function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null) return <span className="l2num text-muted-foreground">—</span>;
  const cls = v >= 0 ? (invert ? "text-red-500" : "text-emerald-500") : (invert ? "text-emerald-500" : "text-red-500");
  return <span className={cn("l2num font-semibold", cls)}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}

export default function ReportPage() {
  const [data, setData] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [run, setRun] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState("summary");
  const [showTop, setShowTop] = useState(false);
  const [dark, setDark] = useState(false);
  const [resChart, setResChart] = useState<"mysql" | "portal">("mysql");
  const [barRung, setBarRung] = useState(500);

  const load = (id: string) => {
    fetch(`/api/l2${id ? `?run=${id}` : ""}`).then(async (r) => {
      if (!r.ok) setErr((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      else { setData(await r.json()); setErr(null); }
    }).catch((e) => setErr(String(e)));
  };

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const d = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    fetch("/api/l2/runs").then((r) => r.json()).then(setRuns).catch(() => {});
    load("");
  }, []);

  useEffect(() => {
    const onS = () => setShowTop(window.scrollY > 480);
    window.addEventListener("scroll", onS);
    return () => window.removeEventListener("scroll", onS);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-30% 0px -60% 0px" }
    );
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [data]);

  const toggleTheme = () => {
    const nd = !dark;
    setDark(nd);
    document.documentElement.classList.toggle("dark", nd);
    localStorage.setItem("theme", nd ? "dark" : "light");
  };

  const cells = data?.cells || {};
  const wc = data?.writeCells || {};
  const A = (t: number) => cells[key("abA", "false", t)];
  const B = (t: number) => cells[key("abB", "true", t)];
  const okSum = (c: any) => (c ? Object.values<any>(c.eps).reduce((s, e) => s + (e.okTps ?? e.tps), 0) : null);

  /* ---------- 水墨图表配色 ---------- */
  const pal = dark
    ? { a: "#525252", b: "#f5f5f5", grid: "rgba(255,255,255,0.07)", txt: "#a3a3a3" }
    : { a: "#9ca3af", b: "#111827", grid: "rgba(0,0,0,0.06)", txt: "#6b7280" };
  const axis = {
    axisLine: { lineStyle: { color: pal.grid } }, axisLabel: { color: pal.txt },
    splitLine: { lineStyle: { color: pal.grid } }, nameTextStyle: { color: pal.txt },
  };

  /* ---------- 扩展性 ---------- */
  const scalability = useMemo(() => {
    if (!data) return null;
    const tot = (f: (t: number) => any) => RUNGS.map((t) => { const v = okSum(f(t)); return v === null ? null : Math.round(v); });
    return {
      ...ANIM, tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "category", data: RUNGS.map(String), name: "并发", ...axis },
      yAxis: { type: "value", name: "有效 TPS", ...axis },
      series: [
        { name: "A 原生基线", type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2.2, color: pal.a }, itemStyle: { color: pal.a }, data: tot(A) },
        { name: "B 优化栈", type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2.2, color: pal.b }, itemStyle: { color: pal.b }, data: tot(B) },
      ],
    };
  }, [data, dark]);

  /* ---------- 接口柱状图(有效TPS) ---------- */
  const tpsBars = useMemo(() => {
    if (!data) return null;
    return {
      ...ANIM,
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 24, top: 44, bottom: 92 },
      xAxis: { type: "category", data: data.eps.map(short), ...axis, axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0 } },
      yAxis: { type: "value", name: "有效 TPS", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 22, itemStyle: { color: pal.a }, data: data.eps.map((ep: string) => A(barRung)?.eps?.[ep]?.okTps ?? A(barRung)?.eps?.[ep]?.tps ?? null) },
        { name: "B", type: "bar", barMaxWidth: 22, itemStyle: { color: pal.b }, data: data.eps.map((ep: string) => B(barRung)?.eps?.[ep]?.okTps ?? B(barRung)?.eps?.[ep]?.tps ?? null) },
      ],
    };
  }, [data, dark, barRung]);

  /* ---------- 接口柱状图(P50) ---------- */
  const p50Bars = useMemo(() => {
    if (!data) return null;
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v} ms` },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 24, top: 44, bottom: 92 },
      xAxis: { type: "category", data: data.eps.map(short), ...axis, axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0 } },
      yAxis: { type: "value", name: "P50 ms", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 22, itemStyle: { color: pal.a }, data: data.eps.map((ep: string) => A(barRung)?.eps?.[ep]?.p50 ?? null) },
        { name: "B", type: "bar", barMaxWidth: 22, itemStyle: { color: pal.b }, data: data.eps.map((ep: string) => B(barRung)?.eps?.[ep]?.p50 ?? null) },
      ],
    };
  }, [data, dark, barRung]);

  /* ---------- 资源时序 ---------- */
  const resSeries = useMemo(() => {
    if (!data) return null;
    const cont = resChart === "mysql" ? "mall-mysql" : "mall-svc-portal";
    const phases = Object.keys(cells).sort((a, b) => {
      const [ia, , ta] = a.split("|"), [ib, , tb] = b.split("|");
      return +ta - +tb || ia.localeCompare(ib);
    });
    const grays = dark ? ["#f5f5f5", "#a3a3a3", "#737373", "#525252", "#d4d4d4", "#8f8f8f", "#404040", "#e5e5e5"]
                       : ["#111827", "#6b7280", "#9ca3af", "#374151", "#d1d5db", "#4b5563", "#11182799", "#000000aa"];
    let ci = 0;
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
      legend: { type: "scroll", top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "value", name: "秒", max: 60, ...axis },
      yAxis: { type: "value", name: "CPU %", max: 220, ...axis },
      series: phases.flatMap((k) => {
        const ss = cells[k]?.resSeries;
        if (!ss) return [];
        const pts = ss.filter((p: any) => p.container === cont).map((p: any) => [p.dt, p.cpu]);
        if (!pts.length) return [];
        const [img, , t] = k.split("|");
        const color = grays[ci++ % grays.length];
        return [{ name: `${img === "abA" ? "A" : "B"}·${t}`, type: "line", symbol: "none", smooth: true, lineStyle: { width: 1.6, color }, itemStyle: { color }, data: pts }];
      }),
    };
  }, [data, resChart, dark]);

  if (err) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">{err}</div></div>;
  }
  if (!data || !data.cells) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">加载中...</div></div>;
  }

  const byRung = data.byRung || [];

  return (
    <div className="shell">
      {/* ---------- 墨栏 ---------- */}
      <nav className="sidenav">
        <div className="brand">阶梯对比</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={cn(active === id && "active")}>{label}</a>
        ))}
      </nav>

      {/* ---------- 纸面 ---------- */}
      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background/85 px-8 py-3 backdrop-blur">
          <span className="ink-title text-base font-bold tracking-widest">mall-swarm · 压测对比</span>
          <div className="ml-auto flex items-center gap-2">
            <select className="tsel" value={run} onChange={(e) => { setRun(e.target.value); load(e.target.value); }}>
              <option value="">最新运行</option>
              {runs.map((r) => <option key={r.id} value={r.id}>{r.id}（{r.generatedAt}）</option>)}
            </select>
            <button className="tbtn" onClick={toggleTheme}>{dark ? "宣纸" : "墨夜"}</button>
          </div>
        </div>

        <div className="content">
          <div className="inner">
            {/* 总体对比 */}
            <section id="summary" className="l2section l2fade scroll-mt-24 pt-2">
              <h2 className="ink-title text-lg font-bold tracking-widest">一 · 总体对比</h2>
              <div className="mt-5 grid grid-cols-4 gap-4">
                {RUNGS.map((t) => {
                  const a = A(t), b = B(t);
                  const p = pct(okSum(a), okSum(b));
                  return (
                    <div key={t} className="rounded border bg-card p-4">
                      <div className="text-xs text-muted-foreground">并发 {t} · 有效TPS</div>
                      <div className="l2num mt-1 text-3xl font-bold">
                        {p === null ? "—" : <span className={p >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500"}>{p >= 0 ? "+" : ""}{p.toFixed(1)}%</span>}
                      </div>
                      <div className="l2num mt-1 text-xs text-muted-foreground">A {num(okSum(a), 0)} · B {num(okSum(b), 0)}</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 rounded border bg-card p-2">
                <table className="dtable">
                  <thead><tr><th>指标</th><th>A 原生</th><th>B 优化栈</th><th>Δ% (B/A)</th></tr></thead>
                  <tbody>
                    <tr className="group-row"><td colSpan={4}>吞吐（有效 TPS = 成功请求/秒）</td></tr>
                    {RUNGS.map((t) => {
                      const a = A(t), b = B(t);
                      return (
                        <tr key={`t${t}`}>
                          <td>├ 总有效 TPS @并发{t}</td>
                          <td className="l2num">{num(okSum(a), 1)}</td>
                          <td className="l2num">{num(okSum(b), 1)}</td>
                          <td><Delta v={pct(okSum(a), okSum(b))} /></td>
                        </tr>
                      );
                    })}
                    {data.eps.map((ep: string) => (
                      <Fragment key={`e${ep}`}>
                        <tr>
                          <td>├ {short(ep)} · 有效TPS @500</td>
                          <td className="l2num">{num(A(500)?.eps?.[ep]?.okTps ?? A(500)?.eps?.[ep]?.tps, 1)}</td>
                          <td className="l2num">{num(B(500)?.eps?.[ep]?.okTps ?? B(500)?.eps?.[ep]?.tps, 1)}</td>
                          <td><Delta v={pct(A(500)?.eps?.[ep]?.okTps, B(500)?.eps?.[ep]?.okTps)} /></td>
                        </tr>
                        <tr>
                          <td>├ {short(ep)} · P50 @500</td>
                          <td className="l2num">{num(A(500)?.eps?.[ep]?.p50, 0)}</td>
                          <td className="l2num">{num(B(500)?.eps?.[ep]?.p50, 0)}</td>
                          <td><Delta v={pct(A(500)?.eps?.[ep]?.p50, B(500)?.eps?.[ep]?.p50)} invert /></td>
                        </tr>
                      </Fragment>
                    ))}
                    <tr className="group-row"><td colSpan={4}>写路径（收藏写 / 购物车读）</td></tr>
                    {RUNGS.map((t) => (
                      <Fragment key={`w${t}`}>
                        <tr>
                          <td>├ 收藏写 TPS @并发{t}</td>
                          <td className="l2num">{num(wc[`coll|abA|${t}`]?.okTps, 1)}</td>
                          <td className="l2num">{num(wc[`coll|abB|${t}`]?.okTps, 1)}</td>
                          <td><Delta v={pct(wc[`coll|abA|${t}`]?.okTps, wc[`coll|abB|${t}`]?.okTps)} /></td>
                        </tr>
                        <tr>
                          <td>├ 购物车读 TPS @并发{t}</td>
                          <td className="l2num">{num(wc[`cart|abA|${t}`]?.okTps, 1)}</td>
                          <td className="l2num">{num(wc[`cart|abB|${t}`]?.okTps, 1)}</td>
                          <td><Delta v={pct(wc[`cart|abA|${t}`]?.okTps, wc[`cart|abB|${t}`]?.okTps)} /></td>
                        </tr>
                      </Fragment>
                    ))}
                    <tr className="group-row"><td colSpan={4}>资源峰值（5s 粒度采样）</td></tr>
                    {RUNGS.map((t) => {
                      const am = A(t)?.res?.["mall-mysql"]?.cpuMax, bm = B(t)?.res?.["mall-mysql"]?.cpuMax;
                      const ap = A(t)?.res?.["mall-svc-portal"]?.memMax, bp = B(t)?.res?.["mall-svc-portal"]?.memMax;
                      return (
                        <Fragment key={`r${t}`}>
                          <tr>
                            <td>├ MySQL CPU 峰值 @并发{t}</td>
                            <td className="l2num">{am ? num(am / 100, 2, "核") : "—"}</td>
                            <td className="l2num">{bm ? num(bm / 100, 2, "核") : "—"}</td>
                            <td><Delta v={am && bm ? pct(am, bm) : null} invert /></td>
                          </tr>
                          <tr>
                            <td>├ Portal 内存峰值 @并发{t}</td>
                            <td className="l2num">{ap ? num(ap, 0, "MiB") : "—"}</td>
                            <td className="l2num">{bp ? num(bp, 0, "MiB") : "—"}</td>
                            <td><Delta v={ap && bp ? pct(ap, bp) : null} invert /></td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 扩展性 */}
            <section id="scalability" className="l2section l2fade mt-14 scroll-mt-24">
              <h2 className="ink-title text-lg font-bold tracking-widest">二 · 并发扩展性</h2>
              <div className="mt-4 rounded border bg-card p-4"><Chart option={scalability} height={380} /></div>
            </section>

            {/* 接口对比 */}
            <section id="endpoints" className="l2section l2fade mt-14 scroll-mt-24">
              <div className="flex items-center justify-between">
                <h2 className="ink-title text-lg font-bold tracking-widest">三 · 接口对比</h2>
                <div className="seg">
                  {RUNGS.map((t) => (
                    <button key={t} className={cn(barRung === t && "on")} onClick={() => setBarRung(t)}>{t}</button>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">并发 {barRung} · 左图有效吞吐，右图响应延迟（矮者优）</p>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <div className="rounded border bg-card p-4"><Chart option={tpsBars} height={340} /></div>
                <div className="rounded border bg-card p-4"><Chart option={p50Bars} height={340} /></div>
              </div>
            </section>

            {/* 写路径 */}
            <section id="write" className="l2section l2fade mt-14 scroll-mt-24">
              <h2 className="ink-title text-lg font-bold tracking-widest">四 · 写路径</h2>
              <div className="mt-4 overflow-x-auto rounded border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr><th>并发</th><th className="text-right">A 收藏写</th><th className="text-right">B 收藏写</th><th className="text-right">Δ%</th><th className="text-right">A 购物车读</th><th className="text-right">B 购物车读</th><th className="text-right">Δ%</th></tr>
                  </thead>
                  <tbody>
                    {RUNGS.map((t) => {
                      const ac = wc[`coll|abA|${t}`], bc = wc[`coll|abB|${t}`];
                      const ak = wc[`cart|abA|${t}`], bk = wc[`cart|abB|${t}`];
                      return (
                        <tr key={t}>
                          <td className="l2num">{t}</td>
                          <td className="l2num text-right">{num(ac?.okTps, 1)}</td>
                          <td className="l2num text-right">{num(bc?.okTps, 1)}</td>
                          <td className="text-right"><Delta v={pct(ac?.okTps, bc?.okTps)} /></td>
                          <td className="l2num text-right">{num(ak?.okTps, 1)}</td>
                          <td className="l2num text-right">{num(bk?.okTps, 1)}</td>
                          <td className="text-right"><Delta v={pct(ak?.okTps, bk?.okTps)} /></td>
                        </tr>
                      );
                    })}
                    {!Object.keys(wc).length && <tr><td colSpan={7} className="text-center text-muted-foreground">暂无写路径数据</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 资源 */}
            <section id="resource" className="l2section l2fade mt-14 scroll-mt-24">
              <div className="flex items-center justify-between">
                <h2 className="ink-title text-lg font-bold tracking-widest">五 · 资源消耗</h2>
                <div className="seg">
                  {[["mysql", "MySQL"], ["portal", "Portal"]].map(([k, label]) => (
                    <button key={k} className={cn(resChart === k && "on")} onClick={() => setResChart(k as any)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="mt-4 rounded border bg-card p-4"><Chart option={resSeries} height={420} /></div>
            </section>

            {/* 错误 */}
            <section id="errors" className="l2section l2fade mt-14 mb-20 scroll-mt-24">
              <h2 className="ink-title text-lg font-bold tracking-widest">六 · 错误与超时</h2>
              <div className="mt-4 overflow-x-auto rounded border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr><th>相位</th><th className="text-right">错误%</th><th className="text-right">超时</th><th>主要错误接口</th></tr>
                  </thead>
                  <tbody>
                    {Object.keys(cells).sort().map((k) => {
                      const [img, vt, t] = k.split("|");
                      const eps = cells[k]?.eps || {};
                      const list = Object.entries<any>(eps).filter(([, e]) => e.errPct > 0).sort((a, b) => b[1].errPct - a[1].errPct).slice(0, 3);
                      const totN = Object.values<any>(eps).reduce((s, e) => s + e.n, 0);
                      const totE = Object.values<any>(eps).reduce((s, e) => s + (e.errPct / 100) * e.n, 0);
                      const tos = Object.values<any>(eps).reduce((s, e) => s + (e.timeouts || 0), 0);
                      const errPct = totN ? (totE / totN) * 100 : 0;
                      return (
                        <tr key={k}>
                          <td className="l2num whitespace-nowrap">{img === "abA" ? "A" : "B"} · {t}</td>
                          <td className={cn("l2num text-right font-semibold", errPct >= 5 ? "text-red-500" : "text-emerald-500")}>{num(errPct, 1)}%</td>
                          <td className="l2num text-right">{tos}</td>
                          <td className="text-xs text-muted-foreground">{list.length ? list.map(([n, e]) => `${short(n)}(${num(e.errPct, 0)}%)`).join("、") : "无"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>

      {showTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 rounded-full border bg-background px-4 py-2 text-xs shadow-lg transition-transform hover:-translate-y-0.5">
          ↑ 顶部
        </button>
      )}
    </div>
  );
}
