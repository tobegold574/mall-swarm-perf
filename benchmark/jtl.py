#!/usr/bin/env python3
"""解析 JMeter CSV jtl，输出与旧 Python 客户端同 schema 的统计
err_breakdown: 失败按状态码归因——区分 '慢'(超时) 与 '坏'(4xx/5xx/业务码失败)，坏接口的 TPS 不可比"""
import csv

def _bucket(row):
    """把一条失败样本归到可读的桶: timeout/conn/biz_fail/具体HTTP码"""
    rc = (row.get("responseCode") or "").strip()
    if rc.startswith("Non HTTP response code:"):
        exc = rc.split(":", 1)[1].strip()
        if "Timeout" in exc:
            return "timeout"
        if any(k in exc for k in ("Connect", "UnknownHost", "Reset", "Closed")):
            return "conn"
        return exc.split(".")[-1][:30]
    if rc.isdigit():
        return "biz_fail" if rc.startswith("2") else f"http_{rc}"
    return "unknown"

def parse(path):
    lat, ok_lat = [], []
    ok, err = 0, 0
    breakdown = {}
    ts_min, ts_max = None, None
    with open(path) as f:
        for row in csv.DictReader(f):
            try:
                t = int(row["timeStamp"]); e = int(row["elapsed"])
            except (KeyError, ValueError):
                continue
            lat.append(e)
            ts_min = t if ts_min is None or t < ts_min else ts_min
            ts_max = t if ts_max is None or t > ts_max else ts_max
            if row.get("success") == "true":
                ok += 1
                ok_lat.append(e)
            else:
                err += 1
                b = _bucket(row)
                breakdown[b] = breakdown.get(b, 0) + 1
    total = ok + err
    lat.sort(); ok_lat.sort()
    wall = (ts_max - ts_min) / 1000.0 if ts_min and ts_max and ts_max > ts_min else 0.001
    def pct(p): return lat[int(len(lat) * p)] if lat else 0
    def ok_pct(p):
        # 延迟分位数只统计成功样本; 成功占比<1%时无统计意义, 置None(不展示)
        if total == 0 or ok < total * 0.01:
            return None
        return ok_lat[int(len(ok_lat) * p)] if ok_lat else None
    return {"total": total, "ok": ok, "err": err,
            "err_rate_pct": round(err * 100.0 / total, 2) if total else 100.0,
            "err_breakdown": dict(sorted(breakdown.items(), key=lambda i: -i[1])),
            "tps": round(total / wall, 1),
            "ok_tps": round(ok / wall, 1),
            "p50_ms": pct(0.50), "p95_ms": pct(0.95), "p99_ms": pct(0.99),
            "ok_p50_ms": ok_pct(0.50), "ok_p95_ms": ok_pct(0.95), "ok_p99_ms": ok_pct(0.99),
            "avg_ms": round(sum(lat) / len(lat), 1) if lat else 0,
            "wall_s": round(wall, 1)}
