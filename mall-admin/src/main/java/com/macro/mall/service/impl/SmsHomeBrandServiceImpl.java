package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.SmsHomeBrandMapper;
import com.macro.mall.model.SmsHomeBrand;
import com.macro.mall.service.SmsHomeBrandService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 首页品牌管理Service实现类
 * Created by macro on 2018/11/6.
 */
@Service
public class SmsHomeBrandServiceImpl implements SmsHomeBrandService {
    @Autowired
    private SmsHomeBrandMapper homeBrandMapper;
    @Override
    public int create(List<SmsHomeBrand> homeBrandList) {
        for (SmsHomeBrand smsHomeBrand : homeBrandList) {
            smsHomeBrand.setRecommendStatus(1);
            smsHomeBrand.setSort(0);
            homeBrandMapper.insert(smsHomeBrand);
        }
        return homeBrandList.size();
    }

    @Override
    public int updateSort(Long id, Integer sort) {
        SmsHomeBrand homeBrand = new SmsHomeBrand();
        homeBrand.setId(id);
        homeBrand.setSort(sort);
        return homeBrandMapper.updateById(homeBrand);
    }

    @Override
    public int delete(List<Long> ids) {
        return homeBrandMapper.delete(new LambdaQueryWrapper<SmsHomeBrand>()
                .in(SmsHomeBrand::getId, ids));
    }

    @Override
    public int updateRecommendStatus(List<Long> ids, Integer recommendStatus) {
        SmsHomeBrand record = new SmsHomeBrand();
        record.setRecommendStatus(recommendStatus);
        return homeBrandMapper.update(record, new LambdaUpdateWrapper<SmsHomeBrand>()
                .in(SmsHomeBrand::getId, ids));
    }

    @Override
    public List<SmsHomeBrand> list(String brandName, Integer recommendStatus, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        LambdaQueryWrapper<SmsHomeBrand> wrapper = new LambdaQueryWrapper<SmsHomeBrand>()
                .orderByDesc(SmsHomeBrand::getSort);
        if(!StringUtils.isEmpty(brandName)){
            wrapper.like(SmsHomeBrand::getBrandName, brandName);
        }
        if(recommendStatus!=null){
            wrapper.eq(SmsHomeBrand::getRecommendStatus, recommendStatus);
        }
        return homeBrandMapper.selectList(wrapper);
    }
}
