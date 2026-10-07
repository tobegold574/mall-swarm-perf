# mall-portal 精读清单

## 一、会员与登录

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| UmsMemberController | /register /login /info /updatePassword /getAuthCode | UmsMemberServiceImpl:148-171（login：StpMemberUtil 多账号体系，loginType="memberLogin"，JWT风格token，与 admin 的 StpUtil 完全隔离）、:49-55（getByUsername唯一键取get(0)）、:116-118（验证码校验） | 本 Controller 唯一的新知识是多账号体系 |

## 二、购物车

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| OmsCartItemController | /add /list /update/quantity /delete /clear /getProduct /list/promotion | OmsCartItemServiceImpl:44-59（add：同会员+同商品+同规格→合并数量）、list 调 promotionService.calcCartPromotionItem（购物车促销计算） | 购物车在 MySQL（oms_cart_item），不在 Redis |

## 三、商品与首页

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| PmsPortalProductController | /detail /search /categoryTreeList | PmsPortalProductServiceImpl.detail（聚合商品+属性+促销） | 前台聚合接口 |
| HomeController | /content /productList | HomeServiceImpl（一次聚合首页全板块） | 聚合接口模式 |

## 四、收藏与浏览历史（全项目唯一的 MongoDB 用法）

| Controller | 端点 | 精读点 | 说明 |
|---|---|---|---|
| MemberAttentionController / MemberProductCollectionController / MemberReadHistoryController | 品牌收藏 / 商品收藏 / 浏览历史 | 三个 Service 均为 Spring Data MongoDB（MongoRepository，portal/repository/）；MemberReadHistory 用 Mongo 记录浏览轨迹 | 本项目唯一的 MongoDB 实战 |

## 五、优惠券

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| UmsMemberCouponController | /add/{couponId} /list | UmsMemberCouponServiceImpl.add（:19 事务：校验已领/领取上限→生成领取记录） | 对照 admin 侧的券创建 |

## 六、订单链路（全项目业务最硬，重点）

| Controller/组件 | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| OmsPortalOrderController | /generateConfirmOrder /generateOrder /paySuccess /cancelOrder /confirmReceiveOrder /delete | OmsPortalOrderService.java 接口 5 处 @Transactional（:25/31/37/43/74）；OmsPortalOrderServiceImpl:70-186（generateOrder：购物车→优惠券核验→金额分摊→锁库存→插订单→发延时消息）、:443（Redis 自增生成订单号） | 全项目业务最硬，逐段精读 |
| CancelOrderSender / CancelOrderReceiver / OrderTimeOutCancelTask | — | RabbitMQ 延时消息取消 + @Scheduled 定时兜底，双保险模式 | 消息丢失由定时任务兜底 |

## 七、支付

| Controller | 端点 | 精读点（文件:行） | 说明 |
|---|---|---|---|
| AlipayController | /pay /query /callback 等 | AlipayServiceImpl（沙箱下单、异步回调验签） | 沙箱密钥在 Nacos 配置 |

## 注意

1. 购物车在 MySQL（oms_cart_item 表），不在 Redis
2. Redis 在 portal 仅一处真实使用：订单号生成用 redisService.incr 自增序列（OmsPortalOrderServiceImpl:443）
3. cancelOrder 无分布式锁（无 Redisson），靠 status=0 条件查询防重；多实例部署有重复取消风险（改良候选）
4. 订单链路的事务都在 OmsPortalOrderService 接口上（:25/31/37/43/74）
5. 数据库/XML 层（PortalOrderDao.xml 锁库存、批量插订单项）按约定不在本清单，读订单流程时按需参考
