package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.SmsHomeRecommendSubjectMapper;
import com.macro.mall.model.SmsHomeRecommendSubject;
import com.macro.mall.service.SmsHomeRecommendSubjectService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 首页专题推荐管理Service实现类
 * Created by macro on 2018/11/7.
 */
@Service
public class SmsHomeRecommendSubjectServiceImpl implements SmsHomeRecommendSubjectService {
    @Autowired
    private SmsHomeRecommendSubjectMapper recommendProductMapper;
    @Override
    public int create(List<SmsHomeRecommendSubject> recommendSubjectList) {
        for (SmsHomeRecommendSubject recommendProduct : recommendSubjectList) {
            recommendProduct.setRecommendStatus(1);
            recommendProduct.setSort(0);
            recommendProductMapper.insert(recommendProduct);
        }
        return recommendSubjectList.size();
    }

    @Override
    public int updateSort(Long id, Integer sort) {
        SmsHomeRecommendSubject recommendProduct = new SmsHomeRecommendSubject();
        recommendProduct.setId(id);
        recommendProduct.setSort(sort);
        return recommendProductMapper.updateById(recommendProduct);
    }

    @Override
    public int delete(List<Long> ids) {
        return recommendProductMapper.delete(new LambdaQueryWrapper<SmsHomeRecommendSubject>()
                .in(SmsHomeRecommendSubject::getId, ids));
    }

    @Override
    public int updateRecommendStatus(List<Long> ids, Integer recommendStatus) {
        SmsHomeRecommendSubject record = new SmsHomeRecommendSubject();
        record.setRecommendStatus(recommendStatus);
        return recommendProductMapper.update(record, new LambdaUpdateWrapper<SmsHomeRecommendSubject>()
                .in(SmsHomeRecommendSubject::getId, ids));
    }

    @Override
    public List<SmsHomeRecommendSubject> list(String subjectName, Integer recommendStatus, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        LambdaQueryWrapper<SmsHomeRecommendSubject> wrapper = new LambdaQueryWrapper<SmsHomeRecommendSubject>()
                .orderByDesc(SmsHomeRecommendSubject::getSort);
        if(!StringUtils.isEmpty(subjectName)){
            wrapper.like(SmsHomeRecommendSubject::getSubjectName, subjectName);
        }
        if(recommendStatus!=null){
            wrapper.eq(SmsHomeRecommendSubject::getRecommendStatus, recommendStatus);
        }
        return recommendProductMapper.selectList(wrapper);
    }
}
