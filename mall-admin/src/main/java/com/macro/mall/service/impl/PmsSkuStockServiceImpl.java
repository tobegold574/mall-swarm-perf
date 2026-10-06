package com.macro.mall.service.impl;

import com.macro.mall.dao.PmsSkuStockDao;
import com.macro.mall.mapper.PmsSkuStockMapper;
import com.macro.mall.model.PmsSkuStock;
import com.macro.mall.model.PmsSkuStockExample;
import com.macro.mall.service.PmsSkuStockService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 商品sku库存管理Service实现类
 * Created by macro on 2018/4/27.
 */
@Service
public class PmsSkuStockServiceImpl implements PmsSkuStockService {
    @Autowired
    private PmsSkuStockMapper skuStockMapper;
    @Autowired
    private PmsSkuStockDao skuStockDao;

    @Override
    public List<PmsSkuStock> getList(Long pid, String keyword) {
        PmsSkuStockExample example = new PmsSkuStockExample();
        PmsSkuStockExample.Criteria criteria = example.createCriteria().andProductIdEqualTo(pid);
        if (!StringUtils.isEmpty(keyword)) {
            criteria.andSkuCodeLike("%" + keyword + "%");
        }
        return skuStockMapper.selectByExample(example);
    }

    /**
     * @param pid 参数完全没有用到，demo简化 完全相信前端的数据，
     */
    @Override
    public int update(Long pid, List<PmsSkuStock> skuStockList) {
        // replace = 逐条 delete + insert（换新的主键）
        return skuStockDao.replaceList(skuStockList);
    }
}
