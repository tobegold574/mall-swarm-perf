package com.macro.mall.dto;

import com.macro.mall.model.OmsCompanyAddress;
import com.macro.mall.model.OmsOrderReturnApply;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/**
 * 申请信息封装
 * Created by macro on 2018/10/18.
 */
// 虽然属于 dto，但是实际上违反了 dto 与 model 的解耦规范，属于偷懒写法
public class OmsOrderReturnApplyResult extends OmsOrderReturnApply {
    // 为避免覆盖父类版本（toString() 以及比较等）只加入最小侵入
    @Getter
    @Setter
    @Schema(title = "公司收货地址")
    private OmsCompanyAddress companyAddress;
}
