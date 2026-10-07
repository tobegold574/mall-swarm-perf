package com.macro.mall.service.impl;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.common.constant.AuthConstant;
import com.macro.mall.common.service.RedisService;
import com.macro.mall.mapper.UmsResourceMapper;
import com.macro.mall.model.*;
import com.macro.mall.service.UmsResourceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * 后台资源管理Service实现类
 * Created by macro on 2020/2/2.
 */
@Service
public class UmsResourceServiceImpl implements UmsResourceService {
    @Autowired
    private UmsResourceMapper resourceMapper;
    @Autowired
    private RedisService redisService;
    @Value("${spring.application.name}")
    private String applicationName;
    @Override
    public int create(UmsResource umsResource) {
        umsResource.setCreateTime(new Date());
        int count = resourceMapper.insert(umsResource);
        initPathResourceMap();
        return count;
    }

    @Override
    public int update(Long id, UmsResource umsResource) {
        umsResource.setId(id);
        int count = resourceMapper.updateById(umsResource);
        initPathResourceMap();
        return count;
    }

    @Override
    public UmsResource getItem(Long id) {
        return resourceMapper.selectById(id);
    }

    @Override
    public int delete(Long id) {
        int count = resourceMapper.deleteById(id);
        initPathResourceMap();
        return count;
    }

    @Override
    public List<UmsResource> list(Long categoryId, String nameKeyword, String urlKeyword, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum,pageSize);
        LambdaQueryWrapper<UmsResource> wrapper = new LambdaQueryWrapper<>();
        if(categoryId!=null){
            wrapper.eq(UmsResource::getCategoryId, categoryId);
        }
        if(StrUtil.isNotEmpty(nameKeyword)){
            wrapper.like(UmsResource::getName, nameKeyword);
        }
        if(StrUtil.isNotEmpty(urlKeyword)){
            wrapper.like(UmsResource::getUrl, urlKeyword);
        }
        return resourceMapper.selectList(wrapper);
    }

    @Override
    public List<UmsResource> listAll() {
        return resourceMapper.selectList(new LambdaQueryWrapper<UmsResource>());
    }

    @Override
    public Map<String,String> initPathResourceMap() {
        // 迭代顺序稳定
        Map<String,String> pathResourceMap = new TreeMap<>();
        List<UmsResource> resourceList = resourceMapper.selectList(new LambdaQueryWrapper<UmsResource>());
        for (UmsResource resource : resourceList) {
            // key 完整请求路径（以网关视角建表，所以要带上 applicationName）
            // value 资源标识（ id 用于防止不同类别权限重名）
            pathResourceMap.put("/"+applicationName+resource.getUrl(),resource.getId()+":"+resource.getName());
        }
        // 先删再整包写，保证一致
        redisService.del(AuthConstant.PATH_RESOURCE_MAP);
        redisService.hSetAll(AuthConstant.PATH_RESOURCE_MAP, pathResourceMap);
        return pathResourceMap;

    }
}
