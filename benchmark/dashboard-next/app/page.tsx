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
  ["summary", "总体对比"], ["scalability", "并发扩展性"], ["latency", "接口延迟"],
  ["write", "写路径"], ["resource", "资源消耗"], ["errors", "错误与超时"], ["notes", "数据说明"],
];
const ANIM = { animationDuration: 600, animationEasing: "cubicOut" as const };
const key = (img: string, vt: string, t: number) => `${img}|${vt}|${t}`;

function num(x: any, d = 0, s = "") {
  return x === undefined || x === null || isNaN(x) ? "—" : x.toFixed(d) + s;
}
function pct(a: any, b: any) {
  if (!a || !b) return null;
  return ((b / a - 1) * 100);
}
function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v === null) return <span className="l2num text-muted-foreground">—</span>;
  const cls = (v >= 0 ? (invert ? "text-red-500" : "text-emerald-500") : (invert ? "text-emerald-500" : "text-red-500"));
  return (
    <span className={cn("l2num font-semibold", cls)}>
      {v > 0 ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
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
    ? { txt: "#94a3b8", grid: "#1e293b", a: "#64748b", b: "#60a5fa", tipBg: "#0f172a", tipTx: "#e2e8f0" }
    : { txt: "#64748b", grid: "#f1f5f9", a: "#94a3b8", b: "#2563eb", tipBg: "#ffffff", tipTx: "#0f172a" };
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

  /* ---------- 资源时序 ---------- */
  const resSeries = useMemo(() => {
    if (!data) return null;
    const cont = resChart === "mysql" ? "mall-mysql" : "mall-svc-portal";
    const phases = Object.keys(cells).sort((a, b) => {
      const [ia, , ta] = a.split("|"), [ib, , tb] = b.split("|");
      return +ta - +tb || ia.localeCompare(ib);
    });
    const colors = dark
      ? ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#fb923c"]
      : ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#ea580c"];
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
        const color = colors[ci++ % colors.length];
        return [{ name: `${img === "abA" ? "A" : "B"}·${t}`, type: "line", symbol: "none", smooth: true, lineStyle: { width: 1.8, color }, itemStyle: { color }, data: pts }];
      }),
    };
  }, [data, resChart, dark]);

  if (err) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">{err}</div></div>;
  }
  if (!data || !data.cells) {
    return <div className="shell items-center justify-center"><div className="text-sm text-muted-foreground">加载中...</div></div>;
  }

  const byRung = data?.byRung || [];

  return (
    <div className="shell">
      {/* ---------- 墨栏 ---------- */}
      <nav className="sidenav">
        <div className="brand">L2 阶梯对比</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={cn(active === id && "active")}>{label}</a>
        ))}
        <div className="mt-auto px-3 text-[11px] text-muted-foreground">{data ? `${data.complete}/${data.expected} 相位` : ""}</div>
      </nav>

      {/* ---------- 纸面 ---------- */}
      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background/80 px-8 py-3 backdrop-blur">
          <span className="text-sm font-bold tracking-tight">mall-swarm L2 全组合阶梯</span>
          <div className="ml-auto flex items-center gap-2">
            <select className="tsel" value={run} onChange={(e) => { setRun(e.target.value); load(e.target.value); }}>
              <option value="">最新运行</option>
              {runs.map((r) => <option key={r.id} value={r.id}>运行 {r.id}（{r.generatedAt}）</option>)}
            </select>
            <button className="tbtn" onClick={toggleTheme}>{dark ? "亮色" : "暗色"}</button>
          </div>
        </div>

        <div className="content">
          <div className="inner">
            {/* 总体对比: 全指标百分比 */}
            <section id="summary" className="l2section l2fade scroll-mt-20 pt-2">
              <h2 className="text-base font-semibold">总体对比 · 全指标</h2>
              <div className="mt-4 grid grid-cols-4 gap-3">
                {RUNGS.map((t) => {
                  const a = A(t), b = B(t);
                  const p = pct(okSum(a), okSum(b));
                  return (
                    <div key={t} className="rounded-xl border bg-card p-4 transition-transform hover:-translate-y-0.5">
                      <div className="text-xs text-muted-foreground">并发 {t} · 有效TPS B/A</div>
                      <div className="l2num mt-1 text-3xl font-bold tracking-tight">
                        {p === null ? "—" : <span className={p >= 0 ? "text-emerald-500" : "text-red-500"}>{p >= 0 ? "+" : ""}{p.toFixed(1)}%</span>}
                      </div>
                      <div className="l2num mt-1 text-xs text-muted-foreground">
                        A {num(okSum(a), 0)} · B {num(okSum(b), 0)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr><th>指标</th><th>A 原生</th><th>B 优化栈</th><th>Δ% (B/A)</th></tr>
                  </thead>
                  <tbody>
                    <tr className="bg-secondary/40"><td colSpan={4} className="font-semibold">吞吐（有效 TPS = 成功请求/秒）</td></tr>
                    {RUNGS.map((t) => {
                      const a = A(t), b = B(t);
                      const p = pct(okSum(a), okSum(b));
                      return (
                        <tr key={`tps${t}`}>
                          <td>├ 并发 {t} 总有效 TPS</td>
                          <td className="l2num">{num(okSum(a), 1)}</td>
                          <td className="l2num">{num(okSum(b), 1)}</td>
                          <td><Delta v={p} /></td>
                        </tr>
                      );
                    })}
                    {data.eps.map((ep: string) => {
                      const a = A(500)?.eps?.[ep], b = B(500)?.eps?.[ep];
                      return (
                        <Fragment key={`e${ep}`}>
                          <tr>
                            <td>├ {ep} · 有效TPS @500</td>
                            <td className="l2num">{num(a?.okTps ?? a?.tps, 1)}</td>
                            <td className="l2num">{num(b?.okTps ?? b?.tps, 1)}</td>
                            <td><Delta v={pct(a?.okTps ?? a?.tps, b?.okTps ?? b?.tps)} /></td>
                          </tr>
                          <tr>
                            <td>├ {ep} · P50 @500</td>
                            <td className="l2num">{num(a?.p50, 0)}</td>
                            <td className="l2num">{num(b?.p50, 0)}</td>
                            <td><Delta v={pct(a?.p50, b?.p50)} invert /></td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    <tr className="bg-secondary/40"><td colSpan={4} className="font-semibold">写路径 @各档</td></tr>
                    {RUNGS.map((t) => {
                      const ac = wc[`coll|abA|${t}`], bc = wc[`coll|abB|${t}`];
                      const ak = wc[`cart|abA|${t}`], bk = wc[`cart|abB|${t}`];
                      return (
                        <Fragment key={`w${t}`}>
                          <tr>
                            <td>├ 收藏写 TPS @并发{t}</td>
                            <td className="l2num">{num(ac?.okTps, 1)}</td>
                            <td className="l2num">{num(bc?.okTps, 1)}</td>
                            <td><Delta v={pct(ac?.okTps, bc?.okTps)} /></td>
                          </tr>
                          <tr>
                            <td>├ 购物车读 TPS @并发{t}</td>
                            <td className="l2num">{num(ak?.okTps, 1)}</td>
                            <td className="l2num">{num(bk?.okTps, 1)}</td>
                            <td><Delta v={pct(ak?.okTps, bk?.okTps)} /></td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    <tr className="bg-secondary/40"><td colSpan={4} className="font-semibold">资源峰值（5s 粒度采样）</td></tr>
                    {RUNGS.map((t) => {
                      const a = A(t), b = B(t);
                      const am = a?.res?.["mall-mysql"]?.cpuMax, bm = b?.res?.["mall-mysql"]?.cpuMax;
                      const ap = a?.res?.["mall-svc-portal"]?.memMax, bp = b?.res?.["mall-svc-portal"]?.memMax;
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
            <section id="scalability" className="l2section l2fade mt-12 scroll-mt-24">
              <h2 className="text-base font-semibold">并发扩展性 · 有效TPS</h2>
              <div className="mt-4 rounded-xl border bg-card p-4"><Chart option={scalability} height={380} /></div>
            </section>

            {/* 延迟矩阵 */}
            <section id="latency" className="l2section l2fade mt-12 scroll-mt-24">
              <h2 className="text-base font-semibold">接口延迟矩阵 · P50 (ms)</h2>
              <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>接口</th>
                      {RUNGS.map((t) => <Fragment key={t}><th className="text-right">A @{t}</th><th className="text-right">B @{t}</th></Fragment>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.eps.map((ep: string) => (
                      <tr key={ep}>
                        <td className="whitespace-nowrap">{ep}</td>
                        {RUNGS.map((t) => {
                          const a = A(t)?.eps?.[ep], b = B(t)?.eps?.[ep];
                          const shade = (v?: number) =>
                            a?.p50 && v ? (v <= a.p50 * 0.95 ? "text-emerald-500 font-semibold" : v >= a.p50 * 1.05 ? "text-red-500 font-semibold" : "") : "";
                          return (
                            <Fragment key={ep + t}>
                              <td className={cn("l2num text-right", a && a.errPct >= 100 && "text-red-500 line-through")}>{a?.p50 ?? "—"}</td>
                              <td className={cn("l2num text-right", shade(b?.p50))}>{b?.p50 ?? "—"}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 写路径 */}
            <section id="write" className="l2section l2fade mt-12 scroll-mt-24">
              <h2 className="text-base font-semibold">写路径 · 收藏写 TPS</h2>
              <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
                <table className="dtable">
                  <thead>
                    <tr><th>并发</th><th className="text-right">A 收藏写</th><th className="text-right">B 收藏写</th><th className="text-right">Δ%</th><th className="text-right">A 购物车读</th><th className="text-right">B 购物车读</th><th className="text-right">Δ%</th></tr>
                  </thead>
                  <tbody>
                    {RUNGS.map((t) => {
                      const ac = wc[`coll|abA|${t}`], bc = wc[`coll|abB|${t}`];
                      const ak = wc[`cart|abA|${t}`], bk = wc[`cart|abB|${t}`];
                      const pc = pct(ac?.okTps, bc?.okTps), pk = pct(ak?.okTps, bk?.okTps);
                      return (
                        <tr key={t}>
                          <td className="l2num">{t}</td>
                          <td className="l2num text-right">{num(ac?.okTps, 1)}</td>
                          <td className="l2num text-right">{num(bc?.okTps, 1)}</td>
                          <td className="text-right"><Delta v={pc} /></td>
                          <td className="l2num text-right">{num(ak?.okTps, 1)}</td>
                          <td className="l2num text-right">{num(bk?.okTps, 1)}</td>
                          <td className="text-right"><Delta v={pk} /></td>
                        </tr>
                      );
                    })}
                    {!Object.keys(wc).length && <tr><td colSpan={7} className="text-center text-muted-foreground">暂无写路径数据</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 资源 */}
            <section id="resource" className="l2section l2fade mt-12 scroll-mt-24">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">资源消耗 · CPU 时序（5s 粒度）</h2>
                <div className="flex gap-1 rounded-lg border p-0.5 text-xs">
                  {[["mysql", "MySQL"], ["portal", "Portal"]].map(([k, label]) => (
                    <button key={k} onClick={() => setResChart(k as any)}
                      className={cn("rounded-md px-3 py-1.5 transition-colors", resChart === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 rounded-xl border bg-card p-4"><Chart option={resSeries} height={420} /></div>
            </section>

            {/* 错误 */}
            <section id="errors" className="l2section l2fade mt-12 scroll-mt-24">
              <h2 className="text-base font-semibold">错误与超时</h2>
              <div className="mt-4 overflow-x-auto rounded-xl border bg-card p-2">
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
                          <td className="l2num whitespace-nowrap">{img === "abA" ? "A" : "B"} · {t}{vt === "true" ? " · VT" : ""}</td>
                          <td className={cn("l2num text-right font-semibold", errPct >= 5 ? "text-red-500" : "text-emerald-500")}>{num(errPct, 1)}%</td>
                          <td className="l2num text-right">{tos}</td>
                          <td className="text-xs text-muted-foreground">{list.length ? list.map(([n, e]) => `${n.replace(/^(admin|portal)_/, "")}(${num(e.errPct, 0)}%)`).join("、") : "无"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 说明 */}
            <section id="notes" className="l2section l2fade mt-12 mb-20 scroll-mt-24">
              <h2 className="text-base font-semibold">数据说明</h2>
              <div className="mt-4 space-y-2 rounded-xl border bg-card p-5 text-xs leading-relaxed text-muted-foreground">
                <p>· 协议：整套方案对比。A = 原作者代码 + JDK 17 + SB 3.5.14；B = 优化代码 + JDK 25 + SB 4.0.8 + sku 索引 + VT。VT 开关不属于本协议（JDK 17 无 Loom；历史 VT-关 运行作为独立实验归档于 runs/）。</p>
                <p>· 内部校准数据：B 关闭 VT 时总有效 TPS 较开启低 29~65%（随并发放大），已归档不参与本页对比。</p>
                <p>· 口径：有效 TPS = 成功请求 ÷ 时长；错误请求不计入交付（A 的 detail/bulk 100% 错误为原生缺陷，吞吐贡献趋零由口径天然体现）。</p>
                <p>· 已修复缺陷：sku 表缺 product_id 索引（4016ms→5ms）；收藏竞态（B 唯一索引+幂等）；search 默认页空列表（B 修 pageNum）。已记录未修（基线保持）：收藏接口无鉴权。</p>
                <p>· 噪声：共享开发机相位间 ±4%；结论看配对相位与峰值资源。阶梯完成自动归档至 runs/。</p>
              </div>
            </section>
          </div>
        </div>
      </div>

      {showTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5">
          ↑ 顶部
        </button>
      )}
    </div>
  );
}
