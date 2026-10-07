package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.SmsFlashPromotionMapper;
import com.macro.mall.model.SmsFlashPromotion;
import com.macro.mall.service.SmsFlashPromotionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Date;
import java.util.List;

/**
 * 限时购活动管理Service实现类
 * Created by macro on 2018/11/16.
 */
@Service
public class SmsFlashPromotionServiceImpl implements SmsFlashPromotionService {
    @Autowired
    private SmsFlashPromotionMapper flashPromotionMapper;

    @Override
    public int create(SmsFlashPromotion flashPromotion) {
        flashPromotion.setCreateTime(new Date());
        return flashPromotionMapper.insert(flashPromotion);
    }

    @Override
    public int update(Long id, SmsFlashPromotion flashPromotion) {
        flashPromotion.setId(id);
        return flashPromotionMapper.update(null, new LambdaUpdateWrapper<SmsFlashPromotion>()
                .eq(SmsFlashPromotion::getId, flashPromotion.getId())
                .set(SmsFlashPromotion::getTitle, flashPromotion.getTitle())
                .set(SmsFlashPromotion::getStartDate, flashPromotion.getStartDate())
                .set(SmsFlashPromotion::getEndDate, flashPromotion.getEndDate())
                .set(SmsFlashPromotion::getStatus, flashPromotion.getStatus())
                .set(SmsFlashPromotion::getCreateTime, flashPromotion.getCreateTime()));
    }

    @Override
    public int delete(Long id) {
        return flashPromotionMapper.deleteById(id);
    }

    @Override
    public int updateStatus(Long id, Integer status) {
        SmsFlashPromotion flashPromotion = new SmsFlashPromotion();
        flashPromotion.setId(id);
        flashPromotion.setStatus(status);
        return flashPromotionMapper.updateById(flashPromotion);
    }

    @Override
    public SmsFlashPromotion getItem(Long id) {
        return flashPromotionMapper.selectById(id);
    }

    @Override
    public List<SmsFlashPromotion> list(String keyword, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum, pageSize);
        LambdaQueryWrapper<SmsFlashPromotion> wrapper = new LambdaQueryWrapper<>();
        if (!StringUtils.isEmpty(keyword)) {
            wrapper.like(SmsFlashPromotion::getTitle, keyword);
        }
        return flashPromotionMapper.selectList(wrapper);
    }
}
