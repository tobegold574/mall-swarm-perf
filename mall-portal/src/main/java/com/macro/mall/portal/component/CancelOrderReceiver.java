package com.macro.mall.portal.component;

import com.macro.mall.portal.service.OmsPortalOrderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitHandler;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 取消订单消息的处理者
 * Created by macro on 2018/9/14.
 * 
 * 默认 AUTO 模式
 * 方法正常返回 自动 ACK
 * 方法抛出异常 NACK 返回队列（理论上可能导致毒消息死循环，当前场景无此问题）
 */
@Component
@RabbitListener(queues = "mall.order.cancel")       // 声明是消费者（生产确认没有配） 订阅指定队列
public class CancelOrderReceiver {
    private static Logger LOGGER =LoggerFactory.getLogger(CancelOrderReceiver.class);
    @Autowired
    private OmsPortalOrderService portalOrderService;
    // 消费者
    @RabbitHandler
    public void handle(Long orderId){
        portalOrderService.cancelOrder(orderId);
        LOGGER.info("process orderId:{}",orderId);
    }
}
