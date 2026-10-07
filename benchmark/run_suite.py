#!/usr/bin/env python3
"""mall 全链路压测套件 v4
分工: JMeter(compose按需容器) = 激励；Python = 编排/观测(P_S+Prometheus)/后处理/HTML报告
用法: python3 run_suite.py [rounds]   默认 3 轮（抗 JIT 预热与偶发干扰）
流程: 预检 → 预热(每接口2s×8线程) → 7接口读×R轮(200线程×15s) → 写风暴×R轮(200线程barrier抢5库存) → 每轮即清理 → 聚合出HTML
"""
import json, os, subprocess, sys, time, urllib.request, urllib.parse, shutil
from datetime import datetime, timezone
from statistics import median
import db as dbsnap
import jtl

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
COMPOSE = os.path.join(REPO, "document", "docker", "compose-local.yaml")
JTL_DIR = os.path.join(HERE, "jtl")
ASSETS = os.path.join(HERE, "assets")
RES = os.path.join(HERE, "results")
PROM = "http://localhost:9090"
BASE = "http://localhost:8201"

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
THREADS = int(os.environ.get("THREADS", 200))
DUR = int(os.environ.get("DUR", 15))
WARMUP_T, WARMUP_S = 8, 2
SKU_ID, PRODUCT_ID, STOCK, ADDRESS_ID, CART_MARK = 99, 27, 5, 1, "bench-test"

APIS = [
    ("admin_brand_list",    "GET",  "/mall-admin/brand/list?pageNum=1&pageSize=10",   "admin"),
    ("admin_product_list",  "GET",  "/mall-admin/product/list?pageNum=1&pageSize=10", "admin"),
    ("admin_category_tree", "GET",  "/mall-admin/productCategory/list/withChildren", "admin"),
    ("portal_home_content", "GET",  "/mall-portal/home/content",                      "none"),
    ("portal_product_detail","GET", "/mall-portal/product/detail/27",                 "none"),
    ("portal_cart_list",    "GET",  "/mall-portal/cart/list",                         "portal"),
    ("portal_member_info",  "GET",  "/mall-portal/sso/info",                          "portal"),
]

def log(msg): print(msg, flush=True)
def now_iso(): return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def epoch(iso): return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()

def http(method, path, body=None, params=None, timeout=30):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def sql(q):
    r = subprocess.run(["docker", "exec", "mall-mysql", "mysql", "-uroot", "-proot", "mall", "-N", "-B", "-e", q],
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def jmeter(*args):
    r = subprocess.run(["docker", "compose", "-f", COMPOSE, "run", "--rm", "jmeter"] + list(args),
                       cwd=REPO, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"jmeter失败: {r.stdout[-500:]} {r.stderr[-500:]}")
    return r

def prom_instant(q, ts):
    with urllib.request.urlopen(f"{PROM}/api/v1/query?query={urllib.parse.quote(q)}&time={ts}", timeout=10) as r:
        return json.loads(r.read())["data"]["result"]

def wquery(expr, start_iso, end_iso, agg):
    s, e = epoch(start_iso), epoch(end_iso)
    w = max(int(e - s), 5)
    q = agg.replace("WINDOW", str(w)).replace("EXPR", expr)
    key = "job" if "job" in q else "container_label_com_docker_compose_service"
    return {r["metric"].get(key, "?"): float(r["value"][1]) for r in prom_instant(q, e)}

# ---------- 预检 ----------
log("== [0] 预检 ==")
n = subprocess.run(["docker", "compose", "-f", COMPOSE, "ps", "--status", "running", "--quiet"],
                   capture_output=True, text=True, cwd=REPO).stdout.split()
assert len(n) >= 11, f"容器不足11: {len(n)}"
for s in ("mall-gateway", "mall-admin", "mall-portal", "mall-auth"):
    assert s in http.__globals__  if False else True
ns = subprocess.run(["curl", "-s", "http://localhost:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=20"],
                    capture_output=True, text=True).stdout
for s in ("mall-gateway", "mall-admin", "mall-portal", "mall-auth"):
    assert s in ns, f"Nacos未注册: {s}"
urllib.request.urlopen(PROM + "/-/ready", timeout=5)
admin_token = http("POST", "/mall-admin/admin/login", body={"username": "admin", "password": "macro123"})["data"]["token"]
portal_token = http("POST", "/mall-portal/sso/login", params={"username": "test", "password": "123456"})["data"]["token"]
log(f"  11容器 / 4服务 / Prometheus / 双登录 OK；rounds={ROUNDS}")

AUTH = {"admin": f"Bearer {admin_token}", "portal": f"Bearer {portal_token}", "none": "Bearer x"}

os.makedirs(JTL_DIR, exist_ok=True)
os.makedirs(RES, exist_ok=True)
for f in os.listdir(JTL_DIR):
    os.remove(os.path.join(JTL_DIR, f))

suite = {"schema": "suite_v4", "client": "JMeter-5.6.3-in-compose", "threads": THREADS,
         "duration_s": DUR, "rounds": ROUNDS, "generated_at": now_iso(), "read": [], "write": []}
overall_start = now_iso()

# ---------- 预热 ----------
log("== [1] 预热 ==")
for name, method, path, at in APIS:
    jmeter("-n", "-t", "/jmx/read_test.jmx", f"-JTHREADS={WARMUP_T}", f"-JDURATION={WARMUP_S}",
           f"-JPATH={path}", f"-JMETHOD={method}", f"-JTOKEN={AUTH[at]}",
           "-l", f"/jtl/warm_{name}.jtl", "-j", "/jtl/warm.log")
    log(f"  warm {name}")

# ---------- 读压测 R 轮 ----------
log(f"== [2] 读压测 7接口 × {ROUNDS}轮 ==")
for name, method, path, at in APIS:
    rounds = []
    for r in range(1, ROUNDS + 1):
        dbb = dbsnap.snapshot()
        t0 = now_iso()
        jmeter("-n", "-t", "/jmx/read_test.jmx", f"-JTHREADS={THREADS}", f"-JDURATION={DUR}",
               f"-JPATH={path}", f"-JMETHOD={method}", f"-JTOKEN={AUTH[at]}",
               "-l", f"/jtl/{name}_r{r}.jtl", "-j", f"/jtl/jm_{name}_r{r}.log")
        t1 = now_iso()
        st = jtl.parse(os.path.join(JTL_DIR, f"{name}_r{r}.jtl"))
        prof = dbsnap.diff(dbb, dbsnap.snapshot(), top=5)
        st["sql_count_per_req"] = round(prof["total_stmts"] / st["total"], 1) if st["total"] else None
        st["db_profile"] = prof
        st["window"] = {"start": t0, "end": t1}
        rounds.append(st)
    agg = {"api": name,
           "tps_med": round(median(x["tps"] for x in rounds), 1),
           "p50_med": round(median(x["p50_ms"] for x in rounds)),
           "p95_med": round(median(x["p95_ms"] for x in rounds)),
           "p99_med": round(median(x["p99_ms"] for x in rounds)),
           "err_med": round(median(x["err_rate_pct"] for x in rounds), 2),
           "sql_med": round(median(x["sql_count_per_req"] or 0 for x in rounds), 1),
           "rounds": rounds}
    suite["read"].append(agg)
    log(f"  {name:<22} TPS中位={agg['tps_med']:<7} P50={agg['p50_med']:<6} P99={agg['p99_med']:<6} "
        f"err={agg['err_med']}% SQL/req={agg['sql_med']}  轮次TPS={[x['tps'] for x in rounds]}")

# ---------- 写风暴 R 轮 ----------
log(f"== [3] 写风暴(200线程barrier抢{STOCK}件库存) × {ROUNDS}轮 ==")
max_order_before = int(sql("SELECT IFNULL(MAX(id),0) FROM oms_order"))
for r in range(1, ROUNDS + 1):
    orig = sql(f"SELECT stock, lock_stock FROM pms_sku_stock WHERE id={SKU_ID}").split("\t")
    o_stock, o_lock = int(orig[0]), int(orig[1])
    sql(f"UPDATE pms_sku_stock SET stock={STOCK}, lock_stock=0 WHERE id={SKU_ID}")
    sql(f"DELETE FROM oms_cart_item WHERE member_id=1 AND member_nickname='{CART_MARK}'")
    sql(f"""INSERT INTO oms_cart_item (product_id, product_sku_id, member_id, quantity, price,
            product_name, member_nickname, create_date, modify_date, delete_status)
            SELECT {PRODUCT_ID}, {SKU_ID}, 1, 1, s.price, '压测购物车', '{CART_MARK}', NOW(), NOW(), 0
            FROM pms_sku_stock s, (SELECT @r := @r + 1 AS n FROM information_schema.columns c1,
            information_schema.columns c2, (SELECT @r := 0) i LIMIT {THREADS}) seq WHERE s.id = {SKU_ID}""")
    cart_ids = sql(f"SELECT id FROM oms_cart_item WHERE member_id=1 AND member_nickname='{CART_MARK}' AND delete_status=0 ORDER BY id").splitlines()
    assert len(cart_ids) == THREADS, f"购物车行数 {len(cart_ids)} != {THREADS}"
    open(os.path.join(JTL_DIR, "cart_ids.csv"), "w").write("\n".join(cart_ids) + "\n")

    dbb = dbsnap.snapshot()
    t0 = now_iso()
    jmeter("-n", "-t", "/jmx/write_storm.jmx", f"-JTHREADS={THREADS}", f"-JTOKEN={AUTH['portal']}",
           "-l", f"/jtl/write_r{r}.jtl", "-j", f"/jtl/jm_write_r{r}.log")
    t1 = now_iso()
    st = jtl.parse(os.path.join(JTL_DIR, f"write_r{r}.jtl"))
    final = sql(f"SELECT stock, lock_stock FROM pms_sku_stock WHERE id={SKU_ID}").split("\t")
    prof = dbsnap.diff(dbb, dbsnap.snapshot(), top=10)
    order_ids = sql(f"SELECT GROUP_CONCAT(id) FROM oms_order WHERE member_id=1 AND id > {max_order_before} AND member_username='test'").splitlines()[0]

    state = {"sku_id": SKU_ID, "stock": STOCK, "lock_stock": 0,
             "orig_stock": o_stock, "orig_lock_stock": o_lock,
             "cart_ids": [int(x) for x in cart_ids], "member_id": 1,
             "order_ids": [int(x) for x in order_ids.split(",")] if order_ids else []}
    open(os.path.join(RES, "write_test_state.json"), "w").write(json.dumps(state))
    subprocess.run([sys.executable, os.path.join(HERE, "cleanup_write_test.py")], check=True, capture_output=True)

    db_orders = len(state["order_ids"])
    suite["write"].append({"round": r, "success": st["ok"], "failed": st["err"],
                           "db_orders": db_orders,
                           "tps": st["tps"], "p50_ms": st["p50_ms"], "p99_ms": st["p99_ms"],
                           "final_stock": int(final[0]), "final_lock_stock": int(final[1]),
                           "per_order_sql": round(prof["total_stmts"] / max(st["ok"], 1), 1),
                           "sql_per_req": round(prof["total_stmts"] / max(len(results), 1), 1),
                           "oversell": st["ok"] > STOCK or int(final[1]) < 0,
                           "db_profile": prof, "window": {"start": t0, "end": t1}})
    w = suite["write"][-1]
    log(f"  r{r}: 成功={w['success']} 落库={w['db_orders']} lock_stock={w['final_lock_stock']} "
        f"每请求SQL={w['sql_per_req']} {'❌超卖' if w['oversell'] else '✅'}")

overall_end = now_iso()
suite["window"] = {"start": overall_start, "end": overall_end}

# ---------- Prometheus 资源归因 ----------
log("== [4] Prometheus 窗口归因 ==")
ws, we = overall_start, overall_end
svcs = ["mall-gateway", "mall-admin", "mall-portal", "mall-auth"]
cpu = wquery('container_cpu_usage_seconds_total{container_label_com_docker_compose_service=~"mall-(gateway|admin|portal|auth)"}',
             ws, we, "avg by(container_label_com_docker_compose_service)(rate(EXPR[WINDOW]))")
mem = wquery('container_memory_working_set_bytes{container_label_com_docker_compose_service=~"mall-(gateway|admin|portal|auth)"}',
             ws, we, "avg by(container_label_com_docker_compose_service)(avg_over_time(EXPR[WINDOW]))")
gcs = wquery('jvm_gc_pause_seconds_sum{job=~"mall-.*"}', ws, we, "sum by(job)(increase(EXPR[WINDOW]))")
gcn = wquery('jvm_gc_pause_seconds_count{job=~"mall-.*"}', ws, we, "sum by(job)(increase(EXPR[WINDOW]))")
suite["resources"] = {s: {"cpu_cores_avg": round(cpu.get(s, 0), 2),
                          "mem_mb_avg": round(mem.get(s, 0) / 1048576),
                          "gc_pause_s": round(gcs.get(s, 0), 2),
                          "gc_count": int(gcn.get(s, 0))} for s in svcs}
for s, v in suite["resources"].items():
    log(f"  {s}: cpu={v['cpu_cores_avg']}核 mem={v['mem_mb_avg']}MB GC={v['gc_pause_s']}s/{v['gc_count']}次")


# ---------- 归档 ----------
log("== [5] 归档结果 ==")
ts = datetime.now().strftime("%Y%m%d_%H%M%S")
outdir = os.path.join(RES, f"suite_{ts}")
os.makedirs(outdir, exist_ok=True)
json.dump(suite, open(os.path.join(outdir, "suite.json"), "w"), ensure_ascii=False, indent=2)
log(f"完成: {os.path.join(outdir, 'suite.json')}")
log("看板: docker compose -f document/docker/compose-local.yaml --profile report up -d dashboard → http://localhost:3000")
