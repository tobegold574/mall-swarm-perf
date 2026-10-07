"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";

/* ---------- ECharts 包装组件 ---------- */
function Chart({ option, height = 380 }) {
  const ref = useRef(null);
  const inst = useRef(null);
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

/* ---------- 通用样式片段（图表配色保留，底色透明适配黑白页面） ---------- */
const AX = {
  axisLine: { lineStyle: { color: "#d4d4d4" } },
  axisLabel: { color: "#525252", rotate: 20, interval: 0 },
  splitLine: { lineStyle: { color: "#ececec" } },
};
const ANIM = { animationDuration: 700, animationEasing: "cubicOut", animationDelay: (i) => i * 40 };
const sharedMax = (...arrs) =>
  Math.ceil(Math.max(1, ...arrs.flat().filter((x) => !isNaN(x))) * 1.15);

/* ---------- 各主题的 option 构造（图表配色保留） ---------- */
function baseGrid() {
  return { backgroundColor: "transparent", tooltip: { trigger: "axis" }, ...ANIM };
}

function tpsOption(s, ymax) {
  const names = s.read.map((a) => a.api);
  const series = Array.from({ length: s.rounds }, (_, i) => ({
    name: `轮${i + 1}`,
    type: "bar",
    data: s.read.map((a) => (a.rounds[i] ? a.rounds[i].tps : 0)),
    itemStyle: { color: "#38bdf8", opacity: 0.9 - 0.22 * i },
  }));
  series.push({
    name: "中位",
    type: "bar",
    data: s.read.map((a) => a.tps_med),
    itemStyle: { color: "#fbbf24" },
  });
  return {
    ...baseGrid(),
    legend: { textStyle: { color: "#525252" }, top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 90 },
    xAxis: { type: "category", data: names, ...AX },
    yAxis: { type: "value", name: "TPS", ...(ymax > 0 ? { max: ymax } : {}), nameTextStyle: { color: "#525252" }, ...AX },
    series,
  };
}

function p99Option(s, ymax) {
  const names = s.read.map((a) => a.api);
  const mk = (name, col, c) => ({
    name, type: "bar", data: s.read.map((a) => a[`${col}_med`]), itemStyle: { color: c },
  });
  return {
    ...baseGrid(),
    legend: { textStyle: { color: "#525252" }, top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 90 },
    xAxis: { type: "category", data: names, ...AX },
    yAxis: { type: "value", name: "ms", ...(ymax > 0 ? { max: ymax } : {}), nameTextStyle: { color: "#525252" }, ...AX },
    series: [mk("P50", "p50", "#4ade80"), mk("P95", "p95", "#fbbf24"), mk("P99", "p99", "#f87171")],
  };
}

function writeOption(s) {
  const xs = s.write.map((w) => `轮${w.round}`);
  return {
    ...baseGrid(),
    legend: { textStyle: { color: "#525252" }, top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: { type: "category", data: xs, axisLabel: { color: "#525252" }, axisLine: { lineStyle: { color: "#d4d4d4" } } },
    yAxis: { type: "value", nameTextStyle: { color: "#525252" }, splitLine: { lineStyle: { color: "#ececec" } } },
    series: [
      { name: "成功订单", type: "bar", data: s.write.map((w) => w.success), itemStyle: { color: "#f87171" } },
      { name: "落库订单", type: "bar", data: s.write.map((w) => w.db_orders), itemStyle: { color: "#a78bfa" } },
      { name: "lock_stock终态", type: "bar", data: s.write.map((w) => w.final_lock_stock), itemStyle: { color: "#38bdf8" } },
      { name: "真实库存5", type: "line", data: s.write.map(() => 5), symbol: "none",
        lineStyle: { type: "dashed", color: "#4ade80" }, itemStyle: { color: "#4ade80" } },
    ],
  };
}

function sqlReqOption(s) {
  return {
    ...baseGrid(),
    grid: { left: 50, right: 20, top: 20, bottom: 90 },
    xAxis: { type: "category", data: s.read.map((a) => a.api), ...AX },
    yAxis: { type: "value", name: "条/单", nameTextStyle: { color: "#525252" }, splitLine: { lineStyle: { color: "#ececec" } } },
    series: [{ name: "SQL/req", type: "bar", data: s.read.map((a) => a.sql_med), itemStyle: { color: "#a78bfa" } }],
  };
}

function gcOption(s) {
  const names = Object.keys(s.resources);
  return {
    ...baseGrid(),
    legend: { textStyle: { color: "#525252" }, top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: { type: "category", data: names, axisLabel: { color: "#525252" }, axisLine: { lineStyle: { color: "#d4d4d4" } } },
    yAxis: [
      { type: "value", name: "秒", splitLine: { lineStyle: { color: "#ececec" } } },
      { type: "value", name: "次数", splitLine: { show: false } },
    ],
    series: [
      { name: "GC停顿(s)", type: "bar", data: names.map((n) => s.resources[n].gc_pause_s), itemStyle: { color: "#38bdf8" } },
      { name: "GC次数", type: "bar", yAxisIndex: 1, data: names.map((n) => s.resources[n].gc_count), itemStyle: { color: "#fbbf24", opacity: 0.7 } },
    ],
  };
}

/* ---------- 展示组件 ---------- */
function ThemeBlock({ title, tagA, tagB, buildOption, a, b, ymax }) {
  return (
    <section className="theme">
      <h2>{title}</h2>
      <span className="tagA">A（前）{tagA}</span>
      <Chart option={buildOption(a, ymax)} />
      <span className="tagB">B（后）{tagB}</span>
      <Chart option={buildOption(b, ymax)} />
    </section>
  );
}

function HeadlineCards({ s, tag }) {
  const tps = s.read.reduce((x, a) => x + a.tps_med, 0);
  const err = Math.max(...s.read.map((a) => a.err_med));
  const oversell = s.write.some((w) => w.oversell);
  const sqls = s.write.map((w) => w.per_order_sql).sort((x, y) => x - y);
  return (
    <div>
      <span className={tag === "A" ? "tagA" : "tagB"}>{tag}（{s.generated_at}）</span>
      <div className="cards">
        <div className="card"><div className="v">{tps.toFixed(1)}</div><div className="l">合计TPS(中位之和)</div></div>
        <div className="card"><div className="v">{err.toFixed(2)}%</div><div className="l">读最高错误率(中位)</div></div>
        <div className="card"><div className={"v " + (oversell ? "bad" : "")}>{oversell ? "超卖" : "正常"}</div><div className="l">写并发判定</div></div>
        <div className="card"><div className="v">{sqls.length ? sqls[Math.floor(sqls.length / 2)].toFixed(1) : "-"}</div><div className="l">每单SQL(中位)</div></div>
      </div>
    </div>
  );
}

function DeltaTable({ a, b }) {
  const rows = a.read.map((x) => {
    const y = b.read.find((r) => r.api === x.api) || {};
    const d = (p, q) => (p ? Math.round(((q - p) * 100) / p * 10) / 10 : null);
    return {
      接口: x.api, TPS: `${x.tps_med} → ${y.tps_med}`, TPSΔ: d(x.tps_med, y.tps_med),
      P50: `${x.p50_med} → ${y.p50_med}`, P95: `${x.p95_med} → ${y.p95_med}`,
      P99: `${x.p99_med} → ${y.p99_med}`, P99Δ: d(x.p99_med, y.p99_med),
      "SQL/req": `${x.sql_med} → ${y.sql_med}`, "错误率%": `${x.err_med} → ${y.err_med}`,
    };
  });
  return (
    <table>
      <thead><tr><th>接口</th><th>TPS</th><th>TPSΔ%</th><th>P50</th><th>P95</th><th>P99</th><th>P99Δ%</th><th>SQL/req</th><th>错误率%</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.接口}>
            <td>{r.接口}</td><td>{r.TPS}</td>
            <td className={r.TPSΔ >= 0 ? "good" : "bad"}>{r.TPSΔ}</td>
            <td>{r.P50}</td><td>{r.P95}</td><td>{r.P99}</td>
            <td className={r.P99Δ <= 0 ? "good" : "bad"}>{r.P99Δ}</td>
            <td>{r["SQL/req"]}</td><td>{r["错误率%"]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WriteTable({ s }) {
  return (
    <table>
      <thead><tr><th>轮</th><th>成功</th><th>落库</th><th>失败</th><th>lock_stock终态</th><th>每单SQL</th><th>判定</th></tr></thead>
      <tbody>{s.write.map((w) => (
        <tr key={w.round}>
          <td>{w.round}</td><td>{w.success}</td><td>{w.db_orders}</td><td>{w.failed}</td>
          <td>{w.final_lock_stock}</td><td>{w.per_order_sql}</td>
          <td className={w.oversell ? "bad" : "good"}>{w.oversell ? "超卖" : "正常"}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function WriteTableCompare({ a, b }) {
  const n = Math.max(a.write.length, b.write.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = a.write[i], y = b.write[i];
    rows.push({
      轮: i + 1,
      成功A_B: `${x ? x.success : "-"} → ${y ? y.success : "-"}`,
      lock_stockA_B: `${x ? x.final_lock_stock : "-"} → ${y ? y.final_lock_stock : "-"}`,
      每单SQLA_B: `${x ? x.per_order_sql : "-"} → ${y ? y.per_order_sql : "-"}`,
      判定: `${x ? (x.oversell ? "超卖" : "正常") : "-"} → ${y ? (y.oversell ? "超卖" : "正常") : "-"}`,
    });
  }
  return (
    <table>
      <thead><tr><th>轮</th><th>成功 A→B</th><th>lock_stock A→B</th><th>每单SQL A→B</th><th>判定 A→B</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.轮}><td>{r.轮}</td><td>{r.成功A_B}</td><td>{r.lock_stockA_B}</td><td>{r.每单SQLA_B}</td><td>{r.判定}</td></tr>
      ))}</tbody>
    </table>
  );
}

function ResTable({ s }) {
  return (
    <table>
      <thead><tr><th>服务</th><th>平均CPU(核)</th><th>平均内存(MB)</th><th>GC停顿(s)</th><th>GC次数</th></tr></thead>
      <tbody>{Object.entries(s.resources).map(([k, v]) => (
        <tr key={k}><td>{k}</td><td>{v.cpu_cores_avg}</td><td>{v.mem_mb_avg}</td><td>{v.gc_pause_s}</td><td>{v.gc_count}</td></tr>
      ))}</tbody>
    </table>
  );
}

/* ---------- 单套件视图 ---------- */
function SingleSuite({ s }) {
  return (
    <>
      <HeadlineCards s={s} tag="单" />
      <section className="theme">
        <h2>TPS（各轮 + 中位独立列）</h2>
        <Chart option={tpsOption(s, 0)} />
      </section>
      <section className="theme">
        <h2>延迟分位数</h2>
        <Chart option={p99Option(s, 0)} />
      </section>
      <section className="theme">
        <h2>写并发（200线程 barrier 抢 5 件库存）</h2>
        <Chart option={writeOption(s)} />
        <WriteTable s={s} />
      </section>
      <section className="theme">
        <h2>每单 SQL 语句数</h2>
        <Chart option={sqlReqOption(s)} />
      </section>
      <section className="theme">
        <h2>资源与 GC（Prometheus 窗口）</h2>
        <Chart option={gcOption(s)} />
        <ResTable s={s} />
      </section>
    </>
  );
}

/* ---------- 主页面 ---------- */
export default function Page() {
  const [suites, setSuites] = useState(null);
  const [err, setErr] = useState(null);
  const [aKey, setAKey] = useState("");
  const [bKey, setBKey] = useState("");

  useEffect(() => {
    fetch("/api/suites").then((r) => r.json()).then((list) => {
      setSuites(list);
      if (list.length >= 2) { setAKey(list[list.length - 2].key); setBKey(list[list.length - 1].key); }
      else if (list.length === 1) { setAKey(list[0].key); setBKey(list[0].key); }
    }).catch((e) => setErr(String(e)));
  }, []);

  const byKey = useMemo(() => Object.fromEntries((suites || []).map((s) => [s.key, s])), [suites]);
  const sa = byKey[aKey], sb = byKey[bKey];
  const single = sa && aKey === bKey;

  if (err) return <div className="wrap"><p className="bad">加载失败: {err}</p></div>;
  if (!suites) return <div className="wrap"><p>加载中...</p></div>;
  if (!suites.length) return <div className="wrap"><p className="bad">没有 suite.json，先跑 bash benchmark/run_all.sh</p></div>;

  const yTps = sa && sb && !single ? sharedMax(sa.read.map((x) => x.tps_med), sb.read.map((x) => x.tps_med)) : 0;
  const y99 = sa && sb && !single ? sharedMax(sa.read.map((x) => x.p99_med), sb.read.map((x) => x.p99_med)) : 0;

  return (
    <div className="wrap">
      <h1>mall-swarm 压测报告看板</h1>
      <p className="meta">Next.js + ECharts · 数据源 /data/suite_*/suite.json · 共 {suites.length} 份套件 · A=前(基线) B=后(改后)，同主题 A 图在上 B 图在下，共享 Y 轴</p>

      <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        <label>A（前）：<select value={aKey} onChange={(e) => setAKey(e.target.value)}>
          {suites.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
        </select></label>
        <label>B（后）：<select value={bKey} onChange={(e) => setBKey(e.target.value)}>
          {suites.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
        </select></label>
        {single && <span className="meta" style={{ alignSelf: "center" }}>当前为单套件视图（A、B 相同）</span>}
      </div>

      {single && sa && <SingleSuite s={sa} />}

      {sa && sb && !single && (
        <>
          <section className="theme">
            <h2>总览</h2>
            <HeadlineCards s={sa} tag="A" />
            <HeadlineCards s={sb} tag="B" />
          </section>

          <ThemeBlock title="主题一：TPS（共享Y轴，柱高直接可比）" tagA={sa.generated_at} tagB={sb.generated_at}
            buildOption={(s) => tpsOption(s, yTps)} a={sa} b={sb} ymax={yTps} />
          <h2 style={{ marginTop: 8 }}>逐接口差异（TPSΔ 正=提升；P99Δ 负=改善）</h2>
          <DeltaTable a={sa} b={sb} />

          <ThemeBlock title="主题二：P99 尾部延迟（共享Y轴）" tagA={sa.generated_at} tagB={sb.generated_at}
            buildOption={(s) => p99Option(s, y99)} a={sa} b={sb} ymax={y99} />

          <section className="theme">
            <h2>主题三：写并发（200线程 barrier 抢 5 件库存）</h2>
            <span className="tagA">A（前）{sa.generated_at}</span>
            <Chart option={writeOption(sa)} />
            <span className="tagB">B（后）{sb.generated_at}</span>
            <Chart option={writeOption(sb)} />
            <WriteTableCompare a={sa} b={sb} />
          </section>

          <ThemeBlock title="主题四：每单 SQL 语句数（lock_stock 修复的直接证据）" tagA={sa.generated_at} tagB={sb.generated_at}
            buildOption={(s) => sqlReqOption(s)} a={sa} b={sb} ymax={undefined} />

          <section className="theme">
            <h2>主题五：资源与 GC（Prometheus 窗口）</h2>
            <span className="tagA">A（前）{sa.generated_at}</span>
            <Chart option={gcOption(sa)} />
            <span className="tagB">B（后）{sb.generated_at}</span>
            <Chart option={gcOption(sb)} />
            <ResTable s={sa} />
            <ResTable s={sb} />
          </section>

          <section className="theme">
            <h2>原始数据</h2>
            <details>
              <summary>A 套件 suite.json（{sa.generated_at}）</summary>
              <pre>{JSON.stringify(sa, null, 2)}</pre>
            </details>
            <details>
              <summary>B 套件 suite.json（{sb.generated_at}）</summary>
              <pre>{JSON.stringify(sb, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
