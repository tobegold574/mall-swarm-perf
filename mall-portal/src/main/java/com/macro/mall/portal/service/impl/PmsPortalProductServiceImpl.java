package com.macro.mall.portal.service.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
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

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
        // 纯关键词搜索(无附加过滤): 优先走ngram全文索引; 命中0条(超高频词相关度悬崖)时回落LIKE, 泛词慢但永不丢结果
        boolean hasFilter = brandId != null || productCategoryId != null;
        if (StrUtil.isNotEmpty(keyword) && !hasFilter) {
            long total = ftCountTotalCached(keyword);
            if (total > 0) {
                long offset = (long) (pageNum - 1) * pageSize;
                List<PmsProduct> list = productMapper.searchByNameFulltext(keyword, offset, pageSize);
                Page<PmsProduct> page = new Page<>(pageNum, pageSize);
                page.setTotal(total);
                page.addAll(list);
                return page;
            }
            // total==0: 落入下方LIKE路径兜底
        }
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

    /** 全文搜索的COUNT缓存(关键词→总数, 60s TTL): 免除每请求4万条目的FT索引扫描 */
    private final Map<String, Long> ftCountCache = new ConcurrentHashMap<>();
    private final Map<String, Long> ftCountCacheAt = new ConcurrentHashMap<>();
    private static final long FT_COUNT_CACHE_TTL_MS = 60_000;

    /** TTL是跨实例数据变更的一致性上界: admin侧增删商品后, 本缓存最多60s内过期重建 */
    private long ftCountTotalCached(String keyword) {
        Long at = ftCountCacheAt.get(keyword);
        if (at != null && System.currentTimeMillis() - at < FT_COUNT_CACHE_TTL_MS) {
            Long v = ftCountCache.get(keyword);
            if (v != null) {
                return v;
            }
        }
        long total = productMapper.countByNameFulltext(keyword);
        ftCountCache.put(keyword, total);
        ftCountCacheAt.put(keyword, System.currentTimeMillis());
        return total;
    }

    private final Map<Long, List<PmsProductAttribute>> attributeCache = new ConcurrentHashMap<>();
    private final Map<Long, Long> attributeCacheAt = new ConcurrentHashMap<>();
    private static final long ATTR_CACHE_TTL_MS = 60_000;

    @Override
    public PmsPortalProductDetail detail(Long id) {
        PmsPortalProductDetail result = new PmsPortalProductDetail();
        //获取商品信息(后续所有查询的前置依赖, 必须先行)
        PmsProduct product = productMapper.selectById(id);
        result.setProduct(product);
        //其余查询互不依赖: 虚拟线程并行, 串行DB往返变一轮并行; 属性列表按分类ID做堆内TTL缓存
        try (var vt = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<PmsBrand> brandF = vt.submit(() -> brandMapper.selectById(product.getBrandId()));
            Future<List<PmsProductAttribute>> attrF = vt.submit(() -> {
                Long attrCatId = product.getProductAttributeCategoryId();
                return attrCatId == null ? Collections.emptyList() : productAttributeCache(attrCatId);
            });
            Future<List<PmsSkuStock>> skuF = vt.submit(() -> skuStockMapper.selectList(
                    new LambdaQueryWrapper<PmsSkuStock>().eq(PmsSkuStock::getProductId, product.getId())));
            Future<List<PmsProductLadder>> ladderF = vt.submit(() -> productLadderMapper.selectList(
                    new LambdaQueryWrapper<PmsProductLadder>().eq(PmsProductLadder::getProductId, product.getId())));
            Future<List<PmsProductFullReduction>> fullF = vt.submit(() -> productFullReductionMapper.selectList(
                    new LambdaQueryWrapper<PmsProductFullReduction>().eq(PmsProductFullReduction::getProductId, product.getId())));
            Future<List<SmsCoupon>> couponF = vt.submit(() ->
                    portalProductDao.getAvailableCouponList(product.getId(), product.getProductCategoryId()));

            List<PmsProductAttribute> productAttributeList = attrF.get();
            result.setProductAttributeList(productAttributeList);
            //获取商品属性值信息(依赖属性列表的ID集合)
            if (CollUtil.isNotEmpty(productAttributeList)) {
                List<Long> attributeIds = productAttributeList.stream().map(PmsProductAttribute::getId).collect(Collectors.toList());
                Future<List<PmsProductAttributeValue>> valueF = vt.submit(() ->
                        productAttributeValueMapper.selectList(new LambdaQueryWrapper<PmsProductAttributeValue>()
                                .eq(PmsProductAttributeValue::getProductId, product.getId())
                                .in(PmsProductAttributeValue::getProductAttributeId, attributeIds)));
                result.setProductAttributeValueList(valueF.get());
            }
            result.setBrand(brandF.get());
            result.setSkuStockList(skuF.get());
            //商品阶梯价格设置
            if (product.getPromotionType() == 3) {
                result.setProductLadderList(ladderF.get());
            }
            //商品满减价格设置
            if (product.getPromotionType() == 4) {
                result.setProductFullReductionList(fullF.get());
            }
            //商品可用优惠券
            result.setCouponList(couponF.get());
        } catch (InterruptedException | ExecutionException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new RuntimeException("商品详情并行查询失败", e);
        }
        return result;
    }

    /**
     * 商品属性列表堆内缓存: 按属性分类ID缓存(同类商品共享, 极少变更), 60s TTL
     */
    private List<PmsProductAttribute> productAttributeCache(Long categoryId) {
        Long at = attributeCacheAt.get(categoryId);
        if (at != null && System.currentTimeMillis() - at < ATTR_CACHE_TTL_MS) {
            List<PmsProductAttribute> v = attributeCache.get(categoryId);
            if (v != null) {
                return v;
            }
        }
        List<PmsProductAttribute> v = productAttributeMapper.selectList(new LambdaQueryWrapper<PmsProductAttribute>()
                .eq(PmsProductAttribute::getProductAttributeCategoryId, categoryId));
        attributeCache.put(categoryId, v);
        attributeCacheAt.put(categoryId, System.currentTimeMillis());
        return v;
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
