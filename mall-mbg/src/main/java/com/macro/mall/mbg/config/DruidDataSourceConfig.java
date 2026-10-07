package com.macro.mall.mbg.config;

import com.alibaba.druid.pool.DruidDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * SB4 已移除 spring-boot-autoconfigure.jdbc 包，druid-spring-boot-3-starter 失效，
 * 改为手动装配 Druid 数据源：基础四项来自 spring.datasource.*，池参数由
 * spring.datasource.druid.* 前缀绑定（initial-size/min-idle/max-active 等）。
 */
@Configuration(proxyBeanMethods = false)
public class DruidDataSourceConfig {

    @Bean
    @ConfigurationProperties("spring.datasource.druid")
    public DataSource dataSource(@Value("${spring.datasource.url}") String url,
                                 @Value("${spring.datasource.username}") String username,
                                 @Value("${spring.datasource.password}") String password) {
        DruidDataSource ds = new DruidDataSource();
        ds.setUrl(url);
        ds.setUsername(username);
        ds.setPassword(password);
        return ds;
    }
}
