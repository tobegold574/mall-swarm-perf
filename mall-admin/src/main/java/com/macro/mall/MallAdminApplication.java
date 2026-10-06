package com.macro.mall;

// 应用启动入口
import org.springframework.boot.SpringApplication;
/** 
 * 相当于同时开启了三个功能：
 * @SpringBootConfiguration 标识这是一个配置类
 * @EnableAutoConfiguration 开启自动配置
 * @ComponentScan 扫描当前包和子包的 @Service @Controller
 * */ 

import org.springframework.boot.autoconfigure.SpringBootApplication;
// 自动把 IP、端口、服务名注册到 Nacos
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
/**
 * 开启 Feign 客户端的扫描功能
 * @FeignClient(name = "mall-portal") Spring 会为这样的接口生成动态代理对象
 */
import org.springframework.cloud.openfeign.EnableFeignClients;

/**
 * 应用启动入口
 * Created by macro on 2018/4/26.
 */
@EnableFeignClients
@EnableDiscoveryClient
@SpringBootApplication
public class MallAdminApplication {
    public static void main(String[] args) {
        SpringApplication.run(MallAdminApplication.class, args);
    }
}
