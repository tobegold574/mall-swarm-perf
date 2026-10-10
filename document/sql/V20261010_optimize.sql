-- 优化迭代第二轮 Schema 变更 (2026-10-10)
-- 1) 商品列表深分页: 内层覆盖索引扫描(删状态, id隐含)替代全表扫描
--    配套 mall-admin PmsProductServiceImpl 的延迟关联查询路径
ALTER TABLE pms_product ADD INDEX idx_delete_status (delete_status);

-- 2) 搜索接口: 商品名全文索引(ngram分词, 支持2字+中文关键词的MATCH AGAINST检索,
--    替代无法使用索引的 LIKE '%kw%' 全表扫描)
ALTER TABLE pms_product ADD FULLTEXT INDEX ft_name (name) WITH PARSER ngram;
