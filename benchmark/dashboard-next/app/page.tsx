"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/app/components/ui/table";
import { Separator } from "@/app/components/ui/separator";
import { cn } from "@/app/lib/utils";

function Chart({ option, height = 360 }: { option: any; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, null, { renderer: "canvas" });
    const onR = () => inst.current && inst.current.resize();
    window.addEventListener("resize", onR);
    return () => {
      window.removeEventListener("resize", onR);
      if (inst.current) inst.current.dispose();
    };
  }, []);
  useEffect(() => {
    if (inst.current && option) inst.current.setOption(option, true);
  }, [option]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

const RUNGS = [100, 200, 500, 1000];
const SECTIONS = [
  ["summary", "总体对比"],
  ["scalability", "并发扩展性"],
  ["latency", "接口延迟矩阵"],
  ["write", "写路径"],
  ["vt", "VT 归因"],
  ["resource", "资源消耗"],
  ["errors", "错误与超时"],
  ["notes", "数据说明"],
];
const C = { ink: "#171717", mid: "#737373" };
const AXIS = {
  axisLine: { lineStyle: { color: "#d4d4d4" } },
  axisLabel: { color: "#525252" },
  splitLine: { lineStyle: { color: "#ececec" } },
};
const ANIM = { animationDuration: 600, animationEasing: "cubicOut" as const };
const key = (img: string, vt: boolean | string, t: number) => `${img}|${vt}|${t}`;

function num(x: number | undefined, digits = 0, suffix = "") {
  if (x === undefined || x === null || isNaN(x)) return "—";
  return x.toFixed(digits) + suffix;
}

export default function ReportPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState("summary");
  const [showTop, setShowTop] = useState(false);
  const [resChart, setResChart] = useState<"mysql" | "portal">("mysql");

  useEffect(() => {
    fetch("/api/l2").then(async (r) => {
      if (!r.ok) setErr((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      else setData(await r.json());
    }).catch((e) => setErr(String(e)));
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
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [data]);

  const cells = data?.cells || {};
  const wcells = data?.writeCells || {};
  // 主对比: A 原生 vs B 完整优化栈(VT 开)
  const A = (t: number) => cells[key("abA", "false", t)];
  const B = (t: number) => cells[key("abB", "true", t)];
  const okSum = (c: any) => (c ? Object.values<any>(c.eps).reduce((s, e) => s + (e.okTps ?? e.tps), 0) : null);

  const scalability = useMemo(() => {
    if (!data) return null;
    const mk = (name: string, color: string, fn: (t: number) => number | null) => ({
      name, type: "line" as const, symbol: "circle", symbolSize: 7,
      lineStyle: { width: 2.4 }, itemStyle: { color }, data: RUNGS.map(fn),
    });
    return {
      ...ANIM,
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: "#525252" } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "category", data: RUNGS.map(String), name: "并发", ...AXIS },
      yAxis: { type: "value", name: "有效 TPS", ...AXIS },
      series: [
        mk("A 原生基线", C.ink, (t) => { const v = okSum(A(t)); return v === null ? null : Math.round(v); }),
        mk("B 优化栈", "#4b5563", (t) => { const v = okSum(B(t)); return v === null ? null : Math.round(v); }),
      ],
    };
  }, [data]);

  const resSeries = useMemo(() => {
    if (!data) return null;
    const cont = resChart === "mysql" ? "mall-mysql" : "mall-svc-portal";
    const phases = Object.keys(cells).sort((a, b) => {
      const [ia, va, ta] = a.split("|"), [ib, vb, tb] = b.split("|");
      return +ta - +tb || ia.localeCompare(ib);
    });
    const colors = ["#171717", "#737373", "#a3a3a3", "#d4d4d4", "#484848", "#8f8f8f", "#b8b8b8", "#dcdcdc"];
    let ci = 0;
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
      legend: { type: "scroll", top: 0, textStyle: { color: "#525252" } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "value", name: "秒", max: 60, ...AXIS },
      yAxis: { type: "value", name: "CPU %", ...AXIS },
      series: phases.flatMap((k) => {
        const ss = cells[k]?.resSeries;
        if (!ss) return [];
        const pts = ss.filter((p: any) => p.container === cont).map((p: any) => [p.dt, p.cpu]);
        if (!pts.length) return [];
        const [img, vt, t] = k.split("|");
        const color = colors[ci++ % colors.length];
        const label = img === "abA" ? `A·${t}` : `B·${t}·VT${vt === "true" ? "开" : "关"}`;
        return [{ name: label, type: "line", symbol: "none", smooth: true, lineStyle: { width: 1.6, color }, itemStyle: { color }, data: pts }];
      }),
    };
  }, [data, resChart]);

  if (err) {
    return <div className="l2shell flex min-h-screen items-center justify-center"><div className="text-sm text-muted-foreground">{err}</div></div>;
  }
  if (!data) {
    return <div className="l2shell flex min-h-screen items-center justify-center"><div className="text-sm text-muted-foreground">加载中...</div></div>;
  }

  const byRung = data.byRung || [];
  const main = (t: number) => {
    const a = byRung.find((r: any) => r.t === t && !r.vt);
    const b = byRung.find((r: any) => r.t === t && r.vt);
    return { a, b };
  };

  return (
    <div className="l2shell flex min-h-screen">
      <nav className="l2toc">
        <a href="#top" className="top">↑ 回到顶部</a>
        <div className="title">L2 阶梯对比</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={cn(active === id && "active")}>{label}</a>
        ))}
      </nav>

      <main className="flex-1 px-10 py-10">
        <div className="mx-auto max-w-4xl">
          <header id="top">
            <h1 className="text-xl font-bold tracking-tight">L2 全组合阶梯对比</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              A = 原作者整套（JDK 17 · SB 3.5.14） · B = 优化整套（JDK 25 · SB 4.0.8 · 索引 · VT 开） ·
              有效 TPS = 成功请求/秒 · {data.generatedAt}
            </p>
          </header>

          {/* 总体对比 */}
          <section id="summary" className="l2section l2fade mt-8 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">总体对比</h2>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {RUNGS.map((t) => {
                const b = main(t).b;
                return (
                  <Card key={t} className="transition-transform hover:-translate-y-0.5">
                    <CardHeader className="p-4 pb-2">
                      <CardDescription className="text-xs">并发 {t} · B / A</CardDescription>
                      <CardTitle className="l2num mt-1 text-2xl">{b ? num(b.bOverA, 1, "%") : "—"}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-xs text-muted-foreground l2num">
                      A {num(main(t).a?.tpsA, 0)} · B {num(b?.tpsB, 0)}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>并发</TableHead>
                  <TableHead className="text-right">A 有效 TPS</TableHead>
                  <TableHead className="text-right">B 有效 TPS</TableHead>
                  <TableHead className="text-right">B/A</TableHead>
                  <TableHead className="text-right">A 错误%</TableHead>
                  <TableHead className="text-right">B 错误%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RUNGS.map((t) => {
                  const a = A(t), b = B(t);
                  const r = main(t).b;
                  const errOf = (c: any) => {
                    if (!c) return null;
                    const tot = Object.values<any>(c.eps).reduce((s, e) => s + e.n, 0);
                    const er = Object.values<any>(c.eps).reduce((s, e) => s + (e.errPct / 100) * e.n, 0);
                    return tot ? (er / tot) * 100 : 0;
                  };
                  const [ea, eb] = [errOf(a), errOf(b)];
                  return (
                    <TableRow key={t}>
                      <TableCell className="l2num">{t}</TableCell>
                      <TableCell className="l2num text-right">{num(main(t).a?.tpsA, 0)}</TableCell>
                      <TableCell className="l2num text-right">{num(r?.tpsB, 0)}</TableCell>
                      <TableCell className="l2num text-right">{r ? <Badge variant={r.bOverA >= 100 ? "good" : "bad"}>{num(r.bOverA, 1, "%")}</Badge> : "—"}</TableCell>
                      <TableCell className={cn("l2num text-right", (ea ?? 0) >= 5 && "text-red-700")}>{num(ea, 1)}%</TableCell>
                      <TableCell className={cn("l2num text-right", (eb ?? 0) >= 5 ? "text-red-700" : "text-green-700")}>{num(eb, 1)}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>

          {/* 并发扩展性 */}
          <section id="scalability" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">并发扩展性</h2>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={scalability} height={380} /></CardContent></Card>
          </section>

          {/* 接口延迟矩阵 */}
          <section id="latency" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">接口延迟矩阵</h2>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>接口</TableHead>
                      {RUNGS.map((t) => (
                        <TableHead key={t} colSpan={2} className="text-center">并发 {t}</TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      {RUNGS.map((t) => (
                        <Fragment key={t}>
                          <TableHead className="text-right">A</TableHead>
                          <TableHead className="text-right">B</TableHead>
                        </Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eps.map((ep: string) => (
                      <TableRow key={ep}>
                        <TableCell className="whitespace-nowrap">{ep}</TableCell>
                        {RUNGS.map((t) => {
                          const a = A(t)?.eps?.[ep], b = B(t)?.eps?.[ep];
                          const shade = (v?: number) =>
                            a?.p50 && v ? (v <= a.p50 * 0.95 ? "text-green-700" : v >= a.p50 * 1.05 ? "text-red-700" : "text-muted-foreground") : "";
                          return (
                            <Fragment key={ep + t}>
                              <TableCell className={cn("l2num text-right", a && a.errPct >= 100 && "text-red-700 line-through")}>{a?.p50 ?? "—"}</TableCell>
                              <TableCell className={cn("l2num text-right font-semibold", shade(b?.p50))}>{b?.p50 ?? "—"}</TableCell>
                            </Fragment>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* 写路径 */}
          <section id="write" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">写路径（购物车读 / 收藏写）</h2>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>相位</TableHead>
                      <TableHead className="text-right">TPS</TableHead>
                      <TableHead className="text-right">P50 ms</TableHead>
                      <TableHead className="text-right">P99 ms</TableHead>
                      <TableHead className="text-right">成功%</TableHead>
                      <TableHead className="text-right">超时</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.keys(wcells).sort().map((k) => {
                      const [kind, vt, t] = k.split("|");
                      const w = wcells[k];
                      return (
                        <TableRow key={k}>
                          <TableCell className="whitespace-nowrap">
                            {kind === "cart" ? "购物车读" : "收藏写"} · {vt === "true" ? "VT开" : "VT关"} · <span className="l2num">{t}</span>
                          </TableCell>
                          <TableCell className="l2num text-right">{num(w.tps, 1)}</TableCell>
                          <TableCell className="l2num text-right">{num(w.p50, 0)}</TableCell>
                          <TableCell className="l2num text-right">{num(w.p99, 0)}</TableCell>
                          <TableCell className={cn("l2num text-right", w.okPct >= 99 ? "text-green-700" : "text-red-700")}>{num(w.okPct, 1)}%</TableCell>
                          <TableCell className="l2num text-right">{w.timeouts}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!Object.keys(wcells).length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">暂无写路径数据</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* VT 归因 */}
          <section id="vt" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">VT 归因（B 内部：开 vs 关）</h2>
            <Card className="mt-4">
              <CardContent className="p-5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>并发</TableHead>
                      <TableHead className="text-right">B·VT关 有效 TPS</TableHead>
                      <TableHead className="text-right">B·VT开 有效 TPS</TableHead>
                      <TableHead className="text-right">VT 收益</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RUNGS.map((t) => {
                      const off = byRung.find((r: any) => r.t === t && !r.vt);
                      const on = byRung.find((r: any) => r.t === t && r.vt);
                      const vt = off && on && off.tpsB ? (on.tpsB / off.tpsB) * 100 : null;
                      return (
                        <TableRow key={t}>
                          <TableCell className="l2num">{t}</TableCell>
                          <TableCell className="l2num text-right">{num(off?.tpsB, 0)}</TableCell>
                          <TableCell className="l2num text-right">{num(on?.tpsB, 0)}</TableCell>
                          <TableCell className="l2num text-right">{vt !== null ? <Badge variant={vt >= 100 ? "good" : "bad"}>{num(vt, 1, "%")}</Badge> : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* 资源消耗 */}
          <section id="resource" className="l2section l2fade mt-12 scroll-mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">资源消耗</h2>
              <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                {[["mysql", "MySQL"], ["portal", "Portal"]].map(([k, label]) => (
                  <button key={k} onClick={() => setResChart(k as any)}
                    className={cn("rounded px-3 py-1 transition-colors",
                      resChart === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {label} CPU
                  </button>
                ))}
              </div>
            </div>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={resSeries} height={420} /></CardContent></Card>
          </section>

          {/* 错误与超时 */}
          <section id="errors" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">错误与超时</h2>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>相位</TableHead>
                      <TableHead className="text-right">总错误%</TableHead>
                      <TableHead className="text-right">总超时</TableHead>
                      <TableHead>主要错误接口</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.keys(cells).sort().map((k) => {
                      const [img, vt, t] = k.split("|");
                      const eps = cells[k]?.eps || {};
                      const list = Object.entries<any>(eps).filter(([, e]) => e.errPct > 0)
                        .sort((a, b) => b[1].errPct - a[1].errPct).slice(0, 3);
                      const totN = Object.values<any>(eps).reduce((s, e) => s + e.n, 0);
                      const totE = Object.values<any>(eps).reduce((s, e) => s + (e.errPct / 100) * e.n, 0);
                      const tos = Object.values<any>(eps).reduce((s, e) => s + (e.timeouts || 0), 0);
                      const errPct = totN ? (totE / totN) * 100 : 0;
                      return (
                        <TableRow key={k}>
                          <TableCell className="l2num whitespace-nowrap">
                            {img === "abA" ? "A" : "B"} · {t} · VT{vt === "true" ? "开" : "关"}
                          </TableCell>
                          <TableCell className={cn("l2num text-right font-semibold", errPct >= 5 ? "text-red-700" : "text-green-700")}>
                            {num(errPct, 1)}%
                          </TableCell>
                          <TableCell className="l2num text-right">{tos}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {list.length ? list.map(([n, e]) => `${n.replace(/^(admin|portal)_/, "")}(${num(e.errPct, 0)}%)`).join("、") : "无"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* 数据说明 */}
          <section id="notes" className="l2section l2fade mt-12 mb-20 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">数据说明</h2>
            <Card className="mt-4">
              <CardContent className="space-y-2 p-5 text-xs leading-relaxed text-muted-foreground">
                <p>· 协议：整套方案对比。A = 原作者代码 + JDK 17 + SB 3.5.14（无 VT 能力，无 VT 变量）；B = 优化代码 + JDK 25 + SB 4.0.8 + sku 索引 + VT 开。</p>
                <p>· 口径：有效 TPS = 成功请求 ÷ 采样时长，错误请求不计入交付。A 的 detail/bulk 100% 错误为原生缺陷（null 属性分类崩溃），其贡献趋零由口径天然体现。</p>
                <p>· 已修复的原生缺陷：SKU 表缺 product_id 索引（4016ms→5ms）；收藏服务检查-插入竞态（B 侧唯一索引 + 幂等捕获）；收藏写接口无鉴权（记录未修，基线保持）；search 默认页 pageNum=0 空列表（B 已修）。</p>
                <p>· 噪声：共享开发机相位间 ±4%；结论看配对相位与峰值资源。阶梯完成自动出数（l2_emit.py）。</p>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>

      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 rounded-full border bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5"
        >
          ↑ 顶部
        </button>
      )}
    </div>
  );
}
