#!/usr/bin/env python3
"""清理 write_test.py 留下的测试数据，恢复现场，使流程可复用

- 删除测试产生的 oms_order / oms_order_item
- 恢复目标 SKU 的 stock / lock_stock 到下单前快照
- 删除测试购物车行
用法: python3 cleanup_write_test.py
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "results", "write_test_state.json")
CART_MARK = "bench-test"

def sql(query):
    r = subprocess.run(["docker", "exec", "mall-mysql", "mysql", "-uroot", "-proot",
                        "mall", "-N", "-B", "-e", query],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"SQL失败: {r.stderr.strip()}")
    return r.stdout.strip()

if not os.path.exists(STATE):
    raise SystemExit("未找到 write_test_state.json，没有需要清理的数据")

s = json.load(open(STATE))
sku_id = s["sku_id"]
order_ids = s.get("order_ids", [])
cart_ids = s.get("cart_ids", [])
print(f"清理范围: 订单 {len(order_ids)} 单, 购物车 {len(cart_ids)} 行, SKU={sku_id}", flush=True)

if order_ids:
    ids = ",".join(map(str, order_ids))
    sql(f"DELETE FROM oms_order_item WHERE order_id IN ({ids})")
    sql(f"DELETE FROM oms_order WHERE id IN ({ids})")
    left = int(sql(f"SELECT COUNT(*) FROM oms_order WHERE id IN ({ids})"))
    print(f"  测试订单已删除 (残留 {left})", flush=True)

sql(f"UPDATE pms_sku_stock SET stock={s['orig_stock']}, lock_stock={s['orig_lock_stock']} WHERE id={sku_id}")
now = sql(f"SELECT stock, lock_stock FROM pms_sku_stock WHERE id={sku_id}")
print(f"  SKU 已恢复到原始值: stock/lock_stock = {now} (原始 {s['orig_stock']}/{s['orig_lock_stock']})", flush=True)

if cart_ids:
    ids = ",".join(map(str, cart_ids))
    sql(f"DELETE FROM oms_cart_item WHERE id IN ({ids}) OR (member_id={s['member_id']} AND member_nickname='{CART_MARK}')")
    left = int(sql(f"SELECT COUNT(*) FROM oms_cart_item WHERE member_id={s['member_id']} AND member_nickname='{CART_MARK}'"))
    print(f"  测试购物车已删除 (残留 {left})", flush=True)

os.remove(STATE)
print("清理完成，write_test.py 可重复执行", flush=True)
