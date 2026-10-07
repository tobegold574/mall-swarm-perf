package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.PageHelper;
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

import java.util.List;

/**
 * 商品属性Service实现类
 * Created by macro on 2018/4/26.
 */
@Service
public class PmsProductAttributeServiceImpl implements PmsProductAttributeService {
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
    public int create(PmsProductAttributeParam pmsProductAttributeParam) {
        // 组装与落库
        PmsProductAttribute pmsProductAttribute = new PmsProductAttribute();
        BeanUtils.copyProperties(pmsProductAttributeParam, pmsProductAttribute);
        int count = productAttributeMapper.insert(pmsProductAttribute);
        //新增商品属性以后需要更新商品属性分类数量
        PmsProductAttributeCategory pmsProductAttributeCategory = productAttributeCategoryMapper.selectById(pmsProductAttribute.getProductAttributeCategoryId());
        // 根据属性分类
        if(pmsProductAttribute.getType()==0){   // 按照规格来（参与 SKU 生成）
            pmsProductAttributeCategory.setAttributeCount(pmsProductAttributeCategory.getAttributeCount()+1);
        }else if(pmsProductAttribute.getType()==1){     // 按照参数来（纯展示）
            pmsProductAttributeCategory.setParamCount(pmsProductAttributeCategory.getParamCount()+1);
        }
        productAttributeCategoryMapper.updateById(pmsProductAttributeCategory);
        return count;
    }

    @Override
    public int update(Long id, PmsProductAttributeParam productAttributeParam) {
        PmsProductAttribute pmsProductAttribute = new PmsProductAttribute();
        pmsProductAttribute.setId(id);
        BeanUtils.copyProperties(productAttributeParam, pmsProductAttribute);
        return productAttributeMapper.updateById(pmsProductAttribute);
    }

    @Override
    public PmsProductAttribute getItem(Long id) {
        return productAttributeMapper.selectById(id);
    }

    @Override
    public int delete(List<Long> ids) {
        //获取分类
        // 这里只将第一条数据作为更新源，与前端只会出现同类数据对应，但后续如出现跨分类更新，则会静默漂移
        PmsProductAttribute pmsProductAttribute = productAttributeMapper.selectById(ids.get(0));
        Integer type = pmsProductAttribute.getType();
        PmsProductAttributeCategory pmsProductAttributeCategory = productAttributeCategoryMapper.selectById(pmsProductAttribute.getProductAttributeCategoryId());
        int count = productAttributeMapper.delete(new LambdaQueryWrapper<PmsProductAttribute>()
                .in(PmsProductAttribute::getId, ids));
        //删除完成后修改数量
        // 防负数
        if(type==0){
            if(pmsProductAttributeCategory.getAttributeCount()>=count){
                pmsProductAttributeCategory.setAttributeCount(pmsProductAttributeCategory.getAttributeCount()-count);
            }else{
                pmsProductAttributeCategory.setAttributeCount(0);
            }
        }else if(type==1){
            if(pmsProductAttributeCategory.getParamCount()>=count){
                pmsProductAttributeCategory.setParamCount(pmsProductAttributeCategory.getParamCount()-count);
            }else{
                pmsProductAttributeCategory.setParamCount(0);
            }
        }
        productAttributeCategoryMapper.updateById(pmsProductAttributeCategory);
        return count;
    }

    @Override
    public List<ProductAttrInfo> getProductAttrInfo(Long productCategoryId) {
        return productAttributeDao.getProductAttrInfo(productCategoryId);
    }
}
