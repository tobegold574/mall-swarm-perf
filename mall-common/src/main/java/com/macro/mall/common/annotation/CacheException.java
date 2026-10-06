package com.macro.mall.common.annotation;

import java.lang.annotation.*;

/**
 * 自定义注解，有该注解的缓存方法会抛出异常
 * 只有定义，但是没有 AOP 消费者
 */
@Documented
// 只能贴在方法上
@Target(ElementType.METHOD)
// 生命周期 保留到运行期（支持反射调用）
@Retention(RetentionPolicy.RUNTIME)
public @interface CacheException {
}
