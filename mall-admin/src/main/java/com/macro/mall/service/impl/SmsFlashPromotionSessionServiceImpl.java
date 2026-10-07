package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.macro.mall.dto.SmsFlashPromotionSessionDetail;
import com.macro.mall.mapper.SmsFlashPromotionSessionMapper;
import com.macro.mall.model.SmsFlashPromotionSession;
import com.macro.mall.service.SmsFlashPromotionProductRelationService;
import com.macro.mall.service.SmsFlashPromotionSessionService;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * 限时购场次管理Service实现类
 * Created by macro on 2018/11/16.
 */
@Service
public class SmsFlashPromotionSessionServiceImpl implements SmsFlashPromotionSessionService {
    @Autowired
    private SmsFlashPromotionSessionMapper promotionSessionMapper;
    @Autowired
    private SmsFlashPromotionProductRelationService relationService;

    @Override
    public int create(SmsFlashPromotionSession promotionSession) {
        promotionSession.setCreateTime(new Date());
        return promotionSessionMapper.insert(promotionSession);
    }

    @Override
    public int update(Long id, SmsFlashPromotionSession promotionSession) {
        promotionSession.setId(id);
        return promotionSessionMapper.update(null, new LambdaUpdateWrapper<SmsFlashPromotionSession>()
                .eq(SmsFlashPromotionSession::getId, promotionSession.getId())
                .set(SmsFlashPromotionSession::getName, promotionSession.getName())
                .set(SmsFlashPromotionSession::getStartTime, promotionSession.getStartTime())
                .set(SmsFlashPromotionSession::getEndTime, promotionSession.getEndTime())
                .set(SmsFlashPromotionSession::getStatus, promotionSession.getStatus())
                .set(SmsFlashPromotionSession::getCreateTime, promotionSession.getCreateTime()));
    }

    @Override
    public int updateStatus(Long id, Integer status) {
        SmsFlashPromotionSession promotionSession = new SmsFlashPromotionSession();
        promotionSession.setId(id);
        promotionSession.setStatus(status);
        return promotionSessionMapper.updateById(promotionSession);
    }

    @Override
    public int delete(Long id) {
        return promotionSessionMapper.deleteById(id);
    }

    @Override
    public SmsFlashPromotionSession getItem(Long id) {
        return promotionSessionMapper.selectById(id);
    }

    @Override
    public List<SmsFlashPromotionSession> list() {
        return promotionSessionMapper.selectList(new LambdaQueryWrapper<SmsFlashPromotionSession>());
    }

    @Override
    public List<SmsFlashPromotionSessionDetail> selectList(Long flashPromotionId) {
        List<SmsFlashPromotionSessionDetail> result = new ArrayList<>();
        List<SmsFlashPromotionSession> list = promotionSessionMapper.selectList(new LambdaQueryWrapper<SmsFlashPromotionSession>()
                .eq(SmsFlashPromotionSession::getStatus, 1));
        for (SmsFlashPromotionSession promotionSession : list) {
            SmsFlashPromotionSessionDetail detail = new SmsFlashPromotionSessionDetail();
            BeanUtils.copyProperties(promotionSession, detail);
            long count = relationService.getCount(flashPromotionId, promotionSession.getId());
            detail.setProductCount(count);
            result.add(detail);
        }
        return result;
    }
}
