package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.OmsOrderReturnReasonMapper;
import com.macro.mall.model.OmsOrderReturnReason;
import com.macro.mall.service.OmsOrderReturnReasonService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 订单原因管理Service实现类
 * Created by macro on 2018/10/17.
 */
@Service
public class OmsOrderReturnReasonServiceImpl implements OmsOrderReturnReasonService {
    @Autowired
    private OmsOrderReturnReasonMapper returnReasonMapper;
    @Override
    public int create(OmsOrderReturnReason returnReason) {
        returnReason.setCreateTime(new Date());
        return returnReasonMapper.insert(returnReason);
    }

    @Override
    public int update(Long id, OmsOrderReturnReason returnReason) {
        returnReason.setId(id);
        return returnReasonMapper.update(null, new LambdaUpdateWrapper<OmsOrderReturnReason>()
                .eq(OmsOrderReturnReason::getId, returnReason.getId())
                .set(OmsOrderReturnReason::getName, returnReason.getName())
                .set(OmsOrderReturnReason::getSort, returnReason.getSort())
                .set(OmsOrderReturnReason::getStatus, returnReason.getStatus())
                .set(OmsOrderReturnReason::getCreateTime, returnReason.getCreateTime()));
    }

    @Override
    public int delete(List<Long> ids) {
        return returnReasonMapper.delete(new LambdaQueryWrapper<OmsOrderReturnReason>()
                .in(OmsOrderReturnReason::getId, ids));
    }

    @Override
    public List<OmsOrderReturnReason> list(Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        return returnReasonMapper.selectList(new LambdaQueryWrapper<OmsOrderReturnReason>()
                .orderByDesc(OmsOrderReturnReason::getSort));
    }

    @Override
    public int updateStatus(List<Long> ids, Integer status) {
        if(!status.equals(0)&&!status.equals(1)){
            return 0;
        }
        OmsOrderReturnReason record = new OmsOrderReturnReason();
        record.setStatus(status);
        return returnReasonMapper.update(record, new LambdaUpdateWrapper<OmsOrderReturnReason>()
                .in(OmsOrderReturnReason::getId, ids));
    }

    @Override
    public OmsOrderReturnReason getItem(Long id) {
        return returnReasonMapper.selectById(id);
    }
}
