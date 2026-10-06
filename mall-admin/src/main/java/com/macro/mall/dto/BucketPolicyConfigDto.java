package com.macro.mall.dto;

// 生成链式构造器，但单独用会把无参构造器吃掉，导致序列化失败
import lombok.Builder;
// 相当于全套 getter/setter + toString() + equals/hashCode() + @RequiredArgsConstructor
import lombok.Data;
/**
 * 单独控制相等性比较
 * callSuper = false 只比本类字段
 * callSuper = true 先比父类再比子类
 */
import lombok.EqualsAndHashCode;

import java.util.List;

/**
 * Minio Bucket访问策略配置
 * Created by macro on 2020/8/11.
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Builder
public class BucketPolicyConfigDto {

    // 策略语言版本
    private String Version;
    // 策略语句列表
    private List<Statement> Statement;

    @Data
    @EqualsAndHashCode(callSuper = false)
    @Builder
    public static class Statement {
        // 效果，允许还是拒绝 Allow 或 Deny
        private String Effect;
        // 主体，被授予或拒绝操作的对象
        private String Principal;
        // 操作，允许或拒绝的具体操作
        private String Action;
        // 策略作用的桶或对象
        private String Resource;

    }
}
