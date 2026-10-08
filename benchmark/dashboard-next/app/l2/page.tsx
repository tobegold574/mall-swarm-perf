"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/app/components/ui/table";
import { Separator } from "@/app/components/ui/separator";
import { cn } from "@/app/lib/utils";

/* ---------- ECharts 包装(沿用首页模式) ---------- */
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

/* ---------- 常量 ---------- */
const RUNGS = [100, 200, 500, 1000];
const SECTIONS = [
  ["summary", "总体对比"],
  ["scalability", "并发扩展性"],
  ["latency", "接口延迟矩阵"],
  ["vt", "虚拟线程效应"],
  ["resource", "资源消耗"],
  ["errors", "错误与超时"],
  ["notes", "数据说明"],
];
const C = { ink: "#171717", mid: "#737373", light: "#a3a3a3", grid: "#ececec" };
const AXIS = {
  axisLine: { lineStyle: { color: "#d4d4d4" } },
  axisLabel: { color: "#525252" },
  splitLine: { lineStyle: { color: "#ececec" } },
};
const ANIM = { animationDuration: 600, animationEasing: "cubicOut" as const };
const key = (img: string, vt: boolean, t: number) => `${img}|${vt}|${t}`;

function num(x: number | undefined, digits = 0, suffix = "") {
  if (x === undefined || x === null || isNaN(x)) return "—";
  return x.toFixed(digits) + suffix;
}

export default function L2Page() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState("summary");
  const [showTop, setShowTop] = useState(false);
  const [latVt, setLatVt] = useState(false);
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

  /* ---------- 派生数据 ---------- */
  const scalability = useMemo(() => {
    if (!data) return null;
    const mk = (img: string, vt: boolean) => ({
      name: `${img === "abA" ? "A原生" : "B优化"}·VT${vt ? "开" : "关"}`,
      type: "line" as const,
      symbol: "circle",
      symbolSize: 7,
      lineStyle: { width: 2, type: vt ? "dashed" : "solid" as const },
      itemStyle: { color: img === "abA" ? (vt ? C.light : C.ink) : vt ? C.light : C.mid },
      data: RUNGS.map((t) => {
        const c = cells[key(img, vt, t)];
        if (!c) return null;
        return Math.round(Object.values<any>(c.eps).reduce((s, e) => s + e.tps, 0));
      }),
    });
    return {
      ...ANIM,
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: "#525252" } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "category", data: RUNGS.map(String), name: "并发", ...AXIS },
      yAxis: { type: "value", name: "总 TPS", ...AXIS },
      series: [mk("abA", false), mk("abB", false), mk("abA", true), mk("abB", true)],
    };
  }, [data]);

  const vtDelta = useMemo(() => {
    if (!data) return null;
    // 每个(变体,档位): 各接口 P50 VT开相对VT关 的变化%( 正=恶化 )
    const mk = (img: string, t: number, name: string, color: string) => ({
      name, type: "bar" as const, barMaxWidth: 14,
      itemStyle: { color },
      data: data.eps.map((ep: string) => {
        const off = cells[key(img, "false", t)]?.eps?.[ep]?.p50;
        const on = cells[key(img, "true", t)]?.eps?.[ep]?.p50;
        if (!off || !on) return null;
        return Math.round((on / off - 1) * 100);
      }),
    });
    return {
      ...ANIM,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
      legend: { top: 0, textStyle: { color: "#525252" } },
      grid: { left: 56, right: 24, top: 44, bottom: 92 },
      xAxis: { type: "category", data: data.eps.map((e: string) => e.replace(/^(admin|portal)_/, "")), ...AXIS, axisLabel: { ...AXIS.axisLabel, rotate: 32, interval: 0 } },
      yAxis: { type: "value", name: "VT开 P50 变化%", ...AXIS },
      series: [
        mk("abA", 100, "A·100", C.light), mk("abA", 1000, "A·1000", C.ink),
        mk("abB", 100, "B·100", "#c9c9c9"), mk("abB", 1000, "B·1000", C.mid),
      ],
    };
  }, [data]);

  const resSeries = useMemo(() => {
    if (!data) return null;
    const cont = resChart === "mysql" ? "mall-mysql" : "mall-svc-portal";
    const phases = Object.keys(cells).sort((a, b) => {
      const [ia, va, ta] = a.split("|"), [ib, vb, tb] = b.split("|");
      return +ta - +tb || ia.localeCompare(ib) || (va === "true" ? 1 : -1) - (vb === "true" ? 1 : -1);
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
        return [{
          name: `${img === "abA" ? "A" : "B"}·${t}·VT${vt === "true" ? "开" : "关"}`,
          type: "line", symbol: "none", smooth: true,
          lineStyle: { width: 1.6, color }, itemStyle: { color }, data: pts,
        }];
      }),
    };
  }, [data, resChart]);

  if (err) {
    return (
      <div className="l2shell flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">{err}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="l2shell flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const fresh = data.phases?.length || 0;
  const byRung = data.byRung || [];
  const bWins = byRung.filter((r: any) => r.bOverA >= 100).length;

  return (
    <div className="l2shell flex min-h-screen">
      {/* ---------- 左侧 sticky 目录 ---------- */}
      <nav className="l2toc">
        <a href="#top" className="top">↑ 回到顶部</a>
        <div className="title">L2 全组合阶梯</div>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={cn(active === id && "active")}>{label}</a>
        ))}
        <Separator className="my-3" />
        <a href="/" className="text-xs">← 返回总看板</a>
      </nav>

      {/* ---------- 居中内容 ---------- */}
      <main className="flex-1 px-10 py-10">
        <div className="mx-auto max-w-4xl">
          <header id="top" className="l2fade">
            <h1 className="text-xl font-bold tracking-tight">L2 全组合阶梯对比报告</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              A=abA 原作者基线 · B=abB 优化版 · 变体 × 并发 100/200/500/1000 × VT 开/关 ·
              采样窗口 45s · MySQL 2 核配额 · 生成于 {data.generatedAt} · 相位 {fresh}/{data.expected}
            </p>
          </header>

          {/* ============ 总体对比 ============ */}
          <section id="summary" className="l2section l2fade mt-8 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">总体对比差距</h2>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {byRung.filter((r: any) => !r.vt).map((r: any) => (
                <Card key={r.t} className="transition-transform hover:-translate-y-0.5">
                  <CardHeader className="p-4 pb-2">
                    <CardDescription className="text-xs">并发 {r.t} · VT关 · B/A 总吞吐</CardDescription>
                    <CardTitle className="l2num mt-1 text-2xl">
                      {num(r.bOverA, 1, "%")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-xs text-muted-foreground l2num">
                    A {num(r.tpsA, 1)} → B {num(r.tpsB, 1)} TPS
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="mt-4">
              <CardContent className="p-5">
                <div className="text-sm leading-relaxed">
                  {byRung.length ? (
                    <>
                      八组相位（4 档并发 × VT 开/关）中，B 总吞吐不低于 A 的有{" "}
                      <span className="l2num font-semibold">{bWins}</span> 组；
                      单接口延迟判定见<a href="#latency" className="underline decoration-dotted underline-offset-4">延迟矩阵</a>，
                      结论受共享开发机噪声影响，配对相位（相邻窗口）的差值才可归因。
                    </>
                  ) : "无数据"}
                </div>
              </CardContent>
            </Card>
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>并发</TableHead><TableHead>VT</TableHead>
                  <TableHead className="text-right">A 总 TPS</TableHead>
                  <TableHead className="text-right">B 总 TPS</TableHead>
                  <TableHead className="text-right">B/A</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byRung.map((r: any) => (
                  <TableRow key={`${r.t}-${r.vt}`}>
                    <TableCell className="l2num">{r.t}</TableCell>
                    <TableCell>{r.vt ? "开" : "关"}</TableCell>
                    <TableCell className="l2num text-right">{num(r.tpsA, 1)}</TableCell>
                    <TableCell className="l2num text-right">{num(r.tpsB, 1)}</TableCell>
                    <TableCell className="l2num text-right">
                      <Badge variant={r.bOverA >= 100 ? "good" : "bad"}>{num(r.bOverA, 1, "%")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          {/* ============ 并发扩展性 ============ */}
          <section id="scalability" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">并发扩展性</h2>
            <p className="mt-1 text-xs text-muted-foreground">10 接口混合负载下的全链路总吞吐（实线=VT关，虚线=VT开）</p>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={scalability} height={380} /></CardContent></Card>
          </section>

          {/* ============ 接口延迟矩阵 ============ */}
          <section id="latency" className="l2section l2fade mt-12 scroll-mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">接口延迟矩阵</h2>
              <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                {[false, true].map((v) => (
                  <button key={String(v)} onClick={() => setLatVt(v)}
                    className={cn("rounded px-3 py-1 transition-colors",
                      latVt === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    VT{v ? "开" : "关"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">P50 ms · 每格 A | B | B 相对 A（绿=B 更快，红=B 更慢）</p>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>接口</TableHead>
                      {RUNGS.map((t) => (
                        <TableHead key={t} colSpan={3} className="text-center">
                          并发 {t}
                        </TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      {RUNGS.map((t) => (
                        <Fragment key={t}>
                          <TableHead className="text-right">A</TableHead>
                          <TableHead className="text-right">B</TableHead>
                          <TableHead className="text-right">Δ</TableHead>
                        </Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eps.map((ep: string) => (
                      <TableRow key={ep}>
                        <TableCell className="whitespace-nowrap">{ep}</TableCell>
                        {RUNGS.map((t) => {
                          const a = cells[key("abA", latVt, t)]?.eps?.[ep]?.p50;
                          const b = cells[key("abB", latVt, t)]?.eps?.[ep]?.p50;
                          const d = a && b ? Math.round((b / a - 1) * 100) : null;
                          return (
                            <Fragment key={ep + t}>
                              <TableCell className="l2num text-right">{a ?? "—"}</TableCell>
                              <TableCell className="l2num text-right">{b ?? "—"}</TableCell>
                              <TableCell className={cn("l2num text-right font-semibold",
                                d === null ? "" : d <= -5 ? "text-green-700" : d >= 5 ? "text-red-700" : "text-muted-foreground")}>
                                {d === null ? "—" : `${d > 0 ? "+" : ""}${d}%`}
                              </TableCell>
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

          {/* ============ 虚拟线程效应 ============ */}
          <section id="vt" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">虚拟线程效应</h2>
            <p className="mt-1 text-xs text-muted-foreground">同变体同并发下，VT 开启后 P50 的变化%（正值=恶化）；历史结论：VT 曾实测负优化，本轮为复验</p>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={vtDelta} height={380} /></CardContent></Card>
          </section>

          {/* ============ 资源消耗 ============ */}
          <section id="resource" className="l2section l2fade mt-12 scroll-mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">资源消耗</h2>
              <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                {[["mysql", "MySQL"], ["portal", "Portal"]].map(([k, label]) => (
                  <button key={k} onClick={() => setResChart(k as any)}
                    className={cn("rounded px-3 py-1 transition-colors",
                      resChart === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {label} CPU 时序
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">每相位 5s 粒度采样（res_*.csv）· 点击图例开关节点 · 看峰值不看均值</p>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={resSeries} height={420} /></CardContent></Card>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>相位</TableHead>
                      {["mall-mysql", "mall-svc-portal", "mall-gateway", "jmeter"].map((c) => (
                        <TableHead key={c} colSpan={2} className="text-center">{c.replace("mall-svc-", "").replace("mall-", "")}</TableHead>
                      ))}
                      <TableHead className="text-right">portal 内存峰值</TableHead>
                    </TableRow>
                    <TableRow>
                      {["mall-mysql", "mall-svc-portal", "mall-gateway", "jmeter"].flatMap((c) => (
                        [<TableHead key={c + "a"} className="text-right">均值</TableHead>,
                         <TableHead key={c + "b"} className="text-right">峰值</TableHead>]
                      ))}
                      <TableHead className="text-right">MiB</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.keys(cells).sort((a, b) => {
                      const [ia, va, ta] = a.split("|"), [ib, vb, tb] = b.split("|");
                      return +ta - +tb || ia.localeCompare(ib);
                    }).map((k) => {
                      const [img, vt, t] = k.split("|");
                      const r = cells[k]?.res || {};
                      const g = (c: string, f: string) => (r[c] ? num(r[c][f] / 100, 2) : "—");
                      return (
                        <TableRow key={k}>
                          <TableCell className="l2num whitespace-nowrap">
                            {img === "abA" ? "A" : "B"} · {t} · VT{vt === "true" ? "开" : "关"}
                          </TableCell>
                          {["mall-mysql", "mall-svc-portal", "mall-gateway", "jmeter"].map((c) => (
                            <Fragment key={k + c}>
                              <TableCell className="l2num text-right">{g(c, "cpuAvg")}</TableCell>
                              <TableCell className="l2num text-right">{g(c, "cpuMax")}</TableCell>
                            </Fragment>
                          ))}
                          <TableCell className="l2num text-right">
                            {r["mall-svc-portal"] ? num(r["mall-svc-portal"].memMax, 0) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* ============ 错误与超时 ============ */}
          <section id="errors" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">错误与超时</h2>
            <p className="mt-1 text-xs text-muted-foreground">错误% = 非 200 响应占比（含 45s 超时）· 超时单列</p>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>相位</TableHead>
                      <TableHead className="text-right">总错误%</TableHead>
                      <TableHead className="text-right">总超时次数</TableHead>
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

          {/* ============ 数据说明 ============ */}
          <section id="notes" className="l2section l2fade mt-12 mb-20 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">数据说明</h2>
            <Card className="mt-4">
              <CardContent className="space-y-2 p-5 text-xs leading-relaxed text-muted-foreground">
                <p>· 数据源：benchmark/jtl/l2_*.jtl（JMeter 结果）+ res_*.csv（5s 粒度全容器 CPU/内存采样），由 l2_emit.py 聚合。</p>
                <p>· 装置修正（本轮已生效）：bulk_detail 换有效 id 100044；search 换真实关键词+pageNum=1；MySQL 配额 1c→2c；Druid 池 20→50；master search 默认页 pageNum 0→1。</p>
                <p>· 已知事实：abA 详情页对无属性分类商品确定性 500（原生 Example 不容忍 null，属原版缺陷，基线分支保持原样）。</p>
                <p>· 噪声声明：共享开发机，单相位读吞吐波动可达 2~3 倍；结论看配对相位差值与峰值资源，不抠单点数字。</p>
                <p>· 相位数据时间：{Object.keys(cells).sort().map((k) => cells[k].mtime ? `${k.replace(/\|/g, "·")}(${cells[k].mtime})` : null).filter(Boolean).join("， ")}</p>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>

      {/* ---------- 回到顶部悬浮 ---------- */}
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
