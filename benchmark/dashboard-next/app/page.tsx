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

const RUNGS = [100, 200, 500, 1000];
const SECTIONS = [["summary", "总体TPS"], ["throughput", "吞吐"], ["sql", "SQL 层"], ["server", "服务端延迟"], ["resource", "资源峰值"]];
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
  const [errRung, setErrRung] = useState(1000);

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

  const pal = dark
    ? { a: "#64748b", b: "#60a5fa", grid: "rgba(255,255,255,0.07)", txt: "#a3a3a3" }
    : { a: "#94a3b8", b: "#2563eb", grid: "rgba(0,0,0,0.06)", txt: "#6b7280" };
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
        { name: "A 原生基线", type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2.4 }, itemStyle: { color: pal.a }, data: tot(A) },
        { name: "B 优化栈", type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2.4 }, itemStyle: { color: pal.b }, data: tot(B) },
      ],
    };
  }, [data, dark]);

  /* ---------- 分档接口柱状图工厂(延迟=成功样本口径) ---------- */
  const rungBars = (metric: "tps" | "p50", t: number) => {
    if (!data) return null;
    const val = (c: any, ep: string) =>
      metric === "tps" ? (c?.eps?.[ep]?.okTps ?? c?.eps?.[ep]?.tps ?? null) : (c?.eps?.[ep]?.okP50 ?? c?.eps?.[ep]?.p50 ?? null);
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (metric === "tps" ? `${v} TPS` : `${v} ms`) },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 52, right: 16, top: 40, bottom: 86 },
      xAxis: { type: "category", data: data.eps.map(short), ...axis, axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0, fontSize: 10 } },
      yAxis: { type: "value", name: metric === "tps" ? "有效TPS" : "P50 ms", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 18, itemStyle: { color: pal.a }, data: data.eps.map((ep: string) => val(A(t), ep)) },
        { name: "B", type: "bar", barMaxWidth: 18, itemStyle: { color: pal.b }, data: data.eps.map((ep: string) => val(B(t), ep)) },
      ],
    };
  };

  /* ---------- 错误率对比 ---------- */
  const errBars = useMemo(() => {
    if (!data) return null;
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 46, right: 16, top: 40, bottom: 86 },
      xAxis: { type: "category", data: data.eps.map(short), ...axis, axisLabel: { ...axis.axisLabel, rotate: 30, interval: 0, fontSize: 10 } },
      yAxis: { type: "value", name: "错误率 %", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 18, itemStyle: { color: pal.a }, data: data.eps.map((ep: string) => Math.round((A(errRung)?.eps?.[ep]?.errPct ?? 0) * 10) / 10) },
        { name: "B", type: "bar", barMaxWidth: 18, itemStyle: { color: pal.b }, data: data.eps.map((ep: string) => Math.round((B(errRung)?.eps?.[ep]?.errPct ?? 0) * 10) / 10) },
      ],
    };
  }, [data, dark, errRung]);

  /* ---------- 资源时序 ---------- */
  const resSeries = useMemo(() => {
    if (!data) return null;
    const cont = resChart === "mysql" ? "mall-mysql" : resChart === "redis" ? "mall-redis" : resChart === "mongo" ? "mall-mongo" : resChart === "gateway" ? "mall-svc-gateway" : resChart === "portal" ? "mall-svc-portal" : resChart === "admin" ? "mall-svc-admin" : "mall-mysql";
    const phases = Object.keys(cells).sort((a, b) => {
      const [ia, , ta] = a.split("|"), [ib, , tb] = b.split("|");
      return +ta - +tb || ia.localeCompare(ib);
    });
    const colors = dark ? ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#fb923c"]
                        : ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#ea580c"];
    let ci = 0;
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
      legend: { type: "scroll", top: 0, textStyle: { color: pal.txt } },
      grid: { left: 52, right: 20, top: 40, bottom: 40 },
      xAxis: { type: "value", name: "秒", max: 60, ...axis },
      yAxis: { type: "value", name: "CPU %", max: 220, ...axis },
      series: phases.flatMap((k) => {
        const ss = cells[k]?.resSeries;
        if (!ss) return [];
        const pts = ss.filter((p: any) => p.container === cont).map((p: any) => [p.dt, p.cpu]);
        if (!pts.length) return [];
        const [img, , t] = k.split("|");
        const color = colors[ci++ % colors.length];
        return [{ name: `${img === "abA" ? "A" : "B"}·${t}`, type: "line", symbol: "none", smooth: true, lineStyle: { width: 1.6, color }, itemStyle: { color }, data: pts }];
      }),
    };
  }, [data, resChart, dark]);

  /* ---------- 资源峰值柱状图 ---------- */
  const peakBars = (metric: "cpu" | "mem") => {
    const cont = metric === "cpu" ? "mall-mysql" : "mall-svc-portal";
    const f = metric === "cpu" ? "cpuMax" : "memMax";
    const fmt = (v: number | null) => v === null ? null : metric === "cpu" ? Math.round(v / 100 * 100) / 100 : Math.round(v);
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (metric === "cpu" ? `${v} 核` : `${v} MiB`) },
      legend: { top: 0, textStyle: { color: pal.txt } },
      grid: { left: 56, right: 20, top: 40, bottom: 40 },
      xAxis: { type: "category", data: RUNGS.map((t) => `并发${t}`), ...axis },
      yAxis: { type: "value", name: metric === "cpu" ? "核" : "MiB", ...axis },
      series: [
        { name: "A", type: "bar", barMaxWidth: 26, itemStyle: { color: pal.a }, data: RUNGS.map((t) => fmt(cells[key("abA", "false", t)]?.res?.[cont]?.[f] ?? null)) },
        { name: "B", type: "bar", barMaxWidth: 26, itemStyle: { color: pal.b }, data: RUNGS.map((t) => fmt(cells[key("abB", "true", t)]?.res?.[cont]?.[f] ?? null)) },
      ],
    };
  };

  if (err) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">{err}</div></div>;
  }
  if (!data || !data.cells) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">加载中...</div></div>;
  }

  const byRung = data.byRung || [];

  return (
    <div className="shell">
      {/* ---------- 侧栏: 无样式文本按钮 ---------- */}
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

              <h3 className="mt-6 text-sm font-semibold text-muted-foreground">全档位趋势 · 有效TPS（成功请求/秒）</h3>
              <div className="mt-3 rounded-xl border bg-card p-4"><Chart option={scalability} height={360} /></div>

              <h3 className="mt-8 text-sm font-semibold text-muted-foreground">分接口错误率对比</h3>
              <div className="mt-3 flex items-center gap-3">
                <div className="seg">
                  {RUNGS.map((t) => (
                    <button key={t} className={cn(errRung === t && "on")} onClick={() => setErrRung(t)}>{t}</button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">并发档位</span>
              </div>
              <div className="mt-3 rounded-xl border bg-card p-3"><Chart option={errBars} height={300} /></div>

              <h3 className="mt-8 text-sm font-semibold text-muted-foreground">分接口错误率 / 超时明细（并发 {errRung}）</h3>
              <div className="mt-3 overflow-x-auto rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>接口</th>
                      <th className="text-right">A 错误%</th><th className="text-right">B 错误%</th>
                      <th className="text-right">A 超时次数</th><th className="text-right">B 超时次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.eps.map((ep: string) => {
                      const a = A(errRung)?.eps?.[ep], b = B(errRung)?.eps?.[ep];
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
              <h2 className="ink-title text-lg font-bold tracking-widest">吞吐</h2>

              <h3 className="mt-5 text-sm font-semibold text-muted-foreground">分接口有效TPS · 每档一张</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                {RUNGS.map((t) => (
                  <div key={`tps${t}`} className="rounded-xl border bg-card p-3">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">并发 {t}</div>
                    <Chart option={rungBars("tps", t)} height={280} />
                  </div>
                ))}
              </div>

              <h3 className="mt-8 text-sm font-semibold text-muted-foreground">分接口 P50 · 每档一张</h3>
              <div className="mt-3 grid grid-cols-2 gap-4">
                {RUNGS.map((t) => (
                  <div key={`p${t}`} className="rounded-xl border bg-card p-3">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">并发 {t}</div>
                    <Chart option={rungBars("p50", t)} height={280} />
                  </div>
                ))}
              </div>
            </section>

            {/* ============ SQL 层 ============ */}
            <section id="sql" className="l2section l2fade mt-14 scroll-mt-24">
              <h2 className="ink-title text-lg font-bold tracking-widest">SQL 层 · digest 差分</h2>
              <p className="mt-2 text-xs text-muted-foreground">performance_schema.events_statements_summary_by_digest 三点快照差分（A 组前/A 组末/B 组末），按总耗时排序 · SQL 文本 A/B 天然不同可分开归因</p>
              {[["A 原生基线", "A"], ["B 优化栈", "B"]].map(([label, k]) => (
                <div key={k} className="mt-5">
                  <h3 className="text-sm font-semibold text-muted-foreground">{label} · Top SQL（阶梯期间累计）</h3>
                  <div className="mt-2 overflow-x-auto rounded-xl border bg-card p-2">
                    <table className="dtable">
                      <thead>
                        <tr><th>SQL</th><th className="text-right">次数</th><th className="text-right">总耗时 s</th><th className="text-right">均耗 ms</th><th className="text-right">扫描行数</th></tr>
                      </thead>
                      <tbody>
                        {(data.sql?.[k] || []).map((s: any, i: number) => (
                          <tr key={i}>
                            <td className="whitespace-normal break-all text-left font-mono text-[11px]">{s.sql}</td>
                            <td className="l2num text-right">{s.count}</td>
                            <td className="l2num text-right">{num(s.totalS, 1)}</td>
                            <td className="l2num text-right">{num(s.avgMs, 2)}</td>
                            <td className="l2num text-right">{s.examined}</td>
                          </tr>
                        ))}
                        {!(data.sql?.[k] || []).length && <tr><td colSpan={5} className="text-center text-muted-foreground">无快照数据</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </section>

            {/* ============ 服务端延迟 ============ */}
            <section id="server" className="l2section l2fade mt-14 scroll-mt-24">
              <h2 className="text-base font-semibold">服务端延迟 · P95 (ms)</h2>
              <p className="mt-2 text-xs text-muted-foreground">Prometheus 直方图按相位窗口取值（JMeter 客户端视角之外的另一半）· /product/list 与深分页、/product/detail 与批量同 URI 合并统计</p>
              <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>相位</th>
                      {data.eps.map((ep: string) => <th key={ep} className="text-right">{short(ep)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(cells).sort((a, b) => {
                      const [ia, , ta] = a.split("|"), [ib, , tb] = b.split("|");
                      return +ta - +tb || ia.localeCompare(ib);
                    }).map((k) => {
                      const [img, vt, t] = k.split("|");
                      const sp = cells[k]?.serverP95?.portal || {};
                      return (
                        <tr key={k}>
                          <td className="l2num whitespace-nowrap">{img === "abA" ? "A" : "B"} · {t}{vt === "true" ? " · VT" : ""}</td>
                          {data.eps.map((ep: string) => (
                            <td key={ep} className="l2num text-right">{sp[ep] != null ? num(sp[ep], 0) : "—"}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ============ 资源峰值 ============ */}
            <section id="resource" className="l2section l2fade mt-14 mb-20 scroll-mt-24">
              <h2 className="ink-title text-lg font-bold tracking-widest">资源峰值</h2>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="rounded-xl border bg-card p-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">MySQL CPU 峰值（核）</div>
                  <Chart option={peakBars("cpu")} height={280} />
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Portal 内存峰值（MiB）</div>
                  <Chart option={peakBars("mem")} height={280} />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="seg">
                  {[["mysql", "MySQL"], ["redis", "Redis"], ["mongo", "Mongo"], ["gateway", "Gateway"], ["portal", "Portal"], ["admin", "Admin"], ["jmeter", "JMeter"]].map(([k, label]) => (
                    <button key={k} className={cn(resChart === k && "on")} onClick={() => setResChart(k as any)}>{label}</button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">CPU 时序（5s 粒度采样）</span>
              </div>
              <div className="mt-3 rounded-xl border bg-card p-3"><Chart option={resSeries} height={400} /></div>
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
