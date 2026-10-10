#!/usr/bin/env python3
"""Prometheus 窗口序列采集与占时分布分桶 (v4 资源章节数据源)
为 suite.json 生成 res_series:
  每容器: cpu_hist(核数档位→累计秒) / mem_hist(MiB档位→累计秒) / gc_hist(单次暂停时长档位→次数, 仅JVM服务)
桶边界全局固定, 保证 A/B 两份套件的分桶可叠加对比。采样粒度=Prometheus抓取间隔(5s)。"""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROM = "http://localhost:9090"
STEP = 5
# 桶边界固定: A/B 两份套件必须同一套桶
CPU_BUCKETS = [(round(i * 0.1, 1), round((i + 1) * 0.1, 1)) for i in range(20)] + [(2.0, 999.0)]
MEM_BUCKETS = [(i * 100, (i + 1) * 100) for i in range(20)] + [(2000, 10 ** 9)]
GC_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000]  # 单次暂停平均时长的上界序列, 最后追加">1000ms"
CONTAINERS = {  # 显示名: compose service label (即 container_label_com_docker_compose_service)
    "gateway": "mall-gateway", "admin": "mall-admin",
    "portal": "mall-portal", "auth": "mall-auth",
    "mysql": "mysql", "redis": "redis", "mongo": "mongo",
    "rabbitmq": "rabbitmq", "nacos": "nacos",
}
_LABEL = "container_label_docker_compose_service_label"  # placeholder防误改, 实际见下
LABEL = "container_label_com_docker_compose_service"
_LABEL_RE = "^(" + "|".join(CONTAINERS.values()) + ")$"


def _epoch(iso):
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def _q(query, start, end):
    url = (f"{PROM}/api/v1/query_range?query={urllib.parse.quote(query)}"
           f"&start={start:.0f}&end={end:.0f}&step={STEP}")
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)["data"]["result"]


def _bucketize(values, buckets):
    """每个5s采样计入其所属档位, 累计秒数"""
    secs = [0.0] * len(buckets)
    for v in values:
        for i, (lo, hi) in enumerate(buckets):
            if lo <= v < hi:
                secs[i] += STEP
                break
    return [round(x, 1) for x in secs]


def _gc_labels():
    labels, lo = [], 0
    for hi in GC_BUCKETS_MS:
        labels.append(f"{lo}-{hi}ms")
        lo = hi
    labels.append(f">{lo}ms")
    return labels


def collect(start_iso, end_iso):
    """给定ISO窗口, 返回 {"res_series": {容器: {...}}, "window": {...}}"""
    start, end = _epoch(start_iso), _epoch(end_iso)
    alt = "|".join(CONTAINERS.values())
    sel = f'{LABEL}=~"^{alt}$"'

    cpu_raw, mem_raw = {}, {}
    for s in _q(f"rate(container_cpu_usage_seconds_total{{{sel}}}[10s])", start, end):
        m = s["metric"].get(LABEL, "")
        if m in CONTAINERS.values() and s.get("values"):
            cpu_raw.setdefault(m, []).extend(float(v) for _, v in s["values"])
    for s in _q(f"container_memory_working_set_bytes{{{sel}}}", start, end):
        m = s["metric"].get(LABEL, "")
        if m in CONTAINERS.values() and s.get("values"):
            mem_raw.setdefault(m, []).extend(float(v) / 1048576 for _, v in s["values"])

    # GC: 5s增量推单次平均时长 → 分桶计数 (counter重置时Δsum<0钳为0)
    gc_raw = {}
    job_re = "mall-(gateway|admin|portal|auth)"
    for metric, field in (("jvm_gc_pause_seconds_sum", "sums"), ("jvm_gc_pause_seconds_count", "counts")):
        for s in _q(f'{metric}{{job=~"{job_re}"}}', start, end):
            job = s["metric"].get("job", "")
            if s.get("values"):
                gc_raw.setdefault(job, {"sums": [], "counts": []})[field].extend(
                    float(v) for _, v in s["values"])

    out = {}
    for key, label in CONTAINERS.items():
        entry = {
            "cpu_hist": {"labels": [f"{lo:g}-{hi:g}" for lo, hi in CPU_BUCKETS],
                         "seconds": _bucketize(cpu_raw.get(label, []), CPU_BUCKETS)},
            "mem_hist": {"labels": [f"{lo:g}-{hi:g}" for lo, hi in MEM_BUCKETS],
                         "seconds": _bucketize(mem_raw.get(label, []), MEM_BUCKETS)},
        }
        g = gc_raw.get("mall-" + key)
        if g and len(g["sums"]) == len(g["counts"]) and len(g["sums"]) > 1:
            counts = [0] * (len(GC_BUCKETS_MS) + 1)
            for i in range(1, len(g["sums"])):
                dc = g["counts"][i] - g["counts"][i - 1]
                ds = max(g["sums"][i] - g["sums"][i - 1], 0.0)
                if dc <= 0:
                    continue
                avg_ms = ds / dc * 1000
                for bi, hi in enumerate(GC_BUCKETS_MS):
                    if avg_ms < hi:
                        counts[bi] += int(dc)
                        break
                else:
                    counts[-1] += int(dc)
            entry["gc_hist"] = {"labels": _gc_labels(), "counts": counts}
        out[key] = entry
    return {"res_series": out, "window": {"start": start_iso, "end": end_iso}}
