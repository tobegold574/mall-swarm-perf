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
  ["vt", "VT 增量归因"],
  ["write", "写路径(购物车/收藏)"],
  ["resource", "资源消耗"],
  ["errors", "错误与超时"],
  ["notes", "数据说明"],
];
const C = { ink: "#171717", mid: "#737373", light: "#a3a3a3" };
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

export default function L2Page() {
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

  /* ---------- 派生: 扩展性曲线(A 原生单线 + B 双态) ---------- */
  const scalability = useMemo(() => {
    if (!data) return null;
    const mk = (name: string, color: string, dash: boolean, fn: (t: number) => number | null) => ({
      name, type: "line" as const, symbol: "circle", symbolSize: 7,
      lineStyle: { width: 2, type: dash ? "dashed" : "solid" },
      itemStyle: { color }, data: RUNGS.map(fn),
    });
    const tot = (k: string) => {
      const c = cells[k];
      return c ? Math.round(Object.values<any>(c.eps).reduce((s, e) => s + e.tps, 0)) : null;
    };
    return {
      ...ANIM,
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: "#525252" } },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "category", data: RUNGS.map(String), name: "并发", ...AXIS },
      yAxis: { type: "value", name: "总 TPS", ...AXIS },
      series: [
        mk("A 原生基线(JDK17·无VT)", C.ink, false, (t) => tot(key("abA", "false", t))),
        mk("B 优化·VT关", C.mid, true, (t) => tot(key("abB", "false", t))),
        mk("B 优化·VT开", "#525252", false, (t) => tot(key("abB", "true", t))),
      ],
    };
  }, [data]);

  /* ---------- 派生: VT 增量(B 开 vs 关) ---------- */
  const vtDelta = useMemo(() => {
    if (!data) return null;
    const mk = (t: number, name: string, color: string) => ({
      name, type: "bar" as const, barMaxWidth: 16, itemStyle: { color },
      data: data.eps.map((ep: string) => {
        const off = cells[key("abB", "false", t)]?.eps?.[ep]?.p50;
        const on = cells[key("abB", "true", t)]?.eps?.[ep]?.p50;
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
      series: [mk(100, "并发100", C.light), mk(500, "并发500", C.mid), mk(1000, "并发1000", C.ink)],
    };
  }, [data]);

  /* ---------- 派生: 资源时序 ---------- */
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

  const fresh = data.phases?.length || 0;
  const byRung = data.byRung || [];
  const rungOn = (t: number) => byRung.find((r: any) => r.t === t && r.vt);
  const rungOff = (t: number) => byRung.find((r: any) => r.t === t && !r.vt);

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
              A = 原生基线（原作者代码 · JDK 17 · SB 3.5.14 · 无 VT 能力）·
              B = 优化栈（迁移 + JDK 25 · SB 4.0.8 · 索引 · VT）·
              并发 100/200/500/1000 · 采样窗口 45s · MySQL 2 核 · 生成于 {data.generatedAt} · 相位 {fresh}/{data.expected}
            </p>
          </header>

          {/* ============ 总体对比: A → B·VT关 → B·VT开 ============ */}
          <section id="summary" className="l2section l2fade mt-8 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">总体对比差距</h2>
            <p className="mt-1 text-xs text-muted-foreground">归因链：A → B·VT关 = 框架迁移+代码优化+索引 的收益；B·VT关 → B·VT开 = 虚拟线程的收益</p>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {RUNGS.map((t) => {
                const on = rungOn(t), off = rungOff(t);
                return (
                  <Card key={t} className="transition-transform hover:-translate-y-0.5">
                    <CardHeader className="p-4 pb-2">
                      <CardDescription className="text-xs">并发 {t} · B 完整栈 / A</CardDescription>
                      <CardTitle className="l2num mt-1 text-2xl">{on ? num(on.bOverA, 1, "%") : "—"}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-xs text-muted-foreground l2num">
                      <div>A {num(off?.tpsA, 0)}</div>
                      <div>B·VT关 {num(off?.tpsB, 0)} · B·VT开 {num(on?.tpsB, 0)}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>并发</TableHead>
                  <TableHead className="text-right">A 原生</TableHead>
                  <TableHead className="text-right">B·VT关</TableHead>
                  <TableHead className="text-right">B·VT开</TableHead>
                  <TableHead className="text-right">迁移+代码收益<br />(B关/A)</TableHead>
                  <TableHead className="text-right">VT收益<br />(B开/B关)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RUNGS.map((t) => {
                  const off = rungOff(t), on = rungOn(t);
                  const code = off && off.tpsB && off.tpsA ? (off.tpsB / off.tpsA) * 100 : null;
                  const vt = off && on && off.tpsB ? (on.tpsB / off.tpsB) * 100 : null;
                  return (
                    <TableRow key={t}>
                      <TableCell className="l2num">{t}</TableCell>
                      <TableCell className="l2num text-right">{num(off?.tpsA, 0)}</TableCell>
                      <TableCell className="l2num text-right">{num(off?.tpsB, 0)}</TableCell>
                      <TableCell className="l2num text-right">{num(on?.tpsB, 0)}</TableCell>
                      <TableCell className="l2num text-right">{code !== null ? <Badge variant={code >= 100 ? "good" : "bad"}>{num(code, 1, "%")}</Badge> : "—"}</TableCell>
                      <TableCell className="l2num text-right">{vt !== null ? <Badge variant={vt >= 100 ? "good" : "bad"}>{num(vt, 1, "%")}</Badge> : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>

          {/* ============ 并发扩展性 ============ */}
          <section id="scalability" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">并发扩展性</h2>
            <p className="mt-1 text-xs text-muted-foreground">10 接口混合负载总吞吐 · A 为原生单线（无 VT 维度）· B 虚线=VT关、实线=VT开</p>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={scalability} height={380} /></CardContent></Card>
          </section>

          {/* ============ 接口延迟矩阵 ============ */}
          <section id="latency" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">接口延迟矩阵</h2>
            <p className="mt-1 text-xs text-muted-foreground">P50 ms · 每 rung 三列：A 原生 | B·VT关 | B·VT开（A 的 detail/bulk 100% 错误为原生缺陷，基线保持原样）</p>
            <Card className="mt-4 overflow-x-auto">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>接口</TableHead>
                      {RUNGS.map((t) => (
                        <TableHead key={t} colSpan={3} className="text-center">并发 {t}</TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      {RUNGS.map((t) => (
                        <Fragment key={t}>
                          <TableHead className="text-right">A</TableHead>
                          <TableHead className="text-right">B·关</TableHead>
                          <TableHead className="text-right">B·开</TableHead>
                        </Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.eps.map((ep: string) => (
                      <TableRow key={ep}>
                        <TableCell className="whitespace-nowrap">{ep}</TableCell>
                        {RUNGS.map((t) => {
                          const a = cells[key("abA", "false", t)]?.eps?.[ep];
                          const bf = cells[key("abB", "false", t)]?.eps?.[ep];
                          const bn = cells[key("abB", "true", t)]?.eps?.[ep];
                          const shade = (v?: number) =>
                            a?.p50 && v ? (v <= a.p50 * 0.95 ? "text-green-700" : v >= a.p50 * 1.05 ? "text-red-700" : "text-muted-foreground") : "";
                          return (
                            <Fragment key={ep + t}>
                              <TableCell className={cn("l2num text-right", a && a.errPct >= 100 && "text-red-700 line-through")}>{a?.p50 ?? "—"}</TableCell>
                              <TableCell className={cn("l2num text-right", shade(bf?.p50))}>{bf?.p50 ?? "—"}</TableCell>
                              <TableCell className={cn("l2num text-right font-semibold", shade(bn?.p50))}>{bn?.p50 ?? "—"}</TableCell>
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

          {/* ============ VT 增量归因 ============ */}
          <section id="vt" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">VT 增量归因（仅 B）</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              虚拟线程 = JDK 21+ 能力，A 的 JDK 17 结构上不具备（其历史 VT 相位为重复性对照，±4% 噪声标尺）。本节为 B 内部：VT 开 vs 关 的 P50 变化%（负值=VT 更快）
            </p>
            <Card className="mt-4"><CardContent className="p-4"><Chart option={vtDelta} height={380} /></CardContent></Card>
          </section>

          {/* ============ 写路径 ============ */}
          <section id="write" className="l2section l2fade mt-12 scroll-mt-6">
            <h2 className="text-base font-semibold border-l-2 border-primary pl-2.5">写路径（购物车读 / 收藏写）</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              收藏：productId 全域自增（10 万商品池零重复，每发均为去重查询+插入的真实写）· 相位间 Mongo 复位 · 当前数据：{Object.keys(wcells).length ? "B 优化栈" : "暂无"}
            </p>
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
            <p className="mt-1 text-xs text-muted-foreground">每相位 5s 粒度采样（res_*.csv）· 看峰值不看均值 · A 相位标签为 A·并发</p>
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
                      <TableHead className="text-right">portal 内存峰值 MiB</TableHead>
                    </TableRow>
                    <TableRow>
                      {["mall-mysql", "mall-svc-portal", "mall-gateway", "jmeter"].flatMap((c) => (
                        [<TableHead key={c + "a"} className="text-right">均值</TableHead>,
                         <TableHead key={c + "b"} className="text-right">峰值</TableHead>]
                      ))}
                      <TableHead className="text-right">—</TableHead>
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
            <p className="mt-1 text-xs text-muted-foreground">A 的 detail/bulk 100% 错误 = 原生 null 属性分类缺陷（基线保持原样）· B 全线 0% 为优化栈修复效果</p>
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
                <p>· 协议：A/B 对比为「整套方案」——A = 原作者代码 + JDK 17 + SB 3.5.14（无 VT 能力）；B = 优化代码 + JDK 25 + SB 4.0.8 + 索引 + VT。A 不设 VT 变量（JDK 17 无 Loom，历史上 A 的 VT 开相位仅为重复性对照，±4% 噪声标尺）。</p>
                <p>· 数据源：l2_*.jtl + res_*.csv（5s 粒度全容器采样）+ vt_cart_/vt_coll_*.jtl（写路径），由 l2_emit.py 聚合，阶梯完成自动刷新。</p>
                <p>· 装置修正记录：bulk_detail 换有效 id；search 换真实关键词+pageNum=1；MySQL 1c→2c；Druid 20→50；portal 内存 768m；pms_sku_stock 加 product_id 索引（4016ms→5ms）；collection_add productId 全域自增 + 相位间 Mongo 复位；master search 默认页 pageNum 0→1。</p>
                <p>· 已发现原生缺陷：detail/bulk 对 null 属性分类 100% 崩溃（Example 不容忍 null）；收藏服务检查-插入竞态（并发下产生重复文档致 findOne 崩溃，Mongo 无唯一索引）。</p>
                <p>· 噪声声明：共享开发机，结论看配对相位差值与峰值资源；jmeter 对已有 -l 文件会追加（rm 已修宿主路径），数据清洗按最大时间间隙切段。</p>
                <p>· 相位数据时间：{Object.keys(cells).sort().map((k) => cells[k].mtime ? `${k.replace(/\|/g, "·")}(${cells[k].mtime})` : null).filter(Boolean).join("， ")}</p>
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
