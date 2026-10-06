package com.macro.mall.controller;

// 静态工厂，生成标准响应返回
import com.macro.mall.common.api.CommonResult;
// MBG 自动生成的含setter/getter
import com.macro.mall.model.CmsPrefrenceArea;
// impl通过接口生成代理对象引入
import com.macro.mall.service.CmsPrefrenceAreaService;
// OpenAPI 3 注解（springdoc），替代 dev-v2 的 springfox：@Tag ≈ @Api，@Operation(summary=...) ≈ @ApiOperation
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
// Controller Service Repository Component 都既是 bean，也是 stereotype
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

import java.util.List;

/**
 * 商品优选管理Controller
 * Created by macro on 2018/6/1.
 */
@Controller
@Tag(name = "CmsPrefrenceAreaController", description = "商品优选管理")
@RequestMapping("/prefrenceArea")
public class CmsPrefrenceAreaController {
    @Autowired
    private CmsPrefrenceAreaService prefrenceAreaService;

    @Operation(summary = "获取所有商品优选")
    @RequestMapping(value = "/listAll", method = RequestMethod.GET)
    @ResponseBody
    public CommonResult<List<CmsPrefrenceArea>> listAll() {
        List<CmsPrefrenceArea> prefrenceAreaList = prefrenceAreaService.listAll();
        return CommonResult.success(prefrenceAreaList);
    }
}
