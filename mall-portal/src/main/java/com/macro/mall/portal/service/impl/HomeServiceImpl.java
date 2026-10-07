package com.macro.mall.portal.service.impl;

import com.github.pagehelper.PageHelper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.macro.mall.mapper.*;
import com.macro.mall.model.*;
import com.macro.mall.portal.dao.HomeDao;
import com.macro.mall.portal.domain.FlashPromotionProduct;
import com.macro.mall.portal.domain.HomeContentResult;
import com.macro.mall.portal.domain.HomeFlashPromotion;
import com.macro.mall.portal.service.HomeService;
import com.macro.mall.portal.util.DateUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.Date;
import java.util.List;

/**
 * 首页内容管理Service实现类
 * Created by macro on 2019/1/28.
 */
@Service
public class HomeServiceImpl implements HomeService {
    @Autowired
    private SmsHomeAdvertiseMapper advertiseMapper;
    @Autowired
    private HomeDao homeDao;
    @Autowired
    private SmsFlashPromotionMapper flashPromotionMapper;
    @Autowired
    private SmsFlashPromotionSessionMapper promotionSessionMapper;
    @Autowired
    private PmsProductMapper productMapper;
    @Autowired
    private PmsProductCategoryMapper productCategoryMapper;
    @Autowired
    private CmsSubjectMapper subjectMapper;

    @Override
    public HomeContentResult content() {
        HomeContentResult result = new HomeContentResult();
        //获取首页广告
        result.setAdvertiseList(getHomeAdvertiseList());
        //获取推荐品牌
        result.setBrandList(homeDao.getRecommendBrandList(0,6));
        //获取秒杀信息
        result.setHomeFlashPromotion(getHomeFlashPromotion());
        //获取新品推荐
        result.setNewProductList(homeDao.getNewProductList(0,4));
        //获取人气推荐
        result.setHotProductList(homeDao.getHotProductList(0,4));
        //获取推荐专题
        result.setSubjectList(homeDao.getRecommendSubjectList(0,4));
        return result;
    }

    @Override
    public List<PmsProduct> recommendProductList(Integer pageSize, Integer pageNum) {
        // TODO: 2019/1/29 暂时默认推荐所有商品
        PageHelper.startPage(pageNum,pageSize);
        return productMapper.selectList(new LambdaQueryWrapper<PmsProduct>()
                .eq(PmsProduct::getDeleteStatus, 0)
                .eq(PmsProduct::getPublishStatus, 1));
    }

    @Override
    public List<PmsProductCategory> getProductCateList(Long parentId) {
        return productCategoryMapper.selectList(new LambdaQueryWrapper<PmsProductCategory>()
                .eq(PmsProductCategory::getShowStatus, 1)
                .eq(PmsProductCategory::getParentId, parentId)
                .orderByDesc(PmsProductCategory::getSort));
    }

    @Override
    public List<CmsSubject> getSubjectList(Long cateId, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        LambdaQueryWrapper<CmsSubject> wrapper = new LambdaQueryWrapper<CmsSubject>()
                .eq(CmsSubject::getShowStatus, 1);
        if(cateId!=null){
            wrapper.eq(CmsSubject::getCategoryId, cateId);
        }
        return subjectMapper.selectList(wrapper);
    }

    @Override
    public List<PmsProduct> hotProductList(Integer pageNum, Integer pageSize) {
        int offset = pageSize * (pageNum - 1);
        return homeDao.getHotProductList(offset, pageSize);
    }

    @Override
    public List<PmsProduct> newProductList(Integer pageNum, Integer pageSize) {
        int offset = pageSize * (pageNum - 1);
        return homeDao.getNewProductList(offset, pageSize);
    }

    private HomeFlashPromotion getHomeFlashPromotion() {
        HomeFlashPromotion homeFlashPromotion = new HomeFlashPromotion();
        //获取当前秒杀活动
        Date now = new Date();
        SmsFlashPromotion flashPromotion = getFlashPromotion(now);
        if (flashPromotion != null) {
            //获取当前秒杀场次
            SmsFlashPromotionSession flashPromotionSession = getFlashPromotionSession(now);
            if (flashPromotionSession != null) {
                homeFlashPromotion.setStartTime(flashPromotionSession.getStartTime());
                homeFlashPromotion.setEndTime(flashPromotionSession.getEndTime());
                //获取下一个秒杀场次
                SmsFlashPromotionSession nextSession = getNextFlashPromotionSession(homeFlashPromotion.getStartTime());
                if(nextSession!=null){
                    homeFlashPromotion.setNextStartTime(nextSession.getStartTime());
                    homeFlashPromotion.setNextEndTime(nextSession.getEndTime());
                }
                //获取秒杀商品
                // 活动-场次-商品三个秒杀分层
                List<FlashPromotionProduct> flashProductList = homeDao.getFlashProductList(flashPromotion.getId(), flashPromotionSession.getId());
                homeFlashPromotion.setProductList(flashProductList);
            }
        }
        return homeFlashPromotion;
    }

    //获取下一个场次信息
    private SmsFlashPromotionSession getNextFlashPromotionSession(Date date) {
        List<SmsFlashPromotionSession> promotionSessionList = promotionSessionMapper.selectList(new LambdaQueryWrapper<SmsFlashPromotionSession>()
                .gt(SmsFlashPromotionSession::getStartTime, date)
                .orderByAsc(SmsFlashPromotionSession::getStartTime));
        if (!CollectionUtils.isEmpty(promotionSessionList)) {
            return promotionSessionList.get(0);
        }
        return null;
    }

    private List<SmsHomeAdvertise> getHomeAdvertiseList() {
        return advertiseMapper.selectList(new LambdaQueryWrapper<SmsHomeAdvertise>()
                .eq(SmsHomeAdvertise::getType, 1)
                .eq(SmsHomeAdvertise::getStatus, 1)
                .orderByDesc(SmsHomeAdvertise::getSort));
    }

    //根据时间获取秒杀活动
    private SmsFlashPromotion getFlashPromotion(Date date) {
        Date currDate = DateUtil.getDate(date);
        List<SmsFlashPromotion> flashPromotionList = flashPromotionMapper.selectList(new LambdaQueryWrapper<SmsFlashPromotion>()
                .eq(SmsFlashPromotion::getStatus, 1)
                .le(SmsFlashPromotion::getStartDate, currDate)
                .ge(SmsFlashPromotion::getEndDate, currDate));
        if (!CollectionUtils.isEmpty(flashPromotionList)) {
            return flashPromotionList.get(0);
        }
        return null;
    }

    //根据时间获取秒杀场次
    private SmsFlashPromotionSession getFlashPromotionSession(Date date) {
        Date currTime = DateUtil.getTime(date);
        List<SmsFlashPromotionSession> promotionSessionList = promotionSessionMapper.selectList(new LambdaQueryWrapper<SmsFlashPromotionSession>()
                .le(SmsFlashPromotionSession::getStartTime, currTime)
                .ge(SmsFlashPromotionSession::getEndTime, currTime));
        if (!CollectionUtils.isEmpty(promotionSessionList)) {
            return promotionSessionList.get(0);
        }
        return null;
    }
}
