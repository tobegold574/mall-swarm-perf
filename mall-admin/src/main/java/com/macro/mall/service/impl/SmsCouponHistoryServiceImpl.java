package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.SmsCouponHistoryMapper;
import com.macro.mall.model.SmsCouponHistory;
import com.macro.mall.service.SmsCouponHistoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 优惠券领取记录管理Service实现类
 * Created by macro on 2018/11/6.
 */
@Service
public class SmsCouponHistoryServiceImpl implements SmsCouponHistoryService {
    @Autowired
    private SmsCouponHistoryMapper historyMapper;
    @Override
    public List<SmsCouponHistory> list(Long couponId, Integer useStatus, String orderSn, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        LambdaQueryWrapper<SmsCouponHistory> wrapper = new LambdaQueryWrapper<>();
        if(couponId!=null){
            wrapper.eq(SmsCouponHistory::getCouponId, couponId);
        }
        if(useStatus!=null){
            wrapper.eq(SmsCouponHistory::getUseStatus, useStatus);
        }
        if(!StringUtils.isEmpty(orderSn)){
            wrapper.eq(SmsCouponHistory::getOrderSn, orderSn);
        }
        return historyMapper.selectList(wrapper);
    }
}
