package com.macro.mall.service.impl;

// 集合管理
import cn.hutool.core.collection.CollUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.macro.mall.dao.*;
import com.macro.mall.dto.PmsProductParam;
import com.macro.mall.dto.PmsProductQueryParam;
import com.macro.mall.dto.PmsProductResult;
import com.macro.mall.mapper.*;
import com.macro.mall.model.*;
import com.macro.mall.service.PmsProductService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 商品管理Service实现类
 * Created by macro on 2018/4/26.
 */
@Service
public class PmsProductServiceImpl implements PmsProductService {
    private static final Logger LOGGER = LoggerFactory.getLogger(PmsProductServiceImpl.class);
    @Autowired
    private PmsProductMapper productMapper;
    @Autowired
    private PmsMemberPriceDao memberPriceDao;
    @Autowired
    private PmsMemberPriceMapper memberPriceMapper;
    @Autowired
    private PmsProductLadderDao productLadderDao;
    @Autowired
    private PmsProductLadderMapper productLadderMapper;
    @Autowired
    private PmsProductFullReductionDao productFullReductionDao;
    @Autowired
    private PmsProductFullReductionMapper productFullReductionMapper;
    @Autowired
    private PmsSkuStockDao skuStockDao;
    @Autowired
    private PmsSkuStockMapper skuStockMapper;
    @Autowired
    private PmsProductAttributeValueDao productAttributeValueDao;
    @Autowired
    private PmsProductAttributeValueMapper productAttributeValueMapper;
    @Autowired
    private CmsSubjectProductRelationDao subjectProductRelationDao;
    @Autowired
    private CmsSubjectProductRelationMapper subjectProductRelationMapper;
    @Autowired
    private CmsPrefrenceAreaProductRelationDao prefrenceAreaProductRelationDao;
    @Autowired
    private CmsPrefrenceAreaProductRelationMapper prefrenceAreaProductRelationMapper;
    @Autowired
    private PmsProductDao productDao;
    @Autowired
    private PmsProductVertifyRecordDao productVertifyRecordDao;

    @Override
    public int create(PmsProductParam productParam) {
        int count;
        //创建商品
        PmsProduct product = productParam;
        product.setId(null);
        int result = productMapper.insert(product);
        invalidateProductCountCache();
        //根据促销类型设置价格：会员价格、阶梯价格、满减价格
        Long productId = product.getId();
        //会员价格
        relateAndInsertList(memberPriceDao, productParam.getMemberPriceList(), productId);
        //阶梯价格
        relateAndInsertList(productLadderDao, productParam.getProductLadderList(), productId);
        //满减价格
        relateAndInsertList(productFullReductionDao, productParam.getProductFullReductionList(), productId);
        //处理sku的编码
        handleSkuStockCode(productParam.getSkuStockList(),productId);
        //添加sku库存信息
        relateAndInsertList(skuStockDao, productParam.getSkuStockList(), productId);
        //添加商品参数,添加自定义商品规格
        relateAndInsertList(productAttributeValueDao, productParam.getProductAttributeValueList(), productId);
        //关联专题
        relateAndInsertList(subjectProductRelationDao, productParam.getSubjectProductRelationList(), productId);
        //关联优选
        relateAndInsertList(prefrenceAreaProductRelationDao, productParam.getPrefrenceAreaProductRelationList(), productId);
        count = 1;
        return count;
    }

    /**
     * Stock Keeping Unit 库存量单位
     * 直接 set，不论插入还是更新
     */ 
    private void handleSkuStockCode(List<PmsSkuStock> skuStockList, Long productId) {
        if(CollectionUtils.isEmpty(skuStockList))return;
        for(int i=0;i<skuStockList.size();i++){
            PmsSkuStock skuStock = skuStockList.get(i);
            // 创建新的 SKU 编码
            if(StringUtils.isEmpty(skuStock.getSkuCode())){
                SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMdd");
                StringBuilder sb = new StringBuilder();
                //日期
                sb.append(sdf.format(new Date()));
                //四位商品id
                sb.append(String.format("%04d", productId));
                //三位索引id
                sb.append(String.format("%03d", i+1));
                skuStock.setSkuCode(sb.toString());
            }
        }
    }

    @Override
    public PmsProductResult getUpdateInfo(Long id) {
        return productDao.getUpdateInfo(id);
    }

    /**    
     * 前端全量提交，后端批量删除后完整插入
     * 6组重复逻辑：创建条件容器->设定条件->删掉该商品全部旧关联->全量插入前端传来的新关联
     * 1组 sku 分三个不同状态，实际与6组关联表更新是同理的
     */
    @Override
    public int update(Long id, PmsProductParam productParam) {
        int count;
        //更新商品信息
        PmsProduct product = productParam;
        product.setId(id);
        // 选择性更新，只把非 null 字段拼入 sql
        productMapper.updateById(product);
        //会员价格
        memberPriceMapper.delete(new LambdaQueryWrapper<PmsMemberPrice>().eq(PmsMemberPrice::getProductId, id));
        relateAndInsertList(memberPriceDao, productParam.getMemberPriceList(), id);
        //阶梯价格
        productLadderMapper.delete(new LambdaQueryWrapper<PmsProductLadder>().eq(PmsProductLadder::getProductId, id));
        relateAndInsertList(productLadderDao, productParam.getProductLadderList(), id);
        //满减价格
        productFullReductionMapper.delete(new LambdaQueryWrapper<PmsProductFullReduction>().eq(PmsProductFullReduction::getProductId, id));
        relateAndInsertList(productFullReductionDao, productParam.getProductFullReductionList(), id);
        //修改sku库存信息
        handleUpdateSkuStockList(id, productParam);
        //修改商品参数,添加自定义商品规格
        productAttributeValueMapper.delete(new LambdaQueryWrapper<PmsProductAttributeValue>().eq(PmsProductAttributeValue::getProductId, id));
        relateAndInsertList(productAttributeValueDao, productParam.getProductAttributeValueList(), id);
        //关联专题
        subjectProductRelationMapper.delete(new LambdaQueryWrapper<CmsSubjectProductRelation>().eq(CmsSubjectProductRelation::getProductId, id));
        relateAndInsertList(subjectProductRelationDao, productParam.getSubjectProductRelationList(), id);
        //关联优选
        prefrenceAreaProductRelationMapper.delete(new LambdaQueryWrapper<CmsPrefrenceAreaProductRelation>().eq(CmsPrefrenceAreaProductRelation::getProductId, id));
        relateAndInsertList(prefrenceAreaProductRelationDao, productParam.getPrefrenceAreaProductRelationList(), id);
        count = 1;
        return count;
    }

    /**
     * 处理 Java 层面的 sku 更新以及数据库层面的更新
     * @param id
     * @param productParam
     */
    private void handleUpdateSkuStockList(Long id, PmsProductParam productParam) {
        // 前端提交的 sku 状态信息
        List<PmsSkuStock> currSkuList = productParam.getSkuStockList();
        // 前端提交的列表为空，代表用户想要删除所有 sku 信息，更新数据
        if(CollUtil.isEmpty(currSkuList)){
            skuStockMapper.delete(new LambdaQueryWrapper<PmsSkuStock>().eq(PmsSkuStock::getProductId, id));
            return;
        }

        // 获取初始 sku 信息
        // 按商品 id 进行搜索
        List<PmsSkuStock> oriStuList = skuStockMapper.selectList(new LambdaQueryWrapper<PmsSkuStock>()
                .eq(PmsSkuStock::getProductId, id));

        // 前端提交的列表的 id 为空的数据，获取需要更新的信息
        // 主键非 null，即之前没有的，为更新插入
        List<PmsSkuStock> insertSkuList = currSkuList.stream().filter(item->item.getId()==null).collect(Collectors.toList());
        // id 非空的数据，需要的是更新而不是插入
        List<PmsSkuStock> updateSkuList = currSkuList.stream().filter(item->item.getId()!=null).collect(Collectors.toList());
        List<Long> updateSkuIds = updateSkuList.stream().map(PmsSkuStock::getId).collect(Collectors.toList());
        // 获取前端提交列表中不存在的那些条目，即为需要删除的数据
        List<PmsSkuStock> removeSkuList = oriStuList.stream().filter(item-> !updateSkuIds.contains(item.getId())).collect(Collectors.toList());
        // 两个不同分类的数据通过相同的 setter 逻辑进行更新 
        handleSkuStockCode(insertSkuList,id);
        handleSkuStockCode(updateSkuList,id);
        
        // 数据库层面的三种类型的更新
        // 插入 sku
        if(CollUtil.isNotEmpty(insertSkuList)){
            relateAndInsertList(skuStockDao, insertSkuList, id);
        }
        // 删除 sku
        if(CollUtil.isNotEmpty(removeSkuList)){
            List<Long> removeSkuIds = removeSkuList.stream().map(PmsSkuStock::getId).collect(Collectors.toList());
            skuStockMapper.delete(new LambdaQueryWrapper<PmsSkuStock>().in(PmsSkuStock::getId, removeSkuIds));
        }
        // 修改 sku
        if(CollUtil.isNotEmpty(updateSkuList)){
            for (PmsSkuStock pmsSkuStock : updateSkuList) {
                skuStockMapper.updateById(pmsSkuStock);
            }
        }

    }

    /**
     * 分页获取数据
     * 深分页优化: 无可选过滤条件且偏移量较深时走延迟关联(内层覆盖索引扫描+按主键回表),
     * 消除深偏移的全行回表; 浅页(offset<阈值)延迟关联无收益纯付JOIN成本, 走原生路径。
     * 行集与原路径完全一致
     */
    private static final long DEFERRED_JOIN_MIN_OFFSET = 1000;
    /** 分页total的COUNT缓存(5s TTL): 免除每请求4万条目的覆盖索引扫描; 商品增删/逻辑删时失效 */
    private volatile Long cachedDeleteStatus0Count;
    private volatile long deleteStatus0CountAt;
    private static final long COUNT_CACHE_TTL_MS = 5000;

    private long deleteStatus0CountCached() {
        Long v = cachedDeleteStatus0Count;
        long now = System.currentTimeMillis();
        if (v != null && now - deleteStatus0CountAt < COUNT_CACHE_TTL_MS) {
            return v;
        }
        synchronized (this) {
            if (cachedDeleteStatus0Count != null && System.currentTimeMillis() - deleteStatus0CountAt < COUNT_CACHE_TTL_MS) {
                return cachedDeleteStatus0Count;
            }
            long c = productMapper.selectCount(new LambdaQueryWrapper<PmsProduct>()
                    .eq(PmsProduct::getDeleteStatus, 0));
            cachedDeleteStatus0Count = c;
            deleteStatus0CountAt = System.currentTimeMillis();
            return c;
        }
    }

    private void invalidateProductCountCache() {
        cachedDeleteStatus0Count = null;
    }

    @Override
    public List<PmsProduct> list(PmsProductQueryParam productQueryParam, Integer pageSize, Integer pageNum) {
        boolean hasFilter = productQueryParam.getPublishStatus() != null
                || productQueryParam.getVerifyStatus() != null
                || !StringUtils.isEmpty(productQueryParam.getKeyword())
                || !StringUtils.isEmpty(productQueryParam.getProductSn())
                || productQueryParam.getBrandId() != null
                || productQueryParam.getProductCategoryId() != null;
        long offset = (long) (pageNum - 1) * pageSize;
        if (!hasFilter && offset >= DEFERRED_JOIN_MIN_OFFSET) {
            long total = deleteStatus0CountCached();
            List<PmsProduct> list = productMapper.selectPageDeferred(offset, pageSize);
            Page<PmsProduct> page = new Page<>(pageNum, pageSize);
            page.setTotal(total);
            page.addAll(list);
            return page;
        }
        PageHelper.startPage(pageNum, pageSize);
        LambdaQueryWrapper<PmsProduct> wrapper = new LambdaQueryWrapper<PmsProduct>()
                .eq(PmsProduct::getDeleteStatus, 0);
        if (productQueryParam.getPublishStatus() != null) {
            wrapper.eq(PmsProduct::getPublishStatus, productQueryParam.getPublishStatus());
        }
        if (productQueryParam.getVerifyStatus() != null) {
            wrapper.eq(PmsProduct::getVerifyStatus, productQueryParam.getVerifyStatus());
        }
        if (!StringUtils.isEmpty(productQueryParam.getKeyword())) {
            wrapper.like(PmsProduct::getName, productQueryParam.getKeyword());
        }
        if (!StringUtils.isEmpty(productQueryParam.getProductSn())) {
            wrapper.eq(PmsProduct::getProductSn, productQueryParam.getProductSn());
        }
        if (productQueryParam.getBrandId() != null) {
            wrapper.eq(PmsProduct::getBrandId, productQueryParam.getBrandId());
        }
        if (productQueryParam.getProductCategoryId() != null) {
            wrapper.eq(PmsProduct::getProductCategoryId, productQueryParam.getProductCategoryId());
        }
        return productMapper.selectList(wrapper);
    }

    /**
     * 更新审核状态
     */
    @Override
    public int updateVerifyStatus(List<Long> ids, Integer verifyStatus, String detail) {
        PmsProduct product = new PmsProduct();
        product.setVerifyStatus(verifyStatus);
        LambdaUpdateWrapper<PmsProduct> wrapper = new LambdaUpdateWrapper<PmsProduct>()
                .in(PmsProduct::getId, ids);
        List<PmsProductVertifyRecord> list = new ArrayList<>();
        int count = productMapper.update(product, wrapper);
        //修改完审核状态后插入审核记录
        for (Long id : ids) {
            PmsProductVertifyRecord record = new PmsProductVertifyRecord();
            record.setProductId(id);
            record.setCreateTime(new Date());
            record.setDetail(detail);
            record.setStatus(verifyStatus);
            record.setVertifyMan("test");
            list.add(record);
        }
        productVertifyRecordDao.insertList(list);
        return count;
    }

    /**
     * 更新发布状态
     */
    @Override
    public int updatePublishStatus(List<Long> ids, Integer publishStatus) {
        PmsProduct record = new PmsProduct();
        record.setPublishStatus(publishStatus);
        return productMapper.update(record, new LambdaUpdateWrapper<PmsProduct>().in(PmsProduct::getId, ids));
    }

    /**
     * 更新推荐状态
     */
    @Override
    public int updateRecommendStatus(List<Long> ids, Integer recommendStatus) {
        PmsProduct record = new PmsProduct();
        record.setRecommandStatus(recommendStatus);
        return productMapper.update(record, new LambdaUpdateWrapper<PmsProduct>().in(PmsProduct::getId, ids));
    }

    /**
     * 是否为新品
     */
    @Override
    public int updateNewStatus(List<Long> ids, Integer newStatus) {
        PmsProduct record = new PmsProduct();
        record.setNewStatus(newStatus);
        return productMapper.update(record, new LambdaUpdateWrapper<PmsProduct>().in(PmsProduct::getId, ids));
    }

    /**
     * 是否删除（逻辑删除）
     */
    @Override
    public int updateDeleteStatus(List<Long> ids, Integer deleteStatus) {
        PmsProduct record = new PmsProduct();
        record.setDeleteStatus(deleteStatus);
        invalidateProductCountCache();
        return productMapper.update(record, new LambdaUpdateWrapper<PmsProduct>().in(PmsProduct::getId, ids));
    }

    /**
     * 模糊搜索
     */
    @Override
    public List<PmsProduct> list(String keyword) {
        LambdaQueryWrapper<PmsProduct> wrapper = new LambdaQueryWrapper<>();
        if (!StringUtils.isEmpty(keyword)) {
            // (delete_status = 0 and name like ?) or (delete_status = 0 and product_sn like ?)
            wrapper.and(w -> w.eq(PmsProduct::getDeleteStatus, 0).like(PmsProduct::getName, keyword))
                    .or(w -> w.eq(PmsProduct::getDeleteStatus, 0).like(PmsProduct::getProductSn, keyword));
        } else {
            wrapper.eq(PmsProduct::getDeleteStatus, 0);
        }
        return productMapper.selectList(wrapper);
    }

    /**
     * 建立和插入关系表操作
     *
     * @param dao       可以操作的dao
     * @param dataList  要插入的数据
     * @param productId 建立关系的id
     */
    private void relateAndInsertList(Object dao, List dataList, Long productId) {
        try {
            // 空列表直接返回
            if (CollectionUtils.isEmpty(dataList)) return;
            for (Object item : dataList) {
                // 按名字和参数类型在运行期捞出方法对象
                // id 为关联表自己的主键
                Method setId = item.getClass().getMethod("setId", Long.class);
                // 主键置 null，前端传的数据可能是原有数据的主键，需要删掉原主键避免重复，让 mysql 自动分配新主键
                setId.invoke(item, (Long) null);
                // productId 外键 即当前数据挂在哪个商品下面
                Method setProductId = item.getClass().getMethod("setProductId", Long.class);
                setProductId.invoke(item, productId);
            }
            Method insertList = dao.getClass().getMethod("insertList", List.class);
            insertList.invoke(dao, dataList);
        } catch (Exception e) {
            LOGGER.warn("创建产品出错:{}", e.getMessage());
            throw new RuntimeException(e.getMessage());
        }
    }

}
