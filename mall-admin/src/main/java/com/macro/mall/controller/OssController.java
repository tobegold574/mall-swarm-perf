package com.macro.mall.controller;


import com.macro.mall.common.api.CommonResult;

/**
 * 先 PolicyResult 再 CallbackResult
 * 前者是签发通行证，后者是 oss post触发的回调结果
 * 
 * CallbackResult
 * 前端访问->每次后端生成新的回调指令，返回前端->前端带着回调指令访问 oss->oss 主动调用回调 /callback->响应经 oss 透传回到前端
 * 此处回调内部只有 url 格式化工具，无预热等逻辑
 * 后端处理逻辑需要足够快，不然 oss 返回前端的响应会失败，因为是串行
 */
import com.macro.mall.dto.OssCallbackResult;
import com.macro.mall.dto.OssPolicyResult;
import com.macro.mall.service.impl.OssServiceImpl;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Oss相关操作接口
 * Created by macro on 2018/4/26.
 */
@Controller
@Tag(name = "OssController", description = "Oss管理")
@RequestMapping("/aliyun/oss")
public class OssController {
    @Autowired
    private OssServiceImpl ossService;

    @Operation(summary = "oss上传签名生成")
    @RequestMapping(value = "/policy", method = RequestMethod.GET)
    @ResponseBody
    public CommonResult<OssPolicyResult> policy() {
        OssPolicyResult result = ossService.policy();
        return CommonResult.success(result);
    }

    @Operation(summary = "oss上传成功回调")
    @RequestMapping(value = "callback", method = RequestMethod.POST)
    @ResponseBody
    // 格式是动态约定而不是固定接口契约
    public CommonResult<OssCallbackResult> callback(HttpServletRequest request) {
        OssCallbackResult ossCallbackResult = ossService.callback(request);
        return CommonResult.success(ossCallbackResult);
    }

}
