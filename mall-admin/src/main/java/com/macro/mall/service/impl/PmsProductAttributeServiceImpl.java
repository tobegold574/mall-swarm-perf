package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.common.exception.Asserts;
import com.macro.mall.dao.PmsProductAttributeDao;
import com.macro.mall.dto.PmsProductAttributeParam;
import com.macro.mall.dto.ProductAttrInfo;
import com.macro.mall.mapper.PmsProductAttributeCategoryMapper;
import com.macro.mall.mapper.PmsProductAttributeMapper;
import com.macro.mall.model.PmsProductAttribute;
import com.macro.mall.model.PmsProductAttributeCategory;
import com.macro.mall.service.PmsProductAttributeService;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 商品属性Service实现类
 * Created by macro on 2018/4/26.
 */
@Service
public class PmsProductAttributeServiceImpl implements PmsProductAttributeService {
    /** 类型：0->规格（参与SKU生成），1->参数（纯展示） */
    private static final int TYPE_SPEC = 0;
    private static final int TYPE_PARAM = 1;

    @Autowired
    private PmsProductAttributeMapper productAttributeMapper;
    @Autowired
    private PmsProductAttributeCategoryMapper productAttributeCategoryMapper;
    @Autowired
    private PmsProductAttributeDao productAttributeDao;

    @Override
    public List<PmsProductAttribute> getList(Long cid, Integer type, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum, pageSize);
        return productAttributeMapper.selectList(new LambdaQueryWrapper<PmsProductAttribute>()
                .eq(PmsProductAttribute::getProductAttributeCategoryId, cid)
                .eq(PmsProductAttribute::getType, type)
                .orderByDesc(PmsProductAttribute::getSort));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int create(PmsProductAttributeParam pmsProductAttributeParam) {
        // 组装与落库
        PmsProductAttribute pmsProductAttribute = new PmsProductAttribute();
        BeanUtils.copyProperties(pmsProductAttributeParam, pmsProductAttribute);
        int count = productAttributeMapper.insert(pmsProductAttribute);
        // 新增属性后原子递增分类计数（原为查-改-写，并发下丢计数）
        adjustCategoryCount(pmsProductAttribute.getProductAttributeCategoryId(),
                pmsProductAttribute.getType(), 1);
        return count;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int update(Long id, PmsProductAttributeParam productAttributeParam) {
        PmsProductAttribute old = productAttributeMapper.selectById(id);
        if (old == null) {
            Asserts.fail("属性不存在");
        }
        PmsProductAttribute pmsProductAttribute = new PmsProductAttribute();
        pmsProductAttribute.setId(id);
        BeanUtils.copyProperties(productAttributeParam, pmsProductAttribute);
        int rows = productAttributeMapper.updateById(pmsProductAttribute);
        // 修复计数漂移：type 或所属分类变更时，旧分类旧类型 -1、新分类新类型 +1（均原子）
        boolean typeChanged = pmsProductAttribute.getType() != null
                && !pmsProductAttribute.getType().equals(old.getType());
        boolean categoryChanged = pmsProductAttribute.getProductAttributeCategoryId() != null
                && !pmsProductAttribute.getProductAttributeCategoryId().equals(old.getProductAttributeCategoryId());
        if (rows > 0 && (typeChanged || categoryChanged)) {
            int oldType = typeChanged ? old.getType() : pmsProductAttribute.getType();
            Long oldCategoryId = categoryChanged ? old.getProductAttributeCategoryId()
                    : pmsProductAttribute.getProductAttributeCategoryId();
            int newType = pmsProductAttribute.getType() != null ? pmsProductAttribute.getType() : old.getType();
            Long newCategoryId = pmsProductAttribute.getProductAttributeCategoryId() != null
                    ? pmsProductAttribute.getProductAttributeCategoryId() : old.getProductAttributeCategoryId();
            if (oldCategoryId.equals(newCategoryId) && oldType == newType) {
                return rows;
            }
            adjustCategoryCount(oldCategoryId, oldType, -1);
            adjustCategoryCount(newCategoryId, newType, 1);
        }
        return rows;
    }

    @Override
    public PmsProductAttribute getItem(Long id) {
        return productAttributeMapper.selectById(id);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int delete(List<Long> ids) {
        // 修复跨分类批量删除记账错误：先取全量待删属性，按(分类,类型)分组后逐组原子扣减
        List<PmsProductAttribute> attrs = productAttributeMapper.selectList(
                new LambdaQueryWrapper<PmsProductAttribute>().in(PmsProductAttribute::getId, ids));
        if (attrs.isEmpty()) {
            return 0;
        }
        int count = productAttributeMapper.delete(
                new LambdaQueryWrapper<PmsProductAttribute>().in(PmsProductAttribute::getId, ids));
        Map<Long, Map<Integer, Long>> grouped = attrs.stream().collect(
                Collectors.groupingBy(PmsProductAttribute::getProductAttributeCategoryId,
                        Collectors.groupingBy(PmsProductAttribute::getType, Collectors.counting())));
        grouped.forEach((categoryId, byType) -> byType.forEach((type, num) ->
                adjustCategoryCount(categoryId, type, -num)));
        return count;
    }

    @Override
    public List<ProductAttrInfo> getProductAttrInfo(Long productCategoryId) {
        return productAttributeDao.getProductAttrInfo(productCategoryId);
    }

    /**
     * 原子调整分类的属性计数（attribute_count / param_count），GREATEST 防负数
     */
    private void adjustCategoryCount(Long categoryId, Integer type, long delta) {
        String column = (type != null && type == TYPE_PARAM) ? "param_count" : "attribute_count";
        LambdaUpdateWrapper<PmsProductAttributeCategory> wrapper = new LambdaUpdateWrapper<PmsProductAttributeCategory>()
                .eq(PmsProductAttributeCategory::getId, categoryId);
        if (delta >= 0) {
            wrapper.setSql(column + " = " + column + " + {0}", delta);
        } else {
            wrapper.setSql(column + " = GREATEST(" + column + " - {0}, 0)", -delta);
        }
        productAttributeCategoryMapper.update(null, wrapper);
    }
}
