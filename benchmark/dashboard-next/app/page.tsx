"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { Button } from "@/app/components/ui/button";
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

const RUNGS = [500, 1000];
const SECTIONS = [["summary", "总体TPS"], ["throughput", "吞吐"], ["resource", "资源消耗"]];
const ANIM = { animationDuration: 600, animationEasing: "cubicOut" as const };
const key = (ep: string, v: string, t: number) => `${ep}|${v}|${t}`;
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
  const [resChart, setResChart] = useState<"mysql" | "redis" | "mongo" | "gateway" | "portal" | "admin" | "jmeter">("mysql");

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
  const C = (ep: string, v: string, t: number) => cells[key(ep, v, t)];
  const okSum = (v: string, t: number) =>
    data ? data.eps.reduce((s: number, ep: string) => {
      const c = C(ep, v, t);
      return s + (c ? (c.eps[ep]?.okTps ?? c.eps[ep]?.tps ?? 0) : 0);
    }, 0) : null;

  const pal = dark
    ? { a: "#64748b", b: "#60a5fa", grid: "rgba(255,255,255,0.07)", txt: "#a3a3a3" }
    : { a: "#94a3b8", b: "#2563eb", grid: "rgba(0,0,0,0.06)", txt: "#6b7280" };
  const axis = {
    axisLine: { lineStyle: { color: pal.grid } }, axisLabel: { color: pal.txt },
    splitLine: { lineStyle: { color: pal.grid } }, nameTextStyle: { color: pal.txt },
  };

  /* ---------- 扩展性(两档) ---------- */
  const scalability = useMemo(() => {
    if (!data) return null;
    const mk = (name: string, color: string, v: string) => ({
      name, type: "line" as const, symbol: "circle", symbolSize: 9,
      lineStyle: { width: 2.4 }, itemStyle: { color },
      data: RUNGS.map((t) => { const s = okSum(v, t); return s === null ? null : Math.round(s); }),
    });
    return {
      ...ANIM, tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "category", data: RUNGS.map(String), name: "并发", ...axis },
      yAxis: { type: "value", name: "有效 TPS", ...axis },
      series: [mk("A 原生基线", pal.a, "abA"), mk("B 优化栈", pal.b, "abB")],
    };
  }, [data, dark]);

  /* ---------- 分档接口柱状图 ---------- */
  const rungBars = (t: number, metric: "tps" | "p50") => {
    if (!data) return null;
    const val = (c: any, ep: string) =>
      metric === "tps" ? (c?.eps?.[ep]?.okTps ?? null) : (c?.eps?.[ep]?.okP50 ?? null);
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (metric === "tps" ? `${v} TPS` : `${v} ms`) },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 52, right: 16, top: 40, bottom: 86 },
      xAxis: { type: "category", data: data.eps.map(short), ...axis, axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0, fontSize: 10 } },
      yAxis: { type: "value", name: metric === "tps" ? "有效TPS" : "P50 ms", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 20, itemStyle: { color: pal.a }, data: data.eps.map((ep: string) => val(C(ep, "abA", t), ep)) },
        { name: "B", type: "bar", barMaxWidth: 20, itemStyle: { color: pal.b }, data: data.eps.map((ep: string) => val(C(ep, "abB", t), ep)) },
      ],
    };
  };

  /* ---------- 错误率 ---------- */
  const errBars = useMemo(() => {
    if (!data) return null;
    const t = 1000;
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 46, right: 16, top: 40, bottom: 86 },
      xAxis: { type: "category", data: data.eps.map(short), ...axis, axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0, fontSize: 10 } },
      yAxis: { type: "value", name: "错误率 %", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 20, itemStyle: { color: pal.a }, data: data.eps.map((ep: string) => C(ep, "abA", t)?.eps?.[ep]?.errPct ?? 0) },
        { name: "B", type: "bar", barMaxWidth: 20, itemStyle: { color: pal.b }, data: data.eps.map((ep: string) => C(ep, "abB", t)?.eps?.[ep]?.errPct ?? 0) },
      ],
    };
  }, [data, dark]);


  /* ---------- CPU 占时分布: x=利用率, y=累计时长, 按变体×档位四线 ---------- */
  const cpuDist = useMemo(() => {
    if (!data) return null;
    const entry = CONTAINERS.find(([k]) => k === resChart);
    if (!entry) return null;
    const labels: string[] = [];
    for (let lo = 0; lo < 220; lo += 10) labels.push(`${lo}-${lo + 10}`);
    labels.push("220+");
    const groups: Record<string, Record<string, number[]>> = {};
    for (const k of Object.keys(cells)) {
      const [ep, v, t] = k.split("|");
      const g = `${v}·${t}`;
      (groups[g] = groups[g] || {})[v] = groups[g][v] || new Array(labels.length).fill(0);
      const ss = cells[k]?.resSeries;
      if (!ss) continue;
      for (const p of ss) {
        if (p.container !== entry[2]) continue;
        let bi = labels.length - 1;
        for (let i = 0; i < labels.length; i++) {
          const lo = i * 10;
          if (p.cpu >= lo && p.cpu < lo + 10) { bi = i; break; }
        }
        groups[g][v][bi] += 5;
      }
    }
    const styles: [string, string, string][] = [
      ["abA", "500", "#9ca3af"], ["abA", "1000", "#4b5563"],
      ["abB", "500", "#93c5fd"], ["abB", "1000", "#2563eb"],
    ];
    const series = styles.map(([v, t, color]) => {
      const g = `${v}·${t}`;
      if (!groups[g]) return null;
      return {
        name: `${v === "abA" ? "A" : "B"}·${t}`, type: "line" as const,
        symbol: "circle", symbolSize: 5,
        lineStyle: { width: 2.2, type: v === "abA" ? "solid" : "dashed" },
        itemStyle: { color }, data: groups[g][v].map((x: number) => Math.round(x * 10) / 10),
      };
    }).filter(Boolean);
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v} 秒` },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 24, top: 44, bottom: 56 },
      xAxis: { type: "category", data: labels, name: "CPU 利用率 %", ...axis, axisLabel: { ...axis.axisLabel, rotate: 30 } },
      yAxis: { type: "value", name: "累计时长 秒", ...axis },
      series,
    };
  }, [data, dark, resChart]);

  /* ---------- 内存占时分布: x=内存档位, y=累计时长, 按变体×档位四线 ---------- */
  const memDist = useMemo(() => {
    if (!data) return null;
    const entry = CONTAINERS.find(([k]) => k === resChart);
    if (!entry) return null;
    const raw: Record<string, Record<string, number[]>> = {};
    for (const k of Object.keys(cells)) {
      const [ep, v, t] = k.split("|");
      const g = `${v}·${t}`;
      (raw[g] = raw[g] || {})[v] = raw[g][v] || [];
      const ss = cells[k]?.resSeries;
      if (!ss) continue;
      for (const p of ss) {
        if (p.container === entry[2] && p.mem > 0) raw[g][v].push(p.mem);
      }
    }
    const maxMem = Math.max(1, ...Object.values(raw).flatMap((vv: any) => Object.values(vv).flat().map((x: number) => x)));
    const step = Math.max(50, Math.ceil(maxMem / 10 / 50) * 50);
    const nb = Math.ceil(maxMem / step) + 1;
    const labels = Array.from({ length: nb }, (_, i) => `${i * step}`);
    const styles: [string, string, string][] = [
      ["abA", "500", "#9ca3af"], ["abA", "1000", "#4b5563"],
      ["abB", "500", "#93c5fd"], ["abB", "1000", "#2563eb"],
    ];
    const series = styles.map(([v, t, color]) => {
      const g = `${v}·${t}`;
      if (!raw[g]) return null;
      return {
        name: `${v === "abA" ? "A" : "B"}·${t}`, type: "line" as const,
        symbol: "circle", symbolSize: 5,
        lineStyle: { width: 2.2, type: v === "abA" ? "solid" : "dashed" },
        itemStyle: { color },
        data: labels.map((_, i) => {
          const lo = i * step, hi = lo + step;
          return Math.round(raw[g][v].filter((m: number) => m >= lo && m < hi).length * 5 * 10) / 10;
        }),
      };
    }).filter(Boolean);
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v} 秒` },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 60, right: 20, top: 44, bottom: 56 },
      xAxis: { type: "category", data: labels, name: "内存档位 MiB", ...axis, axisLabel: { ...axis.axisLabel, rotate: 30 } },
      yAxis: { type: "value", name: "累计时长 秒", ...axis },
      series,
    };
  }, [data, dark, resChart]);

  if (err) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">{err}</div></div>;
  }
  if (!data || !data.cells) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">加载中...</div></div>;
  }

  const byRung = data.byRung || [];

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="brand">压测对比</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={cn(active === id && "active")}>{label}</a>
        ))}
      </nav>

      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background/85 px-8 py-3 backdrop-blur">
          <span className="ink-title text-base font-bold tracking-widest">mall-swarm · 压测对比</span>
          <div className="ml-auto flex items-center gap-2">
            <select className="tsel" value={run} onChange={(e) => { setRun(e.target.value); load(e.target.value); }}>
              <option value="">最新运行</option>
              {runs.map((r) => <option key={r.id} value={r.id}>{r.id}（{r.generatedAt}）</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={toggleTheme}>{dark ? "亮色" : "暗色"}</Button>
          </div>
        </div>

        <div className="content">
          <div className="inner">
            {/* ============ 总体TPS ============ */}
            <section id="summary" className="l2section l2fade scroll-mt-24 pt-2">
              <h2 className="ink-title text-lg font-bold tracking-widest">总体TPS</h2>
              <p className="mt-2 text-xs text-muted-foreground">
                单接口隔离压测 · 11 接口 × 500/1000 并发 · 45s 采样 · 有效TPS = 成功请求/秒 ·
                A = 原作者整套（JDK 17 · SB 3.5.14） B = 优化整套（JDK 25 · SB 4.0.8 · 索引 · VT）
              </p>
              <div className="mt-4 rounded-xl border bg-card p-4"><Chart option={scalability} height={360} /></div>
              <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr><th>并发</th><th className="text-right">A 有效TPS</th><th className="text-right">B 有效TPS</th><th className="text-right">B/A</th></tr>
                  </thead>
                  <tbody>
                    {byRung.map((r: any) => (
                      <tr key={r.t}>
                        <td className="l2num">{r.t}</td>
                        <td className="l2num text-right">{num(r.tpsA, 1)}</td>
                        <td className="l2num text-right">{num(r.tpsB, 1)}</td>
                        <td className="text-right"><Badge2 v={r.bOverA} /></td>
                      </tr>
                    ))}
                    {!byRung.length && <tr><td colSpan={4} className="text-center text-muted-foreground">暂无数据</td></tr>}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-8 text-sm font-semibold text-muted-foreground">分接口错误率对比（并发 1000 · 极限档）</h3>
              <div className="mt-3 rounded-xl border bg-card p-3"><Chart option={errBars} height={300} /></div>
              <div className="mt-3 overflow-x-auto rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr><th>接口</th><th className="text-right">A 错误%</th><th className="text-right">B 错误%</th><th className="text-right">A 超时</th><th className="text-right">B 超时</th></tr>
                  </thead>
                  <tbody>
                    {data.eps.map((ep: string) => {
                      const a = C(ep, "abA", 1000)?.eps?.[ep], b = C(ep, "abB", 1000)?.eps?.[ep];
                      return (
                        <tr key={ep}>
                          <td className="whitespace-nowrap">{ep}</td>
                          <td className={cn("l2num text-right", (a?.errPct ?? 0) >= 5 ? "text-red-500" : "text-emerald-500")}>{num(a?.errPct, 1)}%</td>
                          <td className={cn("l2num text-right", (b?.errPct ?? 0) >= 5 ? "text-red-500" : "text-emerald-500")}>{num(b?.errPct, 1)}%</td>
                          <td className="l2num text-right">{a?.timeouts ?? 0}</td>
                          <td className="l2num text-right">{b?.timeouts ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ============ 吞吐 ============ */}
            <section id="throughput" className="l2section l2fade mt-14 scroll-mt-24">
              <h2 className="ink-title text-lg font-bold tracking-widest">吞吐 · 分接口</h2>
              {RUNGS.map((t) => (
                <Fragment key={t}>
                  <h3 className="mt-6 text-sm font-semibold text-muted-foreground">并发 {t} · 有效TPS</h3>
                  <div className="mt-2 rounded-xl border bg-card p-3"><Chart option={rungBars(t, "tps")} height={300} /></div>
                  <h3 className="mt-4 text-sm font-semibold text-muted-foreground">并发 {t} · P50（成功样本口径）</h3>
                  <div className="mt-2 rounded-xl border bg-card p-3"><Chart option={rungBars(t, "p50")} height={300} /></div>
                </Fragment>
              ))}
            </section>

            {/* ============ 资源消耗 ============ */}
            <section id="resource" className="l2section l2fade mt-14 mb-20 scroll-mt-24">
              <div className="flex items-center justify-between">
                <h2 className="ink-title text-lg font-bold tracking-widest">资源消耗</h2>
                <div className="seg flex-wrap">
                  {CONTAINERS.map(([k, label]) => (
                    <button key={k} className={cn(resChart === k && "on")} onClick={() => setResChart(k as any)}>{label}</button>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">5s 粒度全容器采样 · 占时分布: x=利用率/内存档位, y=该档位累计时长（秒）· 图例可开关 · A·500=虚线浅灰, A·1000=实线深灰, B·500=虚线浅蓝, B·1000=实线蓝</p>

              <div className="mt-4 rounded-xl border bg-card p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">CPU 占时分布（{CONTAINER_LABEL[resChart]}）</div>
                <Chart option={cpuDist} height={340} />
              </div>
              <div className="mt-4 rounded-xl border bg-card p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">内存占时分布（x=内存档位 MiB, y=累计时长秒）</div>
                <Chart option={memDist} height={280} />
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

/* 全部 14 个容器: [key, 展示名, 容器名或前缀] */
const CONTAINERS: [string, string, string][] = [
  ["mysql", "MySQL", "mall-mysql"],
  ["redis", "Redis", "mall-redis"],
  ["mongo", "Mongo", "mall-mongo"],
  ["gateway", "Gateway", "mall-svc-gateway"],
  ["portal", "Portal", "mall-svc-portal"],
  ["admin", "Admin", "mall-svc-admin"],
  ["jmeter", "JMeter", "docker-jmeter-run"],
];
const CONTAINER_LABEL: any = Object.fromEntries(CONTAINERS.map(([k, l]) => [k, l]));

function Badge2({ v }: { v: number }) {
  return (
    <span className={cn("l2num inline-block rounded-md px-2 py-0.5 text-xs font-semibold",
      v >= 100 ? "bg-emerald-600/10 text-emerald-600 dark:text-emerald-500" : "bg-red-600/10 text-red-600 dark:text-red-500")}>
      {v.toFixed(1)}%
    </span>
  );
}
