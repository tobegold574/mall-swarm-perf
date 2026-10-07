package com.macro.mall.portal.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.macro.mall.mapper.UmsMemberReceiveAddressMapper;
import com.macro.mall.model.UmsMember;
import com.macro.mall.model.UmsMemberReceiveAddress;
import com.macro.mall.portal.service.UmsMemberReceiveAddressService;
import com.macro.mall.portal.service.UmsMemberService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.List;

/**
 * 用户地址管理Service实现类
 * Created by macro on 2018/8/28.
 */
@Service
public class UmsMemberReceiveAddressServiceImpl implements UmsMemberReceiveAddressService {
    @Autowired
    private UmsMemberService memberService;
    @Autowired
    private UmsMemberReceiveAddressMapper addressMapper;
    @Override
    public int add(UmsMemberReceiveAddress address) {
        UmsMember currentMember = memberService.getCurrentMember();
        address.setMemberId(currentMember.getId());
        return addressMapper.insert(address);
    }

    @Override
    public int delete(Long id) {
        UmsMember currentMember = memberService.getCurrentMember();
        return addressMapper.delete(new LambdaQueryWrapper<UmsMemberReceiveAddress>()
                .eq(UmsMemberReceiveAddress::getMemberId, currentMember.getId())
                .eq(UmsMemberReceiveAddress::getId, id));
    }

    @Override
    public int update(Long id, UmsMemberReceiveAddress address) {
        address.setId(null);
        UmsMember currentMember = memberService.getCurrentMember();
        LambdaUpdateWrapper<UmsMemberReceiveAddress> wrapper = new LambdaUpdateWrapper<UmsMemberReceiveAddress>()
                .eq(UmsMemberReceiveAddress::getMemberId, currentMember.getId())
                .eq(UmsMemberReceiveAddress::getId, id);
        if(address.getDefaultStatus()==1){
            //先将原来的默认地址去除
            UmsMemberReceiveAddress record= new UmsMemberReceiveAddress();
            record.setDefaultStatus(0);
            LambdaUpdateWrapper<UmsMemberReceiveAddress> updateWrapper = new LambdaUpdateWrapper<UmsMemberReceiveAddress>()
                    .eq(UmsMemberReceiveAddress::getMemberId, currentMember.getId())
                    .eq(UmsMemberReceiveAddress::getDefaultStatus, 1);
            addressMapper.update(record,updateWrapper);
        }
        return addressMapper.update(address,wrapper);
    }

    @Override
    public List<UmsMemberReceiveAddress> list() {
        UmsMember currentMember = memberService.getCurrentMember();
        return addressMapper.selectList(new LambdaQueryWrapper<UmsMemberReceiveAddress>()
                .eq(UmsMemberReceiveAddress::getMemberId, currentMember.getId()));
    }

    @Override
    public UmsMemberReceiveAddress getItem(Long id) {
        UmsMember currentMember = memberService.getCurrentMember();
        List<UmsMemberReceiveAddress> addressList = addressMapper.selectList(new LambdaQueryWrapper<UmsMemberReceiveAddress>()
                .eq(UmsMemberReceiveAddress::getMemberId, currentMember.getId())
                .eq(UmsMemberReceiveAddress::getId, id));
        if(!CollectionUtils.isEmpty(addressList)){
            return addressList.get(0);
        }
        return null;
    }
}
