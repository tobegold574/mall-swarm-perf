package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.dao.PmsProductCategoryAttributeRelationDao;
import com.macro.mall.dao.PmsProductCategoryDao;
import com.macro.mall.dto.PmsProductCategoryParam;
import com.macro.mall.dto.PmsProductCategoryWithChildrenItem;
import com.macro.mall.mapper.PmsProductCategoryAttributeRelationMapper;
import com.macro.mall.mapper.PmsProductCategoryMapper;
import com.macro.mall.mapper.PmsProductMapper;
import com.macro.mall.model.*;
import com.macro.mall.service.PmsProductCategoryService;
import org.springframework.util.CollectionUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * PmsProductCategoryService实现类
 * Created by macro on 2018/4/26.
 */
@Service
public class PmsProductCategoryServiceImpl implements PmsProductCategoryService {
    @Autowired
    private PmsProductCategoryMapper productCategoryMapper;
    @Autowired
    private PmsProductMapper productMapper;
    @Autowired
    private PmsProductCategoryAttributeRelationDao productCategoryAttributeRelationDao;
    @Autowired
    private PmsProductCategoryAttributeRelationMapper productCategoryAttributeRelationMapper;
    @Autowired
    private PmsProductCategoryDao productCategoryDao;
    @Override
    public int create(PmsProductCategoryParam pmsProductCategoryParam) {
        // 创建新属性实体
        PmsProductCategory productCategory = new PmsProductCategory();
        // 初始化冗余计数器为 0
        productCategory.setProductCount(0);
        // 名字、父分类、id等等字段从 Param 批量抄入
        BeanUtils.copyProperties(pmsProductCategoryParam, productCategory);
        // 推导分类层级
        setCategoryLevel(productCategory);
        // 落库（新的主键会自动回填回对象）
        int count = productCategoryMapper.insert(productCategory);
        // 创建筛选属性关联
        List<Long> productAttributeIdList = pmsProductCategoryParam.getProductAttributeIdList();
        if(!CollectionUtils.isEmpty(productAttributeIdList)){
            // 挂筛选属性
            insertRelationList(productCategory.getId(), productAttributeIdList);
        }
        return count;
    }

    /**
     * 批量插入商品分类与筛选属性关系表
     * @param productCategoryId 商品分类id
     * @param productAttributeIdList 相关商品筛选属性id集合
     */
    private void insertRelationList(Long productCategoryId, List<Long> productAttributeIdList) {
        List<PmsProductCategoryAttributeRelation> relationList = new ArrayList<>();
        for (Long productAttrId : productAttributeIdList) {
            // 一个空关联对象，调用两次 setter，没别的复杂的
            PmsProductCategoryAttributeRelation relation = new PmsProductCategoryAttributeRelation();
            relation.setProductAttributeId(productAttrId);
            relation.setProductCategoryId(productCategoryId);
            relationList.add(relation);
        }
        productCategoryAttributeRelationDao.insertList(relationList);
    }

    @Override
    public int update(Long id, PmsProductCategoryParam pmsProductCategoryParam) {
        PmsProductCategory productCategory = new PmsProductCategory();
        productCategory.setId(id);
        BeanUtils.copyProperties(pmsProductCategoryParam, productCategory);
        setCategoryLevel(productCategory);
        //更新商品分类时要更新商品中的名称
        PmsProduct product = new PmsProduct();
        // 冗余列更新，避免重复联表查询
        product.setProductCategoryName(productCategory.getName());
        // 落库
        productMapper.update(product, new LambdaUpdateWrapper<PmsProduct>()
                .eq(PmsProduct::getProductCategoryId, id));
        //同时更新筛选属性的信息
        // 有则删除后插入，无则直接全部删除
        if(!CollectionUtils.isEmpty(pmsProductCategoryParam.getProductAttributeIdList())){
            productCategoryAttributeRelationMapper.delete(new LambdaQueryWrapper<PmsProductCategoryAttributeRelation>()
                    .eq(PmsProductCategoryAttributeRelation::getProductCategoryId, id));
            insertRelationList(id,pmsProductCategoryParam.getProductAttributeIdList());
        }else{
            productCategoryAttributeRelationMapper.delete(new LambdaQueryWrapper<PmsProductCategoryAttributeRelation>()
                    .eq(PmsProductCategoryAttributeRelation::getProductCategoryId, id));
        }
        return productCategoryMapper.updateById(productCategory);
    }

    @Override
    public List<PmsProductCategory> getList(Long parentId, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum, pageSize);
        return productCategoryMapper.selectList(new LambdaQueryWrapper<PmsProductCategory>()
                .eq(PmsProductCategory::getParentId, parentId)
                .orderByDesc(PmsProductCategory::getSort));
    }

    @Override
    public int delete(Long id) {
        return productCategoryMapper.deleteById(id);
    }

    @Override
    public PmsProductCategory getItem(Long id) {
        return productCategoryMapper.selectById(id);
    }

    @Override
    public int updateNavStatus(List<Long> ids, Integer navStatus) {
        PmsProductCategory productCategory = new PmsProductCategory();
        productCategory.setNavStatus(navStatus);
        return productCategoryMapper.update(productCategory, new LambdaUpdateWrapper<PmsProductCategory>()
                .in(PmsProductCategory::getId, ids));
    }

    @Override
    public int updateShowStatus(List<Long> ids, Integer showStatus) {
        PmsProductCategory productCategory = new PmsProductCategory();
        productCategory.setShowStatus(showStatus);
        return productCategoryMapper.update(productCategory, new LambdaUpdateWrapper<PmsProductCategory>()
                .in(PmsProductCategory::getId, ids));
    }

    @Override
    public List<PmsProductCategoryWithChildrenItem> listWithChildren() {
        return productCategoryDao.listWithChildren();
    }

    /**
     * 根据分类的parentId设置分类的level
     * 多叉树，按照业务划分最多 2 级
     */
    private void setCategoryLevel(PmsProductCategory productCategory) {
        //没有父分类时为一级分类
        if (productCategory.getParentId() == 0) {
            productCategory.setLevel(0);
        } else {
            //有父分类时选择根据父分类level设置
            PmsProductCategory parentCategory = productCategoryMapper.selectById(productCategory.getParentId());
            if (parentCategory != null) {
                productCategory.setLevel(parentCategory.getLevel() + 1);
            } else {
                productCategory.setLevel(0);
            }
        }
    }
}
