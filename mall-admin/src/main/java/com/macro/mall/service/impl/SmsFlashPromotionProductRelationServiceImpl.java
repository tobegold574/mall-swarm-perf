package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.dao.SmsFlashPromotionProductRelationDao;
import com.macro.mall.dto.SmsFlashPromotionProduct;
import com.macro.mall.mapper.SmsFlashPromotionProductRelationMapper;
import com.macro.mall.model.SmsFlashPromotionProductRelation;
import com.macro.mall.service.SmsFlashPromotionProductRelationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 限时购商品关联管理Service实现类
 * Created by macro on 2018/11/16.
 */
@Service
public class SmsFlashPromotionProductRelationServiceImpl implements SmsFlashPromotionProductRelationService {
    @Autowired
    private SmsFlashPromotionProductRelationMapper relationMapper;
    @Autowired
    private SmsFlashPromotionProductRelationDao relationDao;
    @Override
    public int create(List<SmsFlashPromotionProductRelation> relationList) {
        for (SmsFlashPromotionProductRelation relation : relationList) {
            relationMapper.insert(relation);
        }
        return relationList.size();
    }

    @Override
    public int update(Long id, SmsFlashPromotionProductRelation relation) {
        relation.setId(id);
        return relationMapper.update(null, new LambdaUpdateWrapper<SmsFlashPromotionProductRelation>()
                .eq(SmsFlashPromotionProductRelation::getId, relation.getId())
                .set(SmsFlashPromotionProductRelation::getFlashPromotionId, relation.getFlashPromotionId())
                .set(SmsFlashPromotionProductRelation::getFlashPromotionSessionId, relation.getFlashPromotionSessionId())
                .set(SmsFlashPromotionProductRelation::getProductId, relation.getProductId())
                .set(SmsFlashPromotionProductRelation::getFlashPromotionPrice, relation.getFlashPromotionPrice())
                .set(SmsFlashPromotionProductRelation::getFlashPromotionCount, relation.getFlashPromotionCount())
                .set(SmsFlashPromotionProductRelation::getFlashPromotionLimit, relation.getFlashPromotionLimit())
                .set(SmsFlashPromotionProductRelation::getSort, relation.getSort()));
    }

    @Override
    public int delete(Long id) {
        return relationMapper.deleteById(id);
    }

    @Override
    public SmsFlashPromotionProductRelation getItem(Long id) {
        return relationMapper.selectById(id);
    }

    @Override
    public List<SmsFlashPromotionProduct> list(Long flashPromotionId, Long flashPromotionSessionId, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        return relationDao.getList(flashPromotionId,flashPromotionSessionId);
    }

    @Override
    public long getCount(Long flashPromotionId, Long flashPromotionSessionId) {
        return relationMapper.selectCount(new LambdaQueryWrapper<SmsFlashPromotionProductRelation>()
                .eq(SmsFlashPromotionProductRelation::getFlashPromotionId, flashPromotionId)
                .eq(SmsFlashPromotionProductRelation::getFlashPromotionSessionId, flashPromotionSessionId));
    }
}
