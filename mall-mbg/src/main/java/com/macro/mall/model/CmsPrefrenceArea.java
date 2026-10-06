package com.macro.mall.model;

/**
 * 给前端生成接口文档的注解
 * dev-v2 时代是 io.swagger.annotations.ApiModelProperty(value = "...")
 * master 用 OpenAPI 3（springdoc），生成的是 io.swagger.v3.oas.annotations.media.Schema，形态为 @Schema(title = "...")
 * 注意：本文件由 MBG 自动生成，重新运行 Generator 会覆盖这里的注释
 */
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 标记接口（Marker Interface）
 * 实现了代表可以被序列化
 * 未实现在写入网络/硬盘时会报 NotSerializableException
*/
import java.io.Serializable;

public class CmsPrefrenceArea implements Serializable {
    private Long id;

    private String name;

    private String subTitle;

    private Integer sort;

    private Integer showStatus;

    @Schema(title = "展示图片")
    private byte[] pic;

    private static final long serialVersionUID = 1L;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getSubTitle() {
        return subTitle;
    }

    public void setSubTitle(String subTitle) {
        this.subTitle = subTitle;
    }

    public Integer getSort() {
        return sort;
    }

    public void setSort(Integer sort) {
        this.sort = sort;
    }

    public Integer getShowStatus() {
        return showStatus;
    }

    public void setShowStatus(Integer showStatus) {
        this.showStatus = showStatus;
    }

    public byte[] getPic() {
        return pic;
    }

    public void setPic(byte[] pic) {
        this.pic = pic;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        sb.append(getClass().getSimpleName());
        sb.append(" [");
        sb.append("Hash = ").append(hashCode());
        sb.append(", id=").append(id);
        sb.append(", name=").append(name);
        sb.append(", subTitle=").append(subTitle);
        sb.append(", sort=").append(sort);
        sb.append(", showStatus=").append(showStatus);
        sb.append(", pic=").append(pic);
        sb.append(", serialVersionUID=").append(serialVersionUID);
        sb.append("]");
        return sb.toString();
    }
}