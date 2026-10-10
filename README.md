# mall-swarm A/B 性能优化报告（源码级归因）

> **数据来源**：同会话背靠背成对压测 —— 优化版 B（`suite_20261010_174832_abB`）vs 原版 A（`suite_20261010_181728_abA`），2026-10-10。
> **可信度**：变体身份经 **镜像指纹 + 字节码标记 + 运行时 SQL 指纹** 三重验证；结果文件经九项内部一致性审计零问题（TPS=样本/排空、账目守恒、分位数单调等）。
> 测试方法学与压测台实现见 [benchmark/](benchmark/)，上游 mall-swarm 原始文档已迁移至 [README_mall-swarm.md](README_mall-swarm.md)。

---

## TL;DR

| 维度 | 结论 |
|---|---|
| 可比读接口（7 个） | 优化版 B 全胜 |
| A 侧坏死接口（3 个） | 在 B 全部复活 |
| 下单正确性（稀缺库存） | A 超卖且账实不符；B 精确无超卖——资损级修复 |
| admin 进程 CPU | 大幅下降 |
| admin GC 重停顿 | 清零 |
| 读写混合读吞吐 | B 显著领先 |

具体数字见[第二节](#二读接口结果10-接口--3-轮中位)与[第三节](#三写路径结果)。

---

## 一、测量方法与口径（为什么这些数字可信）

- **成对协议**：B、A 在同一会话背靠背测量（B 先 A 后，中间只隔变体切换与清扫），同夹具、同预热结构、同 200 线程压力，每次变体切换后记录容器镜像 sha256 入档。
- **有效 TPS（排空口径）**：成功请求 ÷ 排空时长（首样本发出→末样本完成），规避齐射 barrier 对齐噪声；每接口 3 轮取中位数。
- **延迟分位数只统计成功样本**（成功占比 <1% 时置空不展示），P50/P95/P99。
- **写质量**：稀缺库存（5 件 / 200 人齐射 ×3 轮）测**正确性**；充足库存（1000 件）测对照；读写混合（读 150 线程 × 45s + 写 200 线程并发）测干扰下保留率。
- **失败归因语义桶**：`timeout`（读超时=慢）/ `conn_timeout`（连接建立超时=不可达）/ `client_pool_timeout`（施压侧伪失败）/ `conn` / `biz_fail`（2xx 断言失败=业务拒绝）/ `http_500`（应用异常）/ `http_502/503/504_gateway`（网关级崩溃）。
- **变体身份三重证据**：
  1. 镜像指纹：A `admin:2e620b02 / portal:42b3e863`（10-07 快照），B `admin:a8a5175f / portal:646479a6`（10-10 构建）；
  2. 字节码标记：B 镜像含全部优化标记（COUNT 缓存/失效钩子/延迟关联/全文检索），A 镜像 0/4；A 的订单类为**修复前**的 `setLockStock` 读-改-写实现；
  3. SQL 运行时指纹（performance_schema 抓取）：见[第五节](#五sql-指纹证据为什么-ais-a-b-is-b)。
- **压测夹具**：100,038 商品（100,020 有效）/ 1,024 品牌，商品名为「品牌×品类×版本」多样化组合（正确 UTF-8）；探针关键词「手机」命中 **12,504** 行，`MATCH` 与 `LIKE` 命中集合经 DB 实测完全一致（语义等价）。

---

## 二、读接口结果（10 接口 × 3 轮中位）

有效 TPS = 成功请求/排空时长；P50 为成功样本中位延迟（ms）。

| 接口 | A 有效TPS | B 有效TPS | 提升 | A P50 | B P50 | A 侧状态 |
|---|---:|---:|---:|---:|---:|---|
| portal_product_detail | 125.6 | **448.9** | **+257%** | 1103 | 303 | 正常 |
| portal_home_content | 130.0 | **425.9** | **+228%** | 1117 | 307 | 正常 |
| admin_brand_list | 198.8 | **690.6** | **+247%** | 711 | 102 | 正常 |
| portal_cart_list | 735.0 | **1308.9** | **+78%** | 202 | 102 | 正常 |
| portal_member_info | 1145.8 | **1714.1** | **+50%** | 103 | 97 | 正常 |
| admin_product_list | 82.0 | 88.7 | +8%（持平带） | 2203 | 2098 | 正常 |
| portal_search_kw | 7.0 | **151.4** | **+2063%** | 21549 | 1198 | LIKE 全表扫描（err 1.79%） |
| admin_category_tree | 0 有效 | **181.7** | **质变** | — | 179 | 100% 读超时（失败样本 P50 30.3s） |
| admin_product_deeppage | 0 有效 | **299.6** | **质变** | — | 603 | 100% HTTP 503 网关崩溃 |
| portal_bulk_detail | 0 有效 | **665.7** | **质变** | — | 215 | 100% HTTP 500（空指针） |

> `admin_product_list` 第一页（offset 0 < 阈值 1000）两侧走同构的原生路径，持平符合设计；它的深分页部分见 `admin_product_deeppage`。

---

## 三、写路径结果

### 3.1 正确性（稀缺库存：5 件 / 200 人齐射 ×3 轮）——资损级

| | 成功单 | 落库单 | 终态 lock_stock | 判定 |
|---|---|---|---|---|
| **A 原版** | **200/200/200** | 200/200/200 | **[5, 4, 5]** | 🔴 3/3 轮超卖 + 账实不符 |
| **B 优化** | **5/5/5** | 5/5/5（拒绝 195/轮） | **[5, 5, 5]** | 🟢 精确无超卖 |

A 的病根是 Java 侧**读-改-写**（读库存→内存判断→整行 UPDATE 回写）：200 线程读到同一快照、全部通过判断、互相覆盖 → 超卖 + 丢失更新（账本 lock_stock 与订单数对不上）。
B 改为**数据库原子守卫扣减**（见 [4.9](#49-c94a419--fixlock_stock-并发超卖修复-generateorder-事务补齐)），并发由行锁裁决，`rows=0` 即拒绝。

### 3.2 齐射对照（充足库存 1000 件 / 200 人 ×3 轮）——验证"不误杀"

| | TPS（排空口径） | 齐射 P50 | 终态 lock_stock |
|---|---|---|---|
| A | [103.4, 96.2, 101.9] | [1003, 1106, 1162] ms | **[4, 5, 5]**（账本坏） |
| B | [99.5, 110.7, 111.9] | [1126, 1102, 1098] ms | **[200, 200, 200]**（分毫不差） |

齐射 P50 双方持平（~1.1s）：200 笔同抢是 **MySQL 行锁墙**，瓶颈在数据库层——如实报告。该轮证明 B 的守卫机制**零误杀**（该成功的 200 单全部成功）。

### 3.3 读写混合（读 150 线程×45s + 写 200 线程并发 ×3 轮）

| | 读有效TPS（中位） | 写成功 |
|---|---:|---|
| A | 404 | 200/轮 |
| B | **1180**（2.9×） | 200/轮 |

### 3.4 每单 SQL 开销（正确性轮）

A **16.0** 条/单 → B **4.9** 条/单（事务收窄 + 设置缓存，见 [4.3](#43-1156328--fix订单延迟取消消息移至事务提交后发送订单设置堆内缓存)）。

---

## 四、优化清单 → 源码映射（核心）

按"接口现象 → 根因 → 更改 → 实测"组织。提交均在 master，可 `git show <hash>` 复核。

### 4.1 `edc7180` — perf(admin): 分类树双缓存 + WebLog 切面 INFO 短路 + VT 开关

- **文件**：`mall-admin/.../PmsProductCategoryServiceImpl.java`、`PmsProductCategoryController.java`、`mall-admin/src/main/resources/application.yml`、`mall-common/.../WebLogAspect.java`、`mall-auth/src/main/resources/application.yml`
- **根因**：树接口每请求加载全部分类 + 递归组装 + 序列化 588KB JSON；WebLog 切面对每个请求做反射 + 响应体序列化。
- **更改**：树对象 + 预序列化字节双层缓存（60s TTL，双重检查锁，命中直接输出字节，与原输出逐字节一致）；切面 INFO 级短路；admin/auth 开启虚拟线程。
- **实测**：`admin_category_tree` 从 100% 读超时（失败 P50 30.3s）→ **181.7 TPS / P50 179ms**；`admin_brand_list` +247%（SQL 指纹与 A 完全一致，增益全部来自服务层：切面短路 + VT）。

### 4.2 `6ca3851` — perf(portal): 详情/首页 VT 并行化 + 属性堆缓存 + 搜索全文优先降级 + Druid 池容

- **文件**：`mall-portal/.../PmsPortalProductServiceImpl.java`、`HomeServiceImpl.java`、`mall-portal/src/main/resources/application.yml`
- **根因**：详情接口 6+ 个查询串行往返；首页内容多查询串行；批量生成的商品存在空字段触发 NPE（A 侧 `portal_bulk_detail` 100% HTTP 500 的直接原因）。
- **更改**：详情改为虚拟线程一轮并行（品牌/属性/SKU/阶梯/满减/优惠券），属性列表按分类 ID 堆内缓存（60s TTL）；首页同样并行化；详情对空 `attributeCategoryId` 等空值防御；搜索"全文优先、0 命中回落 LIKE"；连接池扩容。
- **实测**：`portal_product_detail` +257%、`portal_home_content` +228%、`portal_cart_list` +78%、`portal_member_info` +50%、`portal_bulk_detail` 500→**665.7 TPS**。

### 4.3 `1156328` — fix(订单): 延迟取消消息移至事务提交后发送 + 订单设置堆内缓存

- **文件**：`mall-portal/.../OmsPortalOrderServiceImpl.java`（字节码验证：B 镜像含 `OmsPortalOrderServiceImpl$1` afterCommit 同步器，A 镜像无）
- **根因**：事务内发 MQ（网络往返占用数据库连接与锁持有时间）；订单设置每单查库。
- **更改**：MQ 消息注册到 `afterCommit`（事务提交后才发）；订单设置堆内缓存。
- **实测**：每单 SQL 16.0 → **4.9**；混合轮读吞吐保留率提升（404 → 1180）。

### 4.4 `3777a87` — perf(SQL): 深分页延迟关联 + ngram 全文索引 + 删除状态索引

- **文件**：`document/sql/V20261010_optimize.sql`、`mall-admin/.../mapper/PmsProductMapper.java`
- **更改**：
  - `idx_delete_status`：逻辑删过滤列索引（此前过滤无索引可走）；
  - `ft_name`：商品名 **ngram 全文索引**（`WITH PARSER ngram`，二元滑窗，词元→行倒排表）；
  - `selectPageDeferred`：**延迟关联**分页——内层覆盖索引只取 id（`LIMIT offset,10`），外层回表仅 10 行，把"扫过 offset"的成本从整行变为纯索引；
  - `searchByNameFulltext / countByNameFulltext`：全文检索与计数 SQL。
- **实测**：深分页与搜索的 SQL 底座（效果见 4.5/4.7）。

### 4.5 `37e01d8` + `7d24007` — 延迟关联路径接入 + 偏移阈值

- **文件**：`mall-admin/.../PmsProductServiceImpl.java`
- **更改**：无过滤列表接入延迟关联；**offset ≥ 1000 才启用**——浅页走原生路径（`LIMIT 0,10` 本就只碰 10 行，延迟关联无收益），深页走延迟关联。
- **实测**：`admin_product_deeppage`（offset 25000）A 侧 100% HTTP 503 网关崩溃（**6.9 万个失败样本，0 条 SQL 到达数据库**——应用在网关前就塌了）→ B **299.6 TPS / P50 603ms**，且每请求 SQL 从 2 条降为 **1.0 条**（COUNT 走缓存，见 4.6）。

### 4.6 `8c3af1c` + `dbe6bfb` — total 的 COUNT 缓存

- **文件**：`mall-admin/.../PmsProductServiceImpl.java`（5s TTL + 商品新增/逻辑删失效钩子）、`mall-portal/.../PmsPortalProductServiceImpl.java`（搜索全文 COUNT 缓存，60s TTL）
- **根因**：每请求 `SELECT COUNT(*)` 对 10 万行做覆盖索引扫描（A 侧窗口累计 632~649 秒/轮）；全文计数同理。
- **实测**：B 深分页每轮 COUNT 仅执行 1 次（TTL 跨轮重建），搜索窗口内 COUNT **0 次**；`dbe6bfb` 修正了 ftCountCache 初版"注释 60s TTL 但实现永不过期"的缺陷。

### 4.7 搜索链路整体（4.4 + 4.2 + 4.6 合力）

`portal_search_kw`（关键词「手机」，命中 12,504 行）：

| | A（LIKE '%kw%'） | B（MATCH...AGAINST） |
|---|---|---|
| 原理 | 前导通配符使索引失效 → 10 万行逐行读+匹配（O(全表)） | 倒排表直查词元→行列表（O(命中数)） |
| 每请求 SQL | 2 条（COUNT LIKE + 分页 LIKE，窗口累计 1,826s） | **1 条**（COUNT 走缓存） |
| 有效TPS / P50 | 7.0 / 21,549ms | **151.4 / 1,198ms**（+2063%） |

语义说明：ngram 全文是相关度匹配、LIKE 是子串匹配；对本探针词两者命中集合经 DB 验证完全一致（12,504 行）。0 命中词自动回落 LIKE，**永不丢结果**。

### 4.8 `6cb671d` — chore(compose): 网关内存限额 1g

唯一未设限的容器；转发 588KB 树响应体需要直接内存余量，防止堆外挤压（配合 4.1 的字节直出）。

### 4.9 `c94a419` — fix: lock_stock 并发超卖修复 + generateOrder 事务补齐

- **文件**：`mall-portal/.../OmsPortalOrderServiceImpl.java`（`lockStock` 三步读-改-写 → MP `LambdaUpdateWrapper` 原子条件更新）
- **字节码验证**：A 镜像含 `setLockStock`（修复前实现）、不含守卫 SQL 片段；B 镜像相反——即本次测得的超卖对比正是该修复的效果。
- **实测**：见[第三节 3.1](#31-正确性稀缺库存5-件--200-人齐射-3-轮资损级)。

### 4.10 测试台与看板（保证以上数字可信的装置）

`430f3b0` 压测台 v4（成对协议/有效口径/自愈探针/目录多样化）、`1035e61` 根路径 A/B 对比看板、`71b326d` 退役无效的齐射 TPS 口径、`57bfdb0` 失败归因语义化。

---

## 五、SQL 指纹证据（为什么 A is A、B is B）

测量窗口内 performance_schema 抓到的关键语句：

| 场景 | A（原版）实测 | B（优化）实测 |
|---|---|---|
| 搜索 | `COUNT(... NAME LIKE ?)` + `LIKE` 分页，**每请求 2 条** | `MATCH(name) AGAINST(...)` 每请求 1 条，COUNT 窗口内 **0 次** |
| 深分页 | **0 条 SQL 到达 DB**（503，应用已崩溃） | 延迟关联 JOIN ×4601 + COUNT 每轮 1 次 |
| 下单扣减 | 整行 `UPDATE pms_sku_stock SET product_id=?,...` ×200（累计 89.5s 锁等待） | 守卫 `UPDATE ... WHERE id=? AND lock_stock+?<=stock`，195 次 ROLLBACK=195 单被正确拒绝 |

索引现状：`pms_product` 上 `PRIMARY` + `idx_delete_status` + `ft_name(FULLTEXT)` 三索引并存——B-Tree 干等值/范围/分页，倒排干词元匹配，各司其职。

---

## 六、资源（admin 容器，测量窗口均值）

| | A | B |
|---|---|---|
| CPU | 0.82 核 | **0.08 核**（-90%） |
| 内存 | 727 MB | 606 MB |
| GC 总停顿 / 次数 | 3.12s / 256 次 | **0.94s / 172 次** |
| 重停顿（≥25ms） | **23 次** | **0 次** |

---

## 七、复现指南

```bash
# 环境：docker compose（document/docker/compose-local.yaml，网关限额 1g）
cd benchmark
bash ab_compare.sh all          # 成对测量：预热→B测量批→切A→A测量批→恢复B，约 50 分钟
python3 jtl.py <jtl文件>         # 单文件口径解析（排空TPS/归因/成功样本分位）

# 看板（根路径即 A/B 对比）
cd dashboard-next && npm install && npm run dev   # http://localhost:3000

# 结果归档
ls results/suite_*_ab{A,B}/suite.json   # env指纹 + 读10接口×3轮 + 写3+齐射3 + 混合3 + 资源序列
```

口径实现：`benchmark/run_suite.py`（编排与 DB 指纹）、`benchmark/jtl.py`（JTL 解析与归因）。

---

## 附

- 上游 mall-swarm 项目文档（部署/架构/各模块说明）：[README_mall-swarm.md](README_mall-swarm.md)
- 优化系列提交（master，按刀分组）：`c94a419` → `edc7180` / `6ca3851` / `1156328` / `3777a87` → `37e01d8` / `7d24007` → `8c3af1c` / `dbe6bfb` → `430f3b0` / `1035e61` / `71b326d` / `57bfdb0`
