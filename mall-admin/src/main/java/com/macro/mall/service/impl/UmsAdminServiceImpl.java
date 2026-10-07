package com.macro.mall.service.impl;

import cn.dev33.satoken.stp.SaTokenInfo;
// 从 ThreadLocal 拿当前请求上下文
import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.BCrypt;
import cn.hutool.extra.spring.SpringUtil;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.macro.mall.common.api.CommonResult;
import com.macro.mall.common.api.ResultCode;
import com.macro.mall.common.constant.AuthConstant;
import com.macro.mall.common.dto.UserDto;
import com.macro.mall.common.exception.Asserts;
import com.macro.mall.dao.UmsAdminRoleRelationDao;
import com.macro.mall.dto.UmsAdminParam;
import com.macro.mall.dto.UpdateAdminPasswordParam;
import com.macro.mall.mapper.UmsAdminLoginLogMapper;
import com.macro.mall.mapper.UmsAdminMapper;
import com.macro.mall.mapper.UmsAdminRoleRelationMapper;
import com.macro.mall.model.*;
import com.macro.mall.service.UmsAdminCacheService;
import com.macro.mall.service.UmsAdminService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.*;
import java.util.stream.Collectors;

/**
 * UmsAdminService实现类
 * Created by macro on 2018/4/26.
 */
@Service
public class UmsAdminServiceImpl implements UmsAdminService {
    private static final Logger LOGGER = LoggerFactory.getLogger(UmsAdminServiceImpl.class);
    @Autowired
    private UmsAdminMapper adminMapper;
    @Autowired
    private UmsAdminRoleRelationMapper adminRoleRelationMapper;
    @Autowired
    private UmsAdminRoleRelationDao adminRoleRelationDao;
    @Autowired
    private UmsAdminLoginLogMapper loginLogMapper;
    @Autowired
    private UmsAdminCacheService adminCacheService;

    @Override
    public UmsAdmin getAdminByUsername(String username) {
        List<UmsAdmin> adminList = adminMapper.selectList(new LambdaQueryWrapper<UmsAdmin>()
                .eq(UmsAdmin::getUsername, username));
        if (adminList != null && adminList.size() > 0) {
            return adminList.get(0);
        }
        return null;
    }

    @Override
    public UmsAdmin register(UmsAdminParam umsAdminParam) {
        UmsAdmin umsAdmin = new UmsAdmin();
        BeanUtils.copyProperties(umsAdminParam, umsAdmin);
        umsAdmin.setCreateTime(new Date());
        // 启用
        umsAdmin.setStatus(1);
        //查询是否有相同用户名的用户
        List<UmsAdmin> umsAdminList = adminMapper.selectList(new LambdaQueryWrapper<UmsAdmin>()
                .eq(UmsAdmin::getUsername, umsAdmin.getUsername()));
        if (umsAdminList.size() > 0) {
            // 上层逻辑判空会转成通用失败响应
            return null;
        }
        //将密码进行加密操作
        String encodePassword = BCrypt.hashpw(umsAdmin.getPassword());
        umsAdmin.setPassword(encodePassword);
        adminMapper.insert(umsAdmin);
        return umsAdmin;
    }

    @Override
    public SaTokenInfo login(String username, String password) {
        if(StrUtil.isEmpty(username)||StrUtil.isEmpty(password)){
            Asserts.fail("用户名或密码不能为空！");
        }
        UmsAdmin admin = getAdminByUsername(username);
        if(admin==null){
            Asserts.fail("找不到该用户！");
        }
        if (!BCrypt.checkpw(password, admin.getPassword())) {
            Asserts.fail("密码不正确！");
        }
        if(admin.getStatus()!=1){
            Asserts.fail("该账号已被禁用！");
        }
        // 登录校验成功后，一行代码实现登录
        StpUtil.login(admin.getId());
        UserDto userDto = new UserDto();
        userDto.setId(admin.getId());
        userDto.setUsername(admin.getUsername());
        // 管理后台/前端商城，无影响，通过路径进行鉴权分流
        userDto.setClientId(AuthConstant.ADMIN_CLIENT_ID);
        // 有哪些权限点
        List<UmsResource> resourceList = getResourceList(admin.getId());
        List<String> permissionList = resourceList.stream().map(item -> item.getId() + ":" + item.getName()).toList();
        userDto.setPermissionList(permissionList);
        // 将用户信息存储到Session中
        StpUtil.getSession().set(AuthConstant.STP_ADMIN_INFO,userDto);
        // 获取当前登录用户Token信息
        SaTokenInfo saTokenInfo = StpUtil.getTokenInfo();
        insertLoginLog(admin);
        return saTokenInfo;
    }

    /**
     * 添加登录记录
     */
    private void insertLoginLog(UmsAdmin admin) {
        if(admin==null) return;
        UmsAdminLoginLog loginLog = new UmsAdminLoginLog();
        loginLog.setAdminId(admin.getId());
        loginLog.setCreateTime(new Date());
        // 不会泄露密码，因为只取 IP
        // 其实是从 ThreadLocal 取的，Tomcat 分配工作线程->Spring mvc 包装并放入线程内
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        HttpServletRequest request = attributes.getRequest();
        // 仅纳入业务审计表，防爆破只有 BCrypt 慢哈希
        loginLog.setIp(request.getRemoteAddr());
        loginLogMapper.insert(loginLog);
    }

    /**
     * 根据用户名修改登录时间（上次登录时间）
     */
    private void updateLoginTimeByUsername(String username) {
        UmsAdmin record = new UmsAdmin();
        record.setLoginTime(new Date());
        adminMapper.update(record, new LambdaUpdateWrapper<UmsAdmin>()
                .eq(UmsAdmin::getUsername, username));
    }

    @Override
    public UmsAdmin getItem(Long id) {
        return adminMapper.selectById(id);
    }

    @Override
    public List<UmsAdmin> list(String keyword, Integer pageSize, Integer pageNum) {
        PageHelper.startPage(pageNum, pageSize);
        LambdaQueryWrapper<UmsAdmin> wrapper = new LambdaQueryWrapper<>();
        if (!StringUtils.isEmpty(keyword)) {
            wrapper.like(UmsAdmin::getUsername, keyword)
                    .or()
                    .like(UmsAdmin::getNickName, keyword);
        }
        return adminMapper.selectList(wrapper);
    }

    // selective 更新 即不碰 null
    @Override
    public int update(Long id, UmsAdmin admin) {
        admin.setId(id);
        UmsAdmin rawAdmin = adminMapper.selectById(id);
        if(rawAdmin.getPassword().equals(admin.getPassword())){
            //与原加密密码相同的不需要修改
            admin.setPassword(null);
        }else{
            //与原加密密码不同的需要加密修改
            if(StrUtil.isEmpty(admin.getPassword())){
                admin.setPassword(null);
            }else{
                admin.setPassword(BCrypt.hashpw(admin.getPassword()));
            }
        }
        int count = adminMapper.updateById(admin);
        // 角色变了，旧缓存失效
        adminCacheService.delAdmin(id);
        return count;
    }

    @Override
    public int delete(Long id) {
        int count = adminMapper.deleteById(id);
        // 清缓存
        adminCacheService.delAdmin(id);
        return count;
    }

    @Override
    public int updateRole(Long adminId, List<Long> roleIds) {
        int count = roleIds == null ? 0 : roleIds.size();
        //先删除原来的关系
        adminRoleRelationMapper.delete(new LambdaQueryWrapper<UmsAdminRoleRelation>()
                .eq(UmsAdminRoleRelation::getAdminId, adminId));
        //建立新关系
        if (!CollectionUtils.isEmpty(roleIds)) {
            List<UmsAdminRoleRelation> list = new ArrayList<>();
            for (Long roleId : roleIds) {
                UmsAdminRoleRelation roleRelation = new UmsAdminRoleRelation();
                roleRelation.setAdminId(adminId);
                roleRelation.setRoleId(roleId);
                list.add(roleRelation);
            }
            adminRoleRelationDao.insertList(list);
        }
        return count;
    }

    @Override
    public List<UmsRole> getRoleList(Long adminId) {
        return adminRoleRelationDao.getRoleList(adminId);
    }

    @Override
    public List<UmsResource> getResourceList(Long adminId) {
        return adminRoleRelationDao.getResourceList(adminId);
    }

    // -1 -2 -3 在 controller 层面转义
    @Override
    public int updatePassword(UpdateAdminPasswordParam param) {
        if(StrUtil.isEmpty(param.getUsername())
                ||StrUtil.isEmpty(param.getOldPassword())
                ||StrUtil.isEmpty(param.getNewPassword())){
            return -1;
        }
        List<UmsAdmin> adminList = adminMapper.selectList(new LambdaQueryWrapper<UmsAdmin>()
                .eq(UmsAdmin::getUsername, param.getUsername()));
        if(CollUtil.isEmpty(adminList)){
            return -2;
        }
        UmsAdmin umsAdmin = adminList.get(0);
        if(!BCrypt.checkpw(param.getOldPassword(),umsAdmin.getPassword())){
            return -3;
        }
        umsAdmin.setPassword(BCrypt.hashpw(param.getNewPassword()));
        adminMapper.updateById(umsAdmin);
        // 清缓存
        adminCacheService.delAdmin(umsAdmin.getId());
        return 1;
    }

    @Override
    public UmsAdmin getCurrentAdmin() {
        UserDto userDto = (UserDto) StpUtil.getSession().get(AuthConstant.STP_ADMIN_INFO);
        // 先查缓存
        UmsAdmin admin = adminCacheService.getAdmin(userDto.getId());
        // 未命中查库回填
        if (admin == null) {
            admin = adminMapper.selectById(userDto.getId());
            adminCacheService.setAdmin(admin);
        }
        return admin;
    }
    @Override
    public void logout() {
        //先清空缓存
        UserDto userDto = (UserDto) StpUtil.getSession().get(AuthConstant.STP_ADMIN_INFO);
        // 清缓存
        adminCacheService.delAdmin(userDto.getId());
        //再调用sa-token的登出方法
        StpUtil.logout();
    }
}
