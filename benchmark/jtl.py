#!/usr/bin/env python3
"""解析 JMeter CSV jtl，输出统一口径统计
- 有效TPS: 成功请求 ÷ 排空时长(首样本发出→末样本完成); 齐射场景=真实排空速率, 持续压测≈窗口吞吐
- err_breakdown: 失败按状态码归因——区分 '慢'(超时) 与 '坏'(4xx/5xx/业务码失败), 坏接口的TPS不可比
- 延迟分位数只统计成功样本; 成功占比<1%时置None(不展示)"""
import csv

def _bucket(row):
    """把一条失败样本归到语义桶(严格区分'慢'与'崩'):
    - timeout: 读超时——服务已受理但处理不过来(慢)
    - conn_timeout: 连接建立超时——服务不可达/不接受连接(崩溃族)
    - client_pool_timeout: JMeter自身连接池等不到空闲连接——施压侧伪失败, 不算服务故障
    - conn: 连接拒绝/重置/无响应/DNS失败(崩溃族)
    - biz_fail: 2xx但断言失败——业务拒绝(如库存不足)
    - http_500: 应用异常; http_502/503/504_gateway: 网关/上游不可用(崩溃族); 其余4xx/5xx按原码
    """
    rc = (row.get("responseCode") or "").strip()
    if rc.startswith("Non HTTP response code:"):
        exc = rc.split(":", 1)[1].strip()
        if "ConnectionPoolTimeout" in exc:
            return "client_pool_timeout"
        if "ConnectTimeout" in exc:
            return "conn_timeout"
        if "Timeout" in exc:
            return "timeout"
        if any(k in exc for k in ("ConnectException", "NoHttpResponse", "UnknownHost", "Reset", "Closed")):
            return "conn"
        return exc.split(".")[-1][:30]
    if rc.isdigit():
        if rc.startswith("2"):
            return "biz_fail"
        if rc in ("502", "503", "504"):
            return f"http_{rc}_gateway"
        return f"http_{rc}"
    return "unknown"

def parse(path):
    samples = []          # (ts_ms, elapsed_ms)
    ok_lat = []
    ok, err = 0, 0
    breakdown = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            try:
                t = int(row["timeStamp"]); e = int(row["elapsed"])
            except (KeyError, ValueError):
                continue
            samples.append((t, e))
            if row.get("success") == "true":
                ok += 1
                ok_lat.append(e)
            else:
                err += 1
                b = _bucket(row)
                breakdown[b] = breakdown.get(b, 0) + 1
    total = ok + err
    lat = sorted(e for _, e in samples)
    ok_lat.sort()
    ts_min = min(t for t, _ in samples) if samples else 0
    drain = (max(t + e for t, e in samples) - ts_min) / 1000.0 if samples else 0.001
    def pct(p): return lat[int(len(lat) * p)] if lat else 0
    def ok_pct(p):
        # 延迟分位数只统计成功样本; 成功占比<1%时无统计意义, 置None(不展示)
        if total == 0 or ok < total * 0.01:
            return None
        return ok_lat[int(len(ok_lat) * p)] if ok_lat else None
    return {"total": total, "ok": ok, "err": err,
            "err_rate_pct": round(err * 100.0 / total, 2) if total else 100.0,
            "err_breakdown": dict(sorted(breakdown.items(), key=lambda i: -i[1])),
            "tps": round(total / drain, 1),
            "ok_tps": round(ok / drain, 1),
            "drain_s": round(drain, 3),
            "p50_ms": pct(0.50), "p95_ms": pct(0.95), "p99_ms": pct(0.99),
            "ok_p50_ms": ok_pct(0.50), "ok_p95_ms": ok_pct(0.95), "ok_p99_ms": ok_pct(0.99),
            "avg_ms": round(sum(lat) / len(lat), 1) if lat else 0,
            "wall_s": round(drain, 3)}
