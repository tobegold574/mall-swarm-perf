#!/usr/bin/env python3
"""压测数据灌入：将商品域数据放大 3~4 个数量级，让 DB 层差异可测量
MySQL 5.7 兼容（无窗口函数，用用户变量编号）
- pms_brand 1000 / pms_product_category 500 / pms_product 10万
- pms_sku_stock 30万 / oms_order 50万 + oms_order_item 50万
"""
import subprocess, sys

def sql(q):
    r = subprocess.run(["docker", "exec", "mall-mysql", "mysql", "-uroot", "-proot", "mall",
                        "-N", "-B", "-e", q], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() + "\n失败SQL: " + q[:200])
    return r.stdout.strip()

def count(t, cond=""):
    return int(sql("SELECT COUNT(*) FROM " + t + (" WHERE " + cond if cond else "")))

LIKE_BRAND = "name LIKE '压测品牌%'"
LIKE_CAT_ROOT = "name LIKE '压测分类-父%'"
LIKE_CAT = "name LIKE '压测分类%'"
# 压测商品的唯一标记: SN前缀的product_sn (名字已多样化, 不能再用name当标记)
LIKE_PROD = "product_sn LIKE 'SN%'"

N_BRAND, N_CAT_ROOT, N_CAT_CHILD, N_PROD, N_SKU_PER, N_ORDER = 1000, 20, 480, 100000, 3, 500000

def numseq(start, rows, var="n"):
    return ("(SELECT @{} := @{} + 1 AS {} FROM information_schema.columns c1, "
            "information_schema.columns c2, (SELECT @{} := {}) i LIMIT {})").format(
                var, var, var, var, start, rows)

def main():
    have_prod = count("pms_product", LIKE_PROD)
    have_order = count("oms_order", "member_username='__bulk__'")
    print("现有: 压测商品", have_prod, "| 压测订单", have_order)
    if have_prod >= N_PROD and have_order >= N_ORDER and "--force" not in sys.argv:
        print("压测数据已就绪，跳过")
        return

    # 1) 品牌 1000
    have = count("pms_brand", LIKE_BRAND)
    if have < N_BRAND:
        sql("INSERT INTO pms_brand (name, brand_story, factory_status, show_status) "
            "SELECT CONCAT('压测品牌', n), CONCAT('品牌故事', n), 1, 1 FROM "
            + numseq(have, N_BRAND - have) + " s")
    print("品牌:", count("pms_brand", LIKE_BRAND))

    # 2) 分类：20 父 + 480 子
    have = count("pms_product_category", LIKE_CAT)
    if have < N_CAT_ROOT + N_CAT_CHILD:
        have_root = count("pms_product_category", LIKE_CAT_ROOT)
        if have_root < N_CAT_ROOT:
            sql("INSERT INTO pms_product_category (parent_id, name, level, product_count, "
                "product_unit, nav_status, show_status, sort) SELECT 0, CONCAT('压测分类-父', n), "
                "0, 0, '件', 0, 1, n FROM " + numseq(have_root, N_CAT_ROOT - have_root) + " s")
        sql("INSERT INTO pms_product_category (parent_id, name, level, product_count, "
            "product_unit, nav_status, show_status, sort) "
            "SELECT p.id, CONCAT('压测分类-子', s.n), 1, 0, '件', 0, 1, s.n FROM "
            "(SELECT id FROM pms_product_category WHERE parent_id = 0 AND " + LIKE_CAT_ROOT + ") p, "
            + numseq(0, N_CAT_CHILD) + " s")
    print("分类:", count("pms_product_category", LIKE_CAT))

    # 3) 商品 10万（品牌/子分类均匀轮转）
    have = count("pms_product", LIKE_PROD)
    if have < N_PROD:
        q = ("INSERT INTO pms_product (brand_id, product_category_id, feight_template_id, name, pic, "
             "product_sn, delete_status, publish_status, sort, sale, price, original_price, stock, "
             "low_stock, unit) "
             "SELECT b.id, c.id, 0, CONCAT("
             "ELT(1 + g.n MOD 10, '华为','小米','苹果','三星','联想','戴尔','索尼','飞利浦','美的','安克'), ' ', "
             "ELT(1 + g.n MOD 8, '智能手机','游戏本','无线蓝牙耳机','智能手表','空气净化器','变频空调','滚筒洗衣机','机械键盘'), ' ', "
             "ELT(1 + g.n MOD 6, '旗舰版','青春版','Pro','MAX','2026新款','典藏版')), '', CONCAT('SN', g.n), 0, 1, "
             "g.n MOD 100, g.n MOD 50, 10 + (g.n MOD 1000), 20 + (g.n MOD 1000), 1000, 10, '件' "
             "FROM (SELECT @rb := 0, @rc := 0) v, "
             "(SELECT @g := @g + 1 AS n FROM information_schema.columns c1, "
             "information_schema.columns c2, (SELECT @g := {}) i LIMIT {}) g, "
             "(SELECT id, @rb := @rb + 1 AS rn FROM pms_brand WHERE {} ORDER BY id) b, "
             "(SELECT id, @rc := @rc + 1 AS rn FROM pms_product_category WHERE parent_id > 0 AND {} "
             "ORDER BY id) c "
             "WHERE b.rn = g.n MOD {} + 1 AND c.rn = g.n MOD {} + 1").format(
                 have, N_PROD - have, LIKE_BRAND, LIKE_CAT, N_BRAND, N_CAT_CHILD)
        sql(q)
    print("商品:", count("pms_product", LIKE_PROD))

    # 4) SKU 每商品 3 个
    have = count("pms_sku_stock s JOIN pms_product p ON s.product_id = p.id AND " + LIKE_PROD)
    target_sku = count("pms_product", LIKE_PROD) * N_SKU_PER
    if have < target_sku:
        sql("INSERT INTO pms_sku_stock (product_id, sku_code, price, stock, low_stock, pic, sale) "
            "SELECT p.id, CONCAT('SKUB', p.id, '-', s.k), p.price + s.k, 500, 10, '', 0 FROM "
            "(SELECT id, price FROM pms_product WHERE " + LIKE_PROD + ") p, "
            "(SELECT 1 k UNION SELECT 2 UNION SELECT 3) s")
    print("SKU(压测):", have, "→ 目标", target_sku)

    # 5) 历史 50万订单 + 明细
    have = count("oms_order", "member_username='__bulk__'")
    if have < N_ORDER:
        sql("INSERT INTO oms_order (order_sn, member_id, member_username, total_amount, "
            "pay_amount, pay_type, status, order_type, delete_status, create_time, "
            "receiver_name, receiver_phone) "
            "SELECT CONCAT('BULK', LPAD(n, 12, '0')), 1, '__bulk__', 10 + (n MOD 500), "
            "10 + (n MOD 500), n MOD 3, n MOD 5, 0, 0, "
            "DATE_SUB(NOW(), INTERVAL n MINUTE), CONCAT('收件人', n), CONCAT('138', LPAD(n MOD 100000000, 8, '0')) FROM "
            + numseq(have, N_ORDER - have) + " s")
        sql("INSERT INTO oms_order_item (order_id, product_id, product_name, product_sku_id, "
            "product_price, product_quantity, product_pic) "
            "SELECT o.id, p.id, p.name, s.id, p.price, 1, '' FROM "
            "(SELECT id, name, price FROM pms_product WHERE " + LIKE_PROD + " ORDER BY id) p, "
            "(SELECT @pn := @pn + 1 AS pn, id, product_id FROM pms_sku_stock "
            "WHERE sku_code LIKE 'SKUB%' ORDER BY id) s, "
            "(SELECT id FROM oms_order WHERE member_username='__bulk__' ORDER BY id) o "
            "WHERE s.pn MOD (SELECT COUNT(*) FROM pms_product WHERE " + LIKE_PROD + ") + 1 = "
            "o.id MOD (SELECT COUNT(*) FROM pms_product WHERE " + LIKE_PROD + ") + 1")
    print("订单(压测):", count("oms_order", "member_username='__bulk__'"))

    print("=== 灌入完成 ===")

if __name__ == "__main__":
    main()

# gen_data 幂等修复说明: 子分类命名已统一为 压测分类-子N, 与统计 LIKE 压测分类