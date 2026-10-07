package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.macro.mall.mapper.OmsOrderSettingMapper;
import com.macro.mall.model.OmsOrderSetting;
import com.macro.mall.service.OmsOrderSettingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 订单设置管理Service实现类
 * Created by macro on 2018/10/16.
 */
@Service
public class OmsOrderSettingServiceImpl implements OmsOrderSettingService {
    @Autowired
    private OmsOrderSettingMapper orderSettingMapper;

    @Override
    public OmsOrderSetting getItem(Long id) {
        return orderSettingMapper.selectById(id);
    }

    @Override
    public int update(Long id, OmsOrderSetting orderSetting) {
        orderSetting.setId(id);
        return orderSettingMapper.update(null, new LambdaUpdateWrapper<OmsOrderSetting>()
                .eq(OmsOrderSetting::getId, orderSetting.getId())
                .set(OmsOrderSetting::getFlashOrderOvertime, orderSetting.getFlashOrderOvertime())
                .set(OmsOrderSetting::getNormalOrderOvertime, orderSetting.getNormalOrderOvertime())
                .set(OmsOrderSetting::getConfirmOvertime, orderSetting.getConfirmOvertime())
                .set(OmsOrderSetting::getFinishOvertime, orderSetting.getFinishOvertime())
                .set(OmsOrderSetting::getCommentOvertime, orderSetting.getCommentOvertime()));
    }
}
