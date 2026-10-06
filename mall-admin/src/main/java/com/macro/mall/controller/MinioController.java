package com.macro.mall.controller;

/**
 * hutool 服务器端工具库
 * 大量使用静态方法，调用方便
 * 能自动识别环境或参数
 */
import cn.hutool.core.collection.CollUtil;
import cn.hutool.json.JSONUtil;
// 手写的统一结果工厂接口
import com.macro.mall.common.api.CommonResult;
// oss 访问策略配置
import com.macro.mall.dto.BucketPolicyConfigDto;
// 上传成功后返回文件链接到前端的出参
import com.macro.mall.dto.MinioUploadDto;
// minio相关方法
import io.minio.*;

// 描述单个接口方法
import io.swagger.v3.oas.annotations.Operation;
// 描述整个 Controller 类
import io.swagger.v3.oas.annotations.tags.Tag;
/**
 * Simple Logging Facade For Java 
 * 门面模式 只定义 Logger 接口 与具体实现解耦，方便后续更换实现类
 */ 
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

// 单个配置项注入 把配置文件里的值填入字段
import org.springframework.beans.factory.annotation.Value;

import org.springframework.stereotype.Controller;
// Spirng MVC 的注解全家桶（声明映射器、路由映射、参数绑定、响应与全局增强、其他如跨域处理）
import org.springframework.web.bind.annotation.*;
// multipart 协议（Tomcat 中先写入服务器临时目录，不占堆内存）
import org.springframework.web.multipart.MultipartFile;

/**
 * JDK 自带日期时间类，老 API，非线程安全
 * Date 表示一个时间点
 * SimpleDateFormat 是 Date 和 String 之间的格式化/解析器
 */
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * MinIO对象存储管理
 * Created by macro on 2019/12/25.
 */
@Tag(name = "MinioController", description = "MinIO对象存储管理")
@Controller
@RequestMapping("/minio")
public class MinioController {

    // 类静态单例，用类名作为唯一标识
    private static final Logger LOGGER = LoggerFactory.getLogger(MinioController.class);

    // 配置字段注入
    @Value("${minio.endpoint}")
    private String ENDPOINT;
    @Value("${minio.bucketName}")
    private String BUCKET_NAME;
    @Value("${minio.accessKey}")
    private String ACCESS_KEY;
    @Value("${minio.secretKey}")
    private String SECRET_KEY;

    @Operation(summary = "文件上传")
    @RequestMapping(value = "/upload", method = RequestMethod.POST)
    @ResponseBody
    public CommonResult upload(@RequestPart("file") MultipartFile file) {
        try {
            // 创建一个MinIO的Java客户端
            // builder 链式构造器
            MinioClient minioClient =MinioClient.builder()
                    .endpoint(ENDPOINT)
                    .credentials(ACCESS_KEY,SECRET_KEY)
                    .build();
            boolean isExist = minioClient.bucketExists(BucketExistsArgs.builder().bucket(BUCKET_NAME).build());
            if (isExist) {
                LOGGER.info("存储桶已经存在！");
            } else {
                //创建存储桶并设置只读权限
                minioClient.makeBucket(MakeBucketArgs.builder().bucket(BUCKET_NAME).build());
                BucketPolicyConfigDto bucketPolicyConfigDto = createBucketPolicyConfigDto(BUCKET_NAME);
                SetBucketPolicyArgs setBucketPolicyArgs = SetBucketPolicyArgs.builder()
                        .bucket(BUCKET_NAME)
                        .config(JSONUtil.toJsonStr(bucketPolicyConfigDto))
                        .build();
                minioClient.setBucketPolicy(setBucketPolicyArgs);
            }
            String filename = file.getOriginalFilename();
            SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMdd");
            // 设置存储对象名称
            String objectName = sdf.format(new Date()) + "/" + filename;
            // 使用 putObject 上传一个文件到存储桶中
            PutObjectArgs putObjectArgs = PutObjectArgs.builder()
                    .bucket(BUCKET_NAME)
                    .object(objectName)
                    .contentType(file.getContentType())
                    .stream(file.getInputStream(), file.getSize(), ObjectWriteArgs.MIN_MULTIPART_SIZE).build();
            minioClient.putObject(putObjectArgs);   // 提供流的引用，即管道，分片上传（分片的意义在于减小 JVM 的内存压力）
            LOGGER.info("文件上传成功!");
            // 向前端返回已上传的文件地址
            MinioUploadDto minioUploadDto = new MinioUploadDto();
            minioUploadDto.setName(filename);
            minioUploadDto.setUrl(ENDPOINT + "/" + BUCKET_NAME + "/" + objectName);
            return CommonResult.success(minioUploadDto);
        } catch (Exception e) {
            // 错误，绕过日志框架
            e.printStackTrace();
            // 打印走日志框架
            LOGGER.info("上传发生错误: {}！", e.getMessage());
        }
        return CommonResult.failed();
    }

    private BucketPolicyConfigDto createBucketPolicyConfigDto(String bucketName) {
        // 随环境变的进配置，随需求变的进代码，永不变的当常量
        // AWS S3 策略 JSON
        BucketPolicyConfigDto.Statement statement = BucketPolicyConfigDto.Statement.builder()
                .Effect("Allow")    // 桶可以匿名只读（前端直接展示）
                .Principal("*")     // 授权给谁
                .Action("s3:GetObject")     // 允许什么操作 GetObject 读取/下载一个文件
                .Resource("arn:aws:s3:::"+bucketName+"/*.**").build();  // 作用范围 ARN 是 AWS 的资源命名格式，arn:aws:s3:::桶名/对象键通配。这里 = mall 桶下的所有对象
        return BucketPolicyConfigDto.builder()
                .Version("2012-10-17")  // 策略语法格式的版本号 全行业 S3 兼容存储统一的固定值
                .Statement(CollUtil.toList(statement))  // 单条规则包装成 list 装进数组
                .build();
    }

    @Operation(summary = "文件删除")
    @RequestMapping(value = "/delete", method = RequestMethod.POST)
    @ResponseBody
    public CommonResult delete(@RequestParam("objectName") String objectName) {
        try {
            MinioClient minioClient = MinioClient.builder()
                    .endpoint(ENDPOINT)
                    .credentials(ACCESS_KEY,SECRET_KEY)
                    .build();
            minioClient.removeObject(RemoveObjectArgs.builder().bucket(BUCKET_NAME).object(objectName).build());
            return CommonResult.success(null);
        } catch (Exception e) {
            e.printStackTrace();
        }
        return CommonResult.failed();
    }
}
