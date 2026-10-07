#!/usr/bin/env python3
"""解析 JMeter CSV jtl，输出与旧 Python 客户端同 schema 的统计"""
import csv

def parse(path):
    lat, ok, err = [], 0, 0
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
            else:
                err += 1
    total = ok + err
    lat.sort()
    wall = (ts_max - ts_min) / 1000.0 if ts_min and ts_max and ts_max > ts_min else 0.001
    def pct(p): return lat[int(len(lat) * p)] if lat else 0
    return {"total": total, "ok": ok, "err": err,
            "err_rate_pct": round(err * 100.0 / total, 2) if total else 100.0,
            "tps": round(total / wall, 1),
            "p50_ms": pct(0.50), "p95_ms": pct(0.95), "p99_ms": pct(0.99),
            "avg_ms": round(sum(lat) / len(lat), 1) if lat else 0,
            "wall_s": round(wall, 1)}
