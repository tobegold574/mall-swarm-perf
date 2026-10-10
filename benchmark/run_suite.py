#!/usr/bin/env python3
"""mall 全链路压测套件 v4
分工: JMeter(compose按需容器) = 激励；Python = 编排/观测(P_S+Prometheus)/后处理/HTML报告
用法: python3 run_suite.py [rounds]   默认 3 轮（抗 JIT 预热与偶发干扰）
流程: 预检 → 预热(每接口2s×8线程) → 7接口读×R轮(200线程×15s) → 写风暴×R轮(200线程barrier抢5库存) → 每轮即清理 → 聚合出HTML
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error, urllib.parse, shutil
from datetime import datetime, timezone
from statistics import median
import db as dbsnap
import jtl
import res_series as rs

HERE = os.path.dirname(os.path.abspath(__file__))
# 分支无关测试台: 通过环境变量覆盖路径, 同一份脚本在 repo/测试台两处均可运行
BENCH_HOME = os.environ.get("BENCH_HOME", HERE)
REPO = os.environ.get("BENCH_REPO", os.path.dirname(HERE))
COMPOSE = os.path.join(REPO, "document", "docker", "compose-local.yaml")
JTL_DIR = os.path.join(REPO, "benchmark", "jtl")
ASSETS = os.path.join(BENCH_HOME, "assets")
RES = os.path.join(BENCH_HOME, "results")
PROM = "http://localhost:9090"
BASE = "http://localhost:8201"

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
THREADS = int(os.environ.get("THREADS", 200))
DUR = int(os.environ.get("DUR", 15))
WARM = os.environ.get("WARM", "") == "1"   # 预热批模式: 结果归档 warmup_* (看板/统计自动忽略)
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

def smoke_one(name, method, path, at):
    """单发一次请求: 记录 HTTP码/业务码/耗时, 作为该变体的接口健康证明(坏接口提前暴露)"""
    try:
        t0 = time.time()
        req = urllib.request.Request(BASE + path, method=method, headers={"Authorization": AUTH[at]})
        with urllib.request.urlopen(req, timeout=35) as r:
            body = r.read(4000).decode("utf-8", "replace")
            http_code, ms = r.status, int((time.time() - t0) * 1000)
        m = re.search(r'"code":\s*(-?\d+)', body)
        biz = int(m.group(1)) if m else None
        verdict = "OK" if http_code == 200 and biz == 200 else f"BIZ_{biz}"
    except urllib.error.HTTPError as e:
        http_code, ms, verdict = e.code, None, f"HTTP_{e.code}"
        biz = None
        try:
            m = re.search(r'"code":\s*(-?\d+)', e.read(2000).decode("utf-8", "replace"))
            biz = int(m.group(1)) if m else None
        except Exception:
            pass
    except Exception as e:
        http_code, biz, ms, verdict = None, None, None, f"EXC_{type(e).__name__}"
    return {"api": name, "http": http_code, "biz": biz, "ms": ms, "verdict": verdict}

# ---------- 预检 ----------
log("== [0] 预检 ==")
names = subprocess.run(["docker", "ps", "--format", "{{.Names}}"],
                       capture_output=True, text=True).stdout.splitlines()
n = [x for x in names if x.startswith("mall-")]
assert len(n) >= 11, f"mall容器不足11: {len(n)}"
ns = subprocess.run(["curl", "-s", "http://localhost:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=20"],
                    capture_output=True, text=True).stdout
for s in ("mall-gateway", "mall-admin", "mall-portal", "mall-auth"):
    assert s in ns, f"Nacos未注册: {s}"
urllib.request.urlopen(PROM + "/-/ready", timeout=5)
def login_with_retry(kind, **kw):
    """预检登录带重试: 压测后服务可能处于恢复期(Nacos重注册/GC), 瞬时失败不应炸掉协议"""
    last = None
    for i in range(5):
        try:
            return http("POST", **kw)["data"]["token"]
        except Exception as e:
            last = e
            log(f"  {kind}登录第{i+1}次失败({type(e).__name__}), 15s后重试")
            time.sleep(15)
    raise last

admin_token = login_with_retry("admin", path="/mall-admin/admin/login",
                               body={"username": "admin", "password": "macro123"})
portal_token = login_with_retry("portal", path="/mall-portal/sso/login",
                                params={"username": "test", "password": "123456"})
log(f"  11容器 / 4服务 / Prometheus / 双登录 OK；rounds={ROUNDS}")

AUTH = {"admin": f"Bearer {admin_token}", "portal": f"Bearer {portal_token}", "none": "Bearer x"}

# 大数据量压力场景：深分页 / like 搜索 / 大表详情
try:
    _bulk = sql("SELECT id FROM pms_product WHERE product_sn LIKE 'SN%' ORDER BY id DESC LIMIT 1")
    from urllib.parse import quote as _q
    APIS.extend([
        ("admin_product_deeppage", "GET", "/mall-admin/product/list?pageNum=2500&pageSize=10", "admin"),
        ("portal_search_kw", "GET", "/mall-portal/product/search?keyword=" + _q("手机") + "&pageNum=1&pageSize=10", "none"),
        ("portal_bulk_detail", "GET", "/mall-portal/product/detail/" + _bulk, "none"),
    ])
    log("  压力场景追加: 深分页/搜索/大表详情 (bulk_id=" + _bulk + ")")
except Exception as e:
    log("  压力场景跳过: " + str(e))

os.makedirs(JTL_DIR, exist_ok=True)
os.makedirs(RES, exist_ok=True)
for f in os.listdir(JTL_DIR):
    os.remove(os.path.join(JTL_DIR, f))

suite = {"schema": "suite_v4", "client": "JMeter-5.6.3-in-compose", "threads": THREADS,
         "duration_s": DUR, "rounds": ROUNDS, "warmup_batch": WARM,
         "generated_at": now_iso(), "read": [], "write": []}

# 运行环境指纹: 防止不同配置(VT开关/镜像版本)的数据混为一谈
_ctn = subprocess.run(["docker", "inspect", "--format", "{{.Config.Image}} {{.Image}}",
                       "mall-svc-gateway", "mall-svc-admin", "mall-svc-portal", "mall-svc-auth"],
                      capture_output=True, text=True).stdout.splitlines()
_vt = subprocess.run(["docker", "exec", "mall-svc-portal", "sh", "-c",
                      "tr '\\0' '\\n' < /proc/1/environ | grep SPRING_THREADS_VIRTUAL_ENABLED"],
                     capture_output=True, text=True).stdout.strip()
_vt = _vt.split("=", 1)[-1] if _vt else "unknown"
suite["env"] = {"vt_enabled": _vt,
                "containers": dict(zip(["gateway", "admin", "portal", "auth"], _ctn)),
                "nproc": os.cpu_count()}
log(f"  环境: VT={suite['env']['vt_enabled']}")
for line in _ctn:
    log(f"  {line}")
overall_start = now_iso()

# ---------- 冒烟健康表: 每接口单发1次, 提前暴露该变体的坏接口 ----------
log("== [1a] 接口冒烟健康表 ==")
suite["smoke"] = [smoke_one(n, m_, p, a) for n, m_, p, a in APIS]
_bad = [s for s in suite["smoke"] if s["verdict"] != "OK"]
for s in suite["smoke"]:
    log(f"  {s['api']:<22} http={s['http']} biz={s['biz']} {s['ms']}ms {'OK' if s['verdict'] == 'OK' else '<< FAIL ' + s['verdict']}")
if _bad:
    log(f"  !! {len(_bad)} 个接口冒烟失败: 其压测 TPS 不可比, 报告将按状态码单独标注")

# ---------- 预热 ----------
log("== [1] 预热 ==")
for name, method, path, at in APIS:
    jmeter("-n", "-t", "/jmx/read_test.jmx", f"-JTHREADS={WARMUP_T}", f"-JDURATION={WARMUP_S}",
           f"-JPATH={path}", f"-JMETHOD={method}", f"-JTOKEN={AUTH[at]}",
           "-l", f"/jtl/warm_{name}.jtl", "-j", "/jtl/warm.log")
    log(f"  warm {name}")

# ---------- 读压测 R 轮 ----------
log(f"== [2] 读压测 {len(APIS)}接口 × {ROUNDS}轮 ==")
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
    merged = {}
    for x in rounds:
        for k, v in x.get("err_breakdown", {}).items():
            merged[k] = merged.get(k, 0) + v
    def med_or_none(key):
        vals = [x[key] for x in rounds if x.get(key) is not None]
        return round(median(vals)) if vals else None
    agg = {"api": name,
           "tps_med": round(median(x["tps"] for x in rounds), 1),
           "tps_ok_med": round(median(x["ok_tps"] for x in rounds), 1),
           "p50_med": round(median(x["p50_ms"] for x in rounds)),
           "p95_med": round(median(x["p95_ms"] for x in rounds)),
           "p99_med": round(median(x["p99_ms"] for x in rounds)),
           "p50_ok_med": med_or_none("ok_p50_ms"),
           "p99_ok_med": med_or_none("ok_p99_ms"),
           "err_med": round(median(x["err_rate_pct"] for x in rounds), 2),
           "sql_med": round(median(x["sql_count_per_req"] or 0 for x in rounds), 1),
           "err_top": dict(sorted(merged.items(), key=lambda i: -i[1])[:3]),
           "rounds": rounds}
    suite["read"].append(agg)
    p50s = str(agg["p50_ok_med"]) if agg["p50_ok_med"] is not None else "—"
    p99s = str(agg["p99_ok_med"]) if agg["p99_ok_med"] is not None else "—"
    log(f"  {name:<22} 有效TPS={agg['tps_ok_med']:<7} 原始TPS={agg['tps_med']:<7} "
        f"P50成功={p50s:<6} P99成功={p99s:<6} err={agg['err_med']}% SQL/req={agg['sql_med']}"
        + (f"  失败归因={agg['err_top']}" if agg["err_top"] else ""))

# ---------- 写测试：正确性 / 吞吐 / 读写混合 ----------
def write_setup(stock, n):
    """重置SKU库存为stock并造n行购物车；返回(原始快照, 购物车ids)"""
    orig = sql(f"SELECT stock, lock_stock FROM pms_sku_stock WHERE id={SKU_ID}").split("\t")
    sql(f"UPDATE pms_sku_stock SET stock={stock}, lock_stock=0 WHERE id={SKU_ID}")
    sql(f"DELETE FROM oms_cart_item WHERE member_id=1 AND member_nickname='{CART_MARK}'")
    sql(f"""INSERT INTO oms_cart_item (product_id, product_sku_id, member_id, quantity, price,
            product_name, member_nickname, create_date, modify_date, delete_status)
            SELECT {PRODUCT_ID}, {SKU_ID}, 1, 1, s.price, '压测购物车', '{CART_MARK}', NOW(), NOW(), 0
            FROM pms_sku_stock s, (SELECT @r := @r + 1 AS n FROM information_schema.columns c1,
            information_schema.columns c2, (SELECT @r := 0) i LIMIT {n}) seq WHERE s.id = {SKU_ID}""")
    cart_ids = sql(f"SELECT id FROM oms_cart_item WHERE member_id=1 AND member_nickname='{CART_MARK}' AND delete_status=0 ORDER BY id").splitlines()
    assert len(cart_ids) == n, f"购物车行数 {len(cart_ids)} != {n}"
    open(os.path.join(JTL_DIR, "cart_ids.csv"), "w").write("\n".join(cart_ids) + "\n")
    return {"orig_stock": int(orig[0]), "orig_lock_stock": int(orig[1])}, cart_ids

def write_cleanup(state):
    open(os.path.join(RES, "write_test_state.json"), "w").write(json.dumps(state))
    subprocess.run([sys.executable, os.path.join(HERE, "cleanup_write_test.py")], check=True, capture_output=True)

def collect_orders(since_id):
    # 注意: 不能用 GROUP_CONCAT, 1024字节默认上限会静默截断大结果集
    out = sql(f"SELECT id FROM oms_order WHERE member_id=1 AND id > {since_id} AND member_username='test'")
    return [int(x) for x in out.splitlines() if x.strip()] if out else []

def storm(stock, n, rtag):
    """一轮写风暴（JMeter barrier 同步），完成后自动清理还原。返回指标"""
    orig, cart_ids = write_setup(stock, n)
    order_before = int(sql("SELECT IFNULL(MAX(id),0) FROM oms_order"))
    dbb = dbsnap.snapshot()
    t0 = now_iso()
    jmeter("-n", "-t", "/jmx/write_storm.jmx", f"-JTHREADS={n}", f"-JTOKEN={AUTH['portal']}",
           "-l", f"/jtl/write_{rtag}.jtl", "-j", f"/jtl/jm_write_{rtag}.log")
    t1 = now_iso()
    st = jtl.parse(os.path.join(JTL_DIR, f"write_{rtag}.jtl"))
    final = sql(f"SELECT stock, lock_stock FROM pms_sku_stock WHERE id={SKU_ID}").split("\t")
    prof = dbsnap.diff(dbb, dbsnap.snapshot(), top=10)
    order_ids = collect_orders(order_before)
    state = {"sku_id": SKU_ID, "stock": stock, "lock_stock": 0,
             "orig_stock": orig["orig_stock"], "orig_lock_stock": orig["orig_lock_stock"],
             "cart_ids": [int(x) for x in cart_ids], "member_id": 1, "order_ids": order_ids}
    write_cleanup(state)
    m = {"success": st["ok"], "failed": st["err"], "db_orders": len(order_ids),
         "tps": st["tps"], "p50_ms": st["p50_ms"], "p99_ms": st["p99_ms"],
         "final_stock": int(final[0]), "final_lock_stock": int(final[1]),
         "per_order_sql": round(prof["total_stmts"] / max(st["ok"], 1), 1),
         "sql_per_req": round(prof["total_stmts"] / max(n, 1), 1),
         "oversell": st["ok"] > stock or int(final[1]) < 0,
         "db_profile": prof, "window": {"start": t0, "end": t1}}
    if st["err"]:
        m["err_breakdown"] = st["err_breakdown"]
    log(f"  [{rtag}] 成功={m['success']} 落库={m['db_orders']} lock_stock={m['final_lock_stock']} "
        f"TPS={m['tps']} SQL/req={m['sql_per_req']} {'超卖' if m['oversell'] else 'OK'}")
    return m

log(f"== [3] 写测试 × {ROUNDS}轮：正确性 / 充足库存对照 / 读写混合 ==")
# 3.1 正确性：库存5，期望恰好5单（该拒绝的拒绝了吗）
for r in range(1, ROUNDS + 1):
    m = dict(storm(STOCK, THREADS, f"corr_r{r}"), round=r, mode="correctness")
    suite["write"].append(m)

# 3.2 充足库存对照：库存充足(线程数×5)，全部成功=拒绝机制无误杀（该成功的成功了吗）
suite["throughput"] = []
for r in range(1, ROUNDS + 1):
    m = dict(storm(THREADS * 5, THREADS, f"tput_r{r}"), round=r, mode="throughput")
    suite["throughput"].append(m)

# 3.3 读写混合：读150线程(45s) 与 写200线程(库存200) 并发
suite["mixed"] = []
for r in range(1, ROUNDS + 1):
    orig, cart_ids = write_setup(200, 200)
    order_before = int(sql("SELECT IFNULL(MAX(id),0) FROM oms_order"))
    dbb = dbsnap.snapshot()
    t0 = now_iso()
    reader = subprocess.Popen(
        ["docker", "compose", "-f", COMPOSE, "run", "--rm", "jmeter",
         "-n", "-t", "/jmx/read_test.jmx", "-JTHREADS=150", "-JDURATION=45",
         "-JPATH=/mall-portal/cart/list", f"-JTOKEN={AUTH['portal']}",
         "-l", f"/jtl/read_mix_r{r}.jtl", "-j", f"/jtl/jm_read_mix_r{r}.log"],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    jmeter("-n", "-t", "/jmx/write_storm.jmx", "-JTHREADS=200", f"-JTOKEN={AUTH['portal']}",
           "-l", f"/jtl/write_mix_r{r}.jtl", "-j", f"/jtl/jm_write_mix_r{r}.log")
    reader.wait(timeout=300)
    t1 = now_iso()
    rst = jtl.parse(os.path.join(JTL_DIR, f"read_mix_r{r}.jtl"))
    wst = jtl.parse(os.path.join(JTL_DIR, f"write_mix_r{r}.jtl"))
    prof = dbsnap.diff(dbb, dbsnap.snapshot(), top=5)
    order_ids = collect_orders(order_before)
    final = sql(f"SELECT stock, lock_stock FROM pms_sku_stock WHERE id={SKU_ID}").split("\t")
    state = {"sku_id": SKU_ID, "stock": 200, "lock_stock": 0,
             "orig_stock": orig["orig_stock"], "orig_lock_stock": orig["orig_lock_stock"],
             "cart_ids": [int(x) for x in cart_ids], "member_id": 1, "order_ids": order_ids}
    write_cleanup(state)
    m = {"round": r,
         "read_tps_under_mix": rst["tps"], "read_p50_under_mix": rst["p50_ms"],
         "read_ok_tps_under_mix": rst["ok_tps"], "read_p50_ok_under_mix": rst["ok_p50_ms"],
         "read_err_under_mix": rst["err_rate_pct"],
         "write_tps_under_mix": wst["tps"], "write_ok_tps_under_mix": wst["ok_tps"],
         "write_p50_ok_under_mix": wst.get("ok_p50_ms"),
         "write_success_under_mix": wst["ok"],
         "write_sql_per_req": round(prof["total_stmts"] / max(wst["total"], 1), 1),
         "window": {"start": t0, "end": t1}}
    if rst["err"]:
        m["read_err_breakdown"] = rst["err_breakdown"]
    if wst["err"]:
        m["write_err_breakdown"] = wst["err_breakdown"]
    suite["mixed"].append(m)
    log(f"  [混合r{r}] 读TPS={m['read_tps_under_mix']} 读P50={m['read_p50_under_mix']}ms | "
        f"写成功={m['write_success_under_mix']} 写TPS={m['write_tps_under_mix']}")

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


# ---------- 资源序列回填 (占时分布) ----------
log("== [4.5] 资源占时分布序列 ==")
try:
    suite.update(rs.collect(overall_start, overall_end))
    log(f"  容器: {', '.join(suite['res_series'].keys())}")
except Exception as e:
    log(f"  资源序列采集失败(不影响主数据): {type(e).__name__}: {e}")

# ---------- 归档 ----------
log("== [5] 归档结果 ==" + (" (预热批, 不纳入统计)" if WARM else ""))
ts = datetime.now().strftime("%Y%m%d_%H%M%S")
outdir = os.path.join(RES, f"{'warmup' if WARM else 'suite'}_{ts}")
os.makedirs(outdir, exist_ok=True)
json.dump(suite, open(os.path.join(outdir, "suite.json"), "w"), ensure_ascii=False, indent=2)
log(f"完成: {os.path.join(outdir, 'suite.json')}")
log("看板: docker compose -f document/docker/compose-local.yaml --profile report up -d dashboard → http://localhost:3000")
