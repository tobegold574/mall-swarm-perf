package com.macro.mall.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.macro.mall.model.PmsProduct;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface PmsProductMapper extends BaseMapper<PmsProduct> {

    /**
     * 深分页延迟关联: 内层仅扫描(删除状态, id)覆盖索引取目标页主键, 外层按主键回表,
     * 避免 LIMIT 深偏移的全行扫描。返回顺序与内层一致(按id)。
     */
    @Select("SELECT p.* FROM pms_product p " +
            "INNER JOIN (SELECT id FROM pms_product WHERE delete_status = 0 LIMIT #{offset}, #{size}) t " +
            "ON p.id = t.id ORDER BY t.id")
    List<PmsProduct> selectPageDeferred(@Param("offset") long offset, @Param("size") long size);

    /**
     * 关键词全文检索: ngram分词 + 自然语言模式, 替代 LIKE '%kw%' 全表扫描。
     * 语义差异: 相关度排序的词法匹配(非子串匹配), 搜索场景等价。
     */
    @Select("SELECT p.* FROM pms_product p WHERE p.delete_status = 0 " +
            "AND MATCH(p.name) AGAINST(#{keyword} IN NATURAL LANGUAGE MODE) LIMIT #{offset}, #{size}")
    List<PmsProduct> searchByNameFulltext(@Param("keyword") String keyword,
                                          @Param("offset") long offset, @Param("size") long size);

    @Select("SELECT COUNT(*) FROM pms_product p WHERE p.delete_status = 0 " +
            "AND MATCH(p.name) AGAINST(#{keyword} IN NATURAL LANGUAGE MODE)")
    long countByNameFulltext(@Param("keyword") String keyword);
}
