package com.macro.mall.portal.service.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.*;
import com.macro.mall.model.*;
import com.macro.mall.portal.dao.PortalProductDao;
import com.macro.mall.portal.domain.PmsPortalProductDetail;
import com.macro.mall.portal.domain.PmsProductCategoryNode;
import com.macro.mall.portal.service.PmsPortalProductService;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 前台订单管理Service实现类
 * Created by macro on 2020/4/6.
 */
@Service
public class PmsPortalProductServiceImpl implements PmsPortalProductService {
    @Autowired
    private PmsProductMapper productMapper;
    @Autowired
    private PmsProductCategoryMapper productCategoryMapper;
    @Autowired
    private PmsBrandMapper brandMapper;
    @Autowired
    private PmsProductAttributeMapper productAttributeMapper;
    @Autowired
    private PmsProductAttributeValueMapper productAttributeValueMapper;
    @Autowired
    private PmsSkuStockMapper skuStockMapper;
    @Autowired
    private PmsProductLadderMapper productLadderMapper;
    @Autowired
    private PmsProductFullReductionMapper productFullReductionMapper;
    @Autowired
    private PortalProductDao portalProductDao;

    @Override
    public List<PmsProduct> search(String keyword, Long brandId, Long productCategoryId, Integer pageNum, Integer pageSize, Integer sort) {
        PageHelper.startPage(pageNum, pageSize);
        LambdaQueryWrapper<PmsProduct> wrapper = new LambdaQueryWrapper<PmsProduct>()
                .eq(PmsProduct::getDeleteStatus, 0);
        if (StrUtil.isNotEmpty(keyword)) {
            wrapper.like(PmsProduct::getName, keyword);
        }
        if (brandId != null) {
            wrapper.eq(PmsProduct::getBrandId, brandId);
        }
        if (productCategoryId != null) {
            wrapper.eq(PmsProduct::getProductCategoryId, productCategoryId);
        }
        //1->按新品；2->按销量；3->价格从低到高；4->价格从高到低
        if (sort == 1) {
            wrapper.orderByDesc(PmsProduct::getId);
        } else if (sort == 2) {
            wrapper.orderByDesc(PmsProduct::getSale);
        } else if (sort == 3) {
            wrapper.orderByAsc(PmsProduct::getPrice);
        } else if (sort == 4) {
            wrapper.orderByDesc(PmsProduct::getPrice);
        }
        return productMapper.selectList(wrapper);
    }

    @Override
    public List<PmsProductCategoryNode> categoryTreeList() {
        List<PmsProductCategory> allList = productCategoryMapper.selectList(new LambdaQueryWrapper<PmsProductCategory>());
        // 又是递归构造树
        List<PmsProductCategoryNode> result = allList.stream()
                .filter(item -> item.getParentId().equals(0L))
                .map(item -> covert(item, allList)).collect(Collectors.toList());
        return result;
    }

    @Override
    public PmsPortalProductDetail detail(Long id) {
        PmsPortalProductDetail result = new PmsPortalProductDetail();
        //获取商品信息
        PmsProduct product = productMapper.selectById(id);
        result.setProduct(product);
        //获取品牌信息
        PmsBrand brand = brandMapper.selectById(product.getBrandId());
        result.setBrand(brand);
        //获取商品属性信息
        List<PmsProductAttribute> productAttributeList = productAttributeMapper.selectList(new LambdaQueryWrapper<PmsProductAttribute>()
                .eq(PmsProductAttribute::getProductAttributeCategoryId, product.getProductAttributeCategoryId()));
        result.setProductAttributeList(productAttributeList);
        //获取商品属性值信息
        if(CollUtil.isNotEmpty(productAttributeList)){
            List<Long> attributeIds = productAttributeList.stream().map(PmsProductAttribute::getId).collect(Collectors.toList());
            List<PmsProductAttributeValue> productAttributeValueList = productAttributeValueMapper.selectList(new LambdaQueryWrapper<PmsProductAttributeValue>()
                    .eq(PmsProductAttributeValue::getProductId, product.getId())
                    .in(PmsProductAttributeValue::getProductAttributeId, attributeIds));
            result.setProductAttributeValueList(productAttributeValueList);
        }
        //获取商品SKU库存信息
        List<PmsSkuStock> skuStockList = skuStockMapper.selectList(new LambdaQueryWrapper<PmsSkuStock>()
                .eq(PmsSkuStock::getProductId, product.getId()));
        result.setSkuStockList(skuStockList);
        //商品阶梯价格设置
        if(product.getPromotionType()==3){
            List<PmsProductLadder> productLadderList = productLadderMapper.selectList(new LambdaQueryWrapper<PmsProductLadder>()
                    .eq(PmsProductLadder::getProductId, product.getId()));
            result.setProductLadderList(productLadderList);
        }
        //商品满减价格设置
        if(product.getPromotionType()==4){
            List<PmsProductFullReduction> productFullReductionList = productFullReductionMapper.selectList(new LambdaQueryWrapper<PmsProductFullReduction>()
                    .eq(PmsProductFullReduction::getProductId, product.getId()));
            result.setProductFullReductionList(productFullReductionList);
        }
        //商品可用优惠券
        result.setCouponList(portalProductDao.getAvailableCouponList(product.getId(),product.getProductCategoryId()));
        return result;
    }


    /**
     * 初始对象转化为节点对象
     */
    private PmsProductCategoryNode covert(PmsProductCategory item, List<PmsProductCategory> allList) {
        PmsProductCategoryNode node = new PmsProductCategoryNode();
        BeanUtils.copyProperties(item, node);
        List<PmsProductCategoryNode> children = allList.stream()
                .filter(subItem -> subItem.getParentId().equals(item.getId()))
                .map(subItem -> covert(subItem, allList)).collect(Collectors.toList());
        node.setChildren(children);
        return node;
    }
}
