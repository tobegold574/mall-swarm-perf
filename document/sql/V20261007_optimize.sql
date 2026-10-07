-- 优化迭代配套 Schema 变更
-- 1) register 并发防重：username 唯一索引（应用层 catch DuplicateKeyException 兜底）
ALTER TABLE ums_admin ADD UNIQUE INDEX uk_username (username);
