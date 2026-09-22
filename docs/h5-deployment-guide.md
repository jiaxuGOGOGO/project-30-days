# H5 构建与隔离测试部署指南

> 当前已加入 U02-A 会话/HTTP 对象权限，但无公开登录接入，媒体和旧 WS 已关闭，前端含演示数据。以下是内部部署参考，不是公开上线许可或生产安全方案。H5 不豁免法规、隐私义务或微信平台规则；按真实业务核定资质与类目，不通过更换类目规避审核。

## 构建和产物

使用仓库锁定的 Node/pnpm，先在根目录安装依赖：

```bash
pnpm install --frozen-lockfile --prod=false
pnpm frontend:build:h5
pnpm frontend:build:weapp
test -s frontend/dist/h5/index.html
test -s frontend/dist/weapp/app.json
```

H5 依赖 `frontend/src/index.html` 模板；只有 JS 编译成功不算完整站点。两端输出分别位于 `frontend/dist/h5` 和 `frontend/dist/weapp`。微信开发者工具打开 frontend，miniprogramRoot 已指向后者。游客 AppID 只适合开发，不能替代真实应用注册。

## API 地址与代理

当前 API 路径混合 `/api/day30/`、`/yomi/`、`/boarding/` 等；WS 路径是 **`/events`**，不是 `/ws/`；U02-A 暂时一律关闭订阅，下面代理仅保留路径约定。不要只代理 `/api/`，也不要给所有调用重复加 `/api`。

`frontend/config/index.ts` 在构建时注入 `process.env.TARO_APP_API_BASE`；同源通常留空，跨域需填写完整 API origin（不额外附加 /api），并在后续接入时配置受限 CORS；当前后端没有开放跨域策略。前端还未完成统一 API 客户端接入，设置变量不意味着所有页面已正确使用它，见 U09。

内部测试 Nginx 示例（证书、访问限制和日志策略需另配；后端绑定 loopback）：

```nginx
server {
    listen 443 ssl;
    server_name test.example.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    root /var/www/project-30-days/frontend/dist/h5;
    index index.html;

    location = /events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 65s;
    }
    location ~ ^/(auth|api|yomi|boarding|daily-echo|media|hourglass|observer|season|stardust-ticket)(/|$) {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

该代理示例尚未实机部署验收，不包含鉴权、限流或运营安全设施，不能替代应用权限控制。添加接口后需同步路由契约。后续 U10 统一验证 HTTP、WS upgrade、SPA fallback 和静态资源。

## 上线前未完成项

- 浏览器和微信真机验证 Canvas、触摸/传感器、后台恢复、WS 重连、视频播放和分享；跨端编译通过不代表无需适配。
- 微信 JS-SDK 签名由服务端安全生成；当前仓库没有完整分享接入，不提供假可用示例。
- 按运营地区、部署地点、用户群体与真实社交业务确认备案/许可、平台类目及个人信息义务，不承诺固定审核时长或“仅备案即可”。
- 完成 U02–U11 权限、生命周期、隐私、媒体、观测和回滚门禁，才考虑真实用户邀请测试。
