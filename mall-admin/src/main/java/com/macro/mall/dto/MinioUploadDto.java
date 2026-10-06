package com.macro.mall.dto;

import io.swagger.v3.oas.annotations.media.Schema;
// setter/getter 全家桶
import lombok.Data;
// 生成 equals() 和 hashCode() 两个方法
import lombok.EqualsAndHashCode;

/**
 * 文件上传返回结果
 * Created by macro on 2019/12/25.
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class MinioUploadDto {
    @Schema(title = "文件访问URL")
    private String url;
    @Schema(title = "文件名称")
    private String name;
}
