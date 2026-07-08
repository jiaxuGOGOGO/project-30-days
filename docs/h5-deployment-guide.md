# H5 部署指南 — 微信审核合规策略

## 背景

陌生人交友类目需要 ICP 证 + 属地主管部门二次审核，个人或小团队几乎无法通过。因此采用分阶段策略：

| 阶段 | 策略 | 类目选择 | 所需资质 |
|------|------|----------|----------|
| **MVP 验证期** | H5 网页形式在微信内传播 | 无需类目 | 仅需备案域名 |
| **小程序 v1** | "社交-社区/论坛"类目上线 | 社区/论坛 | 较低门槛 |
| **小程序 v2** | 正式申请"陌生人交友"类目 | 陌生人/熟人交友 | ICP证 + 二次审核 |

## H5 版本构建

Taro 3 原生支持 H5 编译，代码几乎不需要修改：

```bash
# 构建 H5 版本
pnpm frontend:build:h5

# 输出目录
frontend/dist/h5/
```

## 部署配置

### 1. Nginx 配置示例

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    root /var/www/project-30-days/frontend/dist/h5;
    index index.html;

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 代理
    location /ws/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 2. 环境变量

在 `frontend/config/index.ts` 中配置 H5 环境：

```typescript
// 生产环境 API 地址
defineConstants: {
  TARO_APP_API_BASE: JSON.stringify('https://your-domain.com/api')
}
```

### 3. 域名备案

- 域名必须完成 ICP 备案才能在微信内正常访问
- 备案周期通常 7-20 个工作日
- 建议使用 `.cn` 域名，备案速度更快

### 4. 微信内分享

H5 版本通过微信内网页分享传播：

```typescript
// 配置微信 JS-SDK 分享
import wx from 'weixin-js-sdk';

wx.config({
  appId: 'your_app_id',
  // ...
});

wx.ready(() => {
  wx.updateAppMessageShareData({
    title: 'Project 30-Days',
    desc: '30天命运实验，你准备好了吗？',
    link: 'https://your-domain.com',
    imgUrl: 'https://your-domain.com/share-cover.png',
  });
});
```

## 注意事项

1. **WebSocket 兼容性**：H5 版本使用原生 WebSocket，无需额外适配
2. **Canvas 兼容性**：Matter.js 在 H5 环境使用标准 Canvas API，无需 Taro 适配层
3. **触觉反馈**：H5 环境不支持 `Taro.vibrateShort`，需要做降级处理（已在组件中 `.catch()` 处理）
4. **视频播放**：H5 环境使用标准 `<video>` 标签，自动播放需要 muted 属性

## 从 H5 迁移到小程序

当 ICP 证申请完成后，迁移步骤：

1. 替换 `project.config.json` 中的 AppID
2. 配置小程序服务器域名白名单
3. 提交审核（选择"社区/论坛"类目）
4. 通过后逐步申请"陌生人交友"类目
