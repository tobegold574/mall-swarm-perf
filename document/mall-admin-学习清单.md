# Pms + Ums 精读清单

## Pms 域

> PmsBrand / PmsSkuStock / PmsProductCategory / PmsProductAttribute 已过，不再列；SQL/XML 见延后清单。

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| PmsProductController | /create /update/{id} /list /simpleList /update/deleteStatus /update/verifyStatus /update/publishStatus /update/recommendStatus /update/newProductStatus | PmsProductServiceImpl:69-95（7表级联）、310-325（relateAndInsertList反射复用）、97-113（SKU编码生成）、163-204（SKU diff三分）、296-299（Example的or坑）、207-231（多条件筛选）；PmsProductService.java:21/32/46（事务在接口上） | 全清单最核心；级联落库、diff更新vs全删重插、反射消除重复 |

## Ums 域

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| UmsAdminController | /register /login /info /update/{id} /updatePassword /delete/{id} /updateStatus/{id}/{status} /role/{adminId} /role/update/{adminId} /list | UmsAdminServiceImpl:89-118（login：BCrypt+权限快照进Session）、244-253（Cache-Aside读）、179/186/240/258（删缓存4个触发点）、167-177（密码null跳过技巧）、129-131（ThreadLocal取IP）、191-209（分配角色）、82（register）；UmsAdminCacheServiceImpl:26-42；application.yml:53-58（key前缀/TTL） | 缓存key三段式命名；先更库再删缓存；权限快照让网关免查库；remoteAddr反代后失效 |
| UmsRoleController | /create /update/{id} /delete /listAll /list /listMenu/{roleId} /listResource/{roleId} /allocMenu /allocResource | UmsRoleServiceImpl:88-118（allocMenu/allocResource删除重建）、分配后调initPathResourceMap（UmsResourceServiceImpl:79-89） | 权限分配=删除重建；分配后刷新Redis的PATH_RESOURCE_MAP，网关实时读，权限热更新闭环 |
| UmsMenuController | /create /update/{id} /delete/{id} /treeList /list/{parentId} /{id} | UmsMenuServiceImpl:77-104（递归建树，O(n²)）、35-48（level维护） | 对照Pms分类建树；改良靶子：groupingBy(parentId)改O(n) |

## Sms 营销域

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| SmsCouponController | /create /update/{id} /list /{id} | SmsCouponService.java:17-30（事务在接口）；SmsCouponServiceImpl:45-57（useType三分支：0全场/1限分类/2限商品，各自插不同关联表） | 一张券三选一的适用范围建模；update时useType切换不清理旧关联（见瑕疵档案）；其余SMS文件为同构模板，跳过 |

## SQL/XML 专项（延后：Java 层读完后再看，暂不执行）

| 项 | 位置 | 看点 |
|---|---|---|
| 商品聚合装配 SQL | PmsProductDao.xml:4-37 | 6表JOIN、columnPrefix解决列名冲突、resultMap collection复用、嵌套select |
| SKU 批量替换 | PmsSkuStockDao.xml:17-30 | REPLACE INTO vs ON DUPLICATE KEY UPDATE；SQL无product_id兜底 |
| 二级分类树 | PmsProductCategoryDao.xml:4-17 | 自关联JOIN+collection建树（对照UmsMenu内存递归） |
| 属性筛选 | PmsProductAttributeDao.xml:17 | type=1过滤 |
| 权限四表关联 | UmsAdminRoleRelationDao.xml:17-43 | 用户→角色→资源JOIN、GROUP BY去重、insertList批量 |
| 优惠券预览 | SmsCouponDao.xml:4-27 | resultMap继承、双collection一条SQL组装 |
| 秒杀关联商品 | SmsFlashPromotionProductRelationDao.xml:7-29 | association+columnPrefix关联pms_product |
| 各表insertList批量写法 | resources/dao/Pms*/Sms*Dao.xml | foreach多值VALUES，单语句批量插入 |

## 瑕疵档案

| 瑕疵 | 位置 |
|---|---|
| SKU diff 用 List.contains，O(n²) | PmsProductServiceImpl:163-204 |
| 审核人写死 "test" | PmsProductServiceImpl:248 |
| 用户名重复检查非原子 | UmsAdminServiceImpl.register |
| 菜单树 O(n²) | UmsMenuServiceImpl:77-104 |
| remoteAddr 反代后失效 | UmsAdminServiceImpl:129-131 |
| 优惠券useType切换后旧关联表不清理 | SmsCouponServiceImpl update |
| 秒杀场次列表逐场查productCount，N+1 | SmsFlashPromotionSessionServiceImpl:65-78 |
| 属性update不维护计数/type变更漂移 | PmsProductAttributeServiceImpl update |
| 删除属性不清理关联行 | PmsProductAttributeServiceImpl delete |
| 删属性分类无校验无级联（属性成孤儿） | PmsProductAttributeCategoryServiceImpl:42 |
| 批量删属性按首条type/分类记账（跨分类必错） | PmsProductAttributeServiceImpl:73 |
| 并发读改写丢计数（需原子SQL） | PmsProductAttributeServiceImpl:55/95 |
| 商品分类 delete 无级联校验 | PmsProductCategoryServiceImpl:105 |

## 注意

1. 查事务看 Service 接口，不是 Impl
2. 锁库存在 mall-portal，admin 没有
3. 接口上的 @Transactional 在代理模式下有效（官方7.0文档确认），仅AspectJ模式静默失效，别当成bug
4. 读完后自测：级联落库、SKU diff、权限快照、缓存失效、删除重建 vs diff，各能讲一分钟
5. SQL/XML 专项延后到数据库阶段（见上表），Java 层读完先不看
