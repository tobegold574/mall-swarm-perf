package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.dao.SmsCouponDao;
import com.macro.mall.dao.SmsCouponProductCategoryRelationDao;
import com.macro.mall.dao.SmsCouponProductRelationDao;
import com.macro.mall.dto.SmsCouponParam;
import com.macro.mall.mapper.SmsCouponMapper;
import com.macro.mall.mapper.SmsCouponProductCategoryRelationMapper;
import com.macro.mall.mapper.SmsCouponProductRelationMapper;
import com.macro.mall.model.*;
import com.macro.mall.service.SmsCouponService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 优惠券管理Service实现类
 * Created by macro on 2018/8/28.
 */
@Service
public class SmsCouponServiceImpl implements SmsCouponService {
    @Autowired
    private SmsCouponMapper couponMapper;
    @Autowired
    private SmsCouponProductRelationMapper productRelationMapper;
    @Autowired
    private SmsCouponProductCategoryRelationMapper productCategoryRelationMapper;
    @Autowired
    private SmsCouponProductRelationDao productRelationDao;
    @Autowired
    private SmsCouponProductCategoryRelationDao productCategoryRelationDao;
    @Autowired
    private SmsCouponDao couponDao;
    @Override
    public int create(SmsCouponParam couponParam) {
        // 剩余可用数
        couponParam.setCount(couponParam.getPublishCount());
        // 已使用
        couponParam.setUseCount(0);
        // 已领取
        couponParam.setReceiveCount(0);
        //插入优惠券表
        int count = couponMapper.insert(couponParam);

        /**
         * useType 
         * 0 全场通用券
         * 1 限定分类券
         * 2 限定商品券
         * 上述互斥
         */
        // 只和商品有关系
        if(couponParam.getUseType().equals(2)){
            for(SmsCouponProductRelation productRelation:couponParam.getProductRelationList()){
                productRelation.setCouponId(couponParam.getId());
            }
            productRelationDao.insertList(couponParam.getProductRelationList());
        }
        // 和某一类有关系
        if(couponParam.getUseType().equals(1)){
            for (SmsCouponProductCategoryRelation couponProductCategoryRelation : couponParam.getProductCategoryRelationList()) {
                couponProductCategoryRelation.setCouponId(couponParam.getId());
            }
            productCategoryRelationDao.insertList(couponParam.getProductCategoryRelationList());
        }
        return count;
    }

    @Override
    public int delete(Long id) {
        //删除优惠券
        int count = couponMapper.deleteById(id);
        //删除商品关联
        deleteProductRelation(id);
        //删除商品分类关联
        deleteProductCategoryRelation(id);
        return count;
    }

    private void deleteProductCategoryRelation(Long id) {
        productCategoryRelationMapper.delete(new LambdaQueryWrapper<SmsCouponProductCategoryRelation>()
                .eq(SmsCouponProductCategoryRelation::getCouponId, id));
    }

    private void deleteProductRelation(Long id) {
        productRelationMapper.delete(new LambdaQueryWrapper<SmsCouponProductRelation>()
                .eq(SmsCouponProductRelation::getCouponId, id));
    }

    /**
     * 先删后插入
     */
    @Override
    public int update(Long id, SmsCouponParam couponParam) {
        couponParam.setId(id);
        int count = couponMapper.update(null, new LambdaUpdateWrapper<SmsCoupon>()
                .eq(SmsCoupon::getId, couponParam.getId())
                .set(SmsCoupon::getType, couponParam.getType())
                .set(SmsCoupon::getName, couponParam.getName())
                .set(SmsCoupon::getPlatform, couponParam.getPlatform())
                .set(SmsCoupon::getCount, couponParam.getCount())
                .set(SmsCoupon::getAmount, couponParam.getAmount())
                .set(SmsCoupon::getPerLimit, couponParam.getPerLimit())
                .set(SmsCoupon::getMinPoint, couponParam.getMinPoint())
                .set(SmsCoupon::getStartTime, couponParam.getStartTime())
                .set(SmsCoupon::getEndTime, couponParam.getEndTime())
                .set(SmsCoupon::getUseType, couponParam.getUseType())
                .set(SmsCoupon::getNote, couponParam.getNote())
                .set(SmsCoupon::getPublishCount, couponParam.getPublishCount())
                .set(SmsCoupon::getEnableTime, couponParam.getEnableTime())
                .set(SmsCoupon::getCode, couponParam.getCode())
                .set(SmsCoupon::getMemberLevel, couponParam.getMemberLevel()));
        //删除后插入优惠券和商品关系表
        if(couponParam.getUseType().equals(2)){
            for(SmsCouponProductRelation productRelation:couponParam.getProductRelationList()){
                productRelation.setCouponId(couponParam.getId());
            }
            deleteProductRelation(id);
            productRelationDao.insertList(couponParam.getProductRelationList());
        }
        //删除后插入优惠券和商品分类关系表
        if(couponParam.getUseType().equals(1)){
            for (SmsCouponProductCategoryRelation couponProductCategoryRelation : couponParam.getProductCategoryRelationList()) {
                couponProductCategoryRelation.setCouponId(couponParam.getId());
            }
            deleteProductCategoryRelation(id);
            productCategoryRelationDao.insertList(couponParam.getProductCategoryRelationList());
        }
        return count;
    }

    @Override
    public List<SmsCoupon> list(String name, Integer type, Integer pageSize, Integer pageNum) {
        LambdaQueryWrapper<SmsCoupon> wrapper = new LambdaQueryWrapper<>();
        if(!StringUtils.isEmpty(name)){
            wrapper.like(SmsCoupon::getName, name);
        }
        if(type!=null){
            wrapper.eq(SmsCoupon::getType, type);
        }
        PageHelper.startPage(pageNum,pageSize);
        return couponMapper.selectList(wrapper);
    }

    @Override
    public SmsCouponParam getItem(Long id) {
        return couponDao.getItem(id);
    }
}
