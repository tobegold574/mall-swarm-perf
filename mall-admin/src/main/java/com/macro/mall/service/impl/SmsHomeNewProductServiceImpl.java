package com.macro.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.SmsHomeNewProductMapper;
import com.macro.mall.model.SmsHomeNewProduct;
import com.macro.mall.service.SmsHomeNewProductService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 首页新品推荐管理Service实现类
 * Created by macro on 2018/11/6.
 */
@Service
public class SmsHomeNewProductServiceImpl implements SmsHomeNewProductService {
    @Autowired
    private SmsHomeNewProductMapper homeNewProductMapper;
    @Override
    public int create(List<SmsHomeNewProduct> homeNewProductList) {
        for (SmsHomeNewProduct SmsHomeNewProduct : homeNewProductList) {
            SmsHomeNewProduct.setRecommendStatus(1);
            SmsHomeNewProduct.setSort(0);
            homeNewProductMapper.insert(SmsHomeNewProduct);
        }
        return homeNewProductList.size();
    }

    @Override
    public int updateSort(Long id, Integer sort) {
        SmsHomeNewProduct homeNewProduct = new SmsHomeNewProduct();
        homeNewProduct.setId(id);
        homeNewProduct.setSort(sort);
        return homeNewProductMapper.updateById(homeNewProduct);
    }

    @Override
    public int delete(List<Long> ids) {
        return homeNewProductMapper.delete(new LambdaQueryWrapper<SmsHomeNewProduct>()
                .in(SmsHomeNewProduct::getId, ids));
    }

    @Override
    public int updateRecommendStatus(List<Long> ids, Integer recommendStatus) {
        SmsHomeNewProduct record = new SmsHomeNewProduct();
        record.setRecommendStatus(recommendStatus);
        return homeNewProductMapper.update(record, new LambdaUpdateWrapper<SmsHomeNewProduct>()
                .in(SmsHomeNewProduct::getId, ids));
    }

    @Override
    public List<SmsHomeNewProduct> list(String productName, Integer recommendStatus, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        LambdaQueryWrapper<SmsHomeNewProduct> wrapper = new LambdaQueryWrapper<SmsHomeNewProduct>()
                .orderByDesc(SmsHomeNewProduct::getSort);
        if(!StringUtils.isEmpty(productName)){
            wrapper.like(SmsHomeNewProduct::getProductName, productName);
        }
        if(recommendStatus!=null){
            wrapper.eq(SmsHomeNewProduct::getRecommendStatus, recommendStatus);
        }
        return homeNewProductMapper.selectList(wrapper);
    }
}
