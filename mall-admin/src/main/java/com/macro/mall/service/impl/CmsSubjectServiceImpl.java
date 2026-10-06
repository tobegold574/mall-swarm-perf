package com.macro.mall.service.impl;

import com.github.pagehelper.PageHelper;
import com.macro.mall.mapper.CmsSubjectMapper;
import com.macro.mall.model.CmsSubject;
import com.macro.mall.model.CmsSubjectExample;
import com.macro.mall.service.CmsSubjectService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 商品专题管理Service实现类
 * Created by macro on 2018/6/1.
 */
@Service
public class CmsSubjectServiceImpl implements CmsSubjectService {
    @Autowired
    private CmsSubjectMapper subjectMapper;

    @Override
    public List<CmsSubject> listAll() {
        return subjectMapper.selectByExample(new CmsSubjectExample());
    }

    @Override
    public List<CmsSubject> list(String keyword, Integer pageNum, Integer pageSize) {
        // 不查库，只把分页参数塞进当前线程，供下次查询调用，返回值用不上
        PageHelper.startPage(pageNum, pageSize);
        // 生成条件容器
        CmsSubjectExample example = new CmsSubjectExample();
        // 创建 Criteria 分组，无参数对应空 where()
        CmsSubjectExample.Criteria criteria = example.createCriteria();
        // null 安全空串判断
        if (!StringUtils.isEmpty(keyword)) {
            // 模糊查询
            criteria.andTitleLike("%" + keyword + "%");
        }
        return subjectMapper.selectByExample(example);
    }
}
