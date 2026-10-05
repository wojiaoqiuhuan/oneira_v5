# Manus Space 运行说明

ONEIRA 梦面包 V5.2 已迁移到 Manus Space 的 Node + MySQL 兼容数据库运行方式。项目不使用 Supabase、Render 或 Railway。

## 服务启动顺序

1. 读取 `DATABASE_URL`。
2. 建立 `schema_migrations` 表并执行未完成迁移。
3. 幂等初始化咸阳店、李店长、运营、管理员和日报字段。
4. 监听 `0.0.0.0:$PORT`。
5. `/api/health` 返回成功后进入可用状态。

## 安全边界

所有写操作和受保护读取都在后端通过 JWT 角色校验。店长请求会绑定自己的 `store_id`，不能通过前端参数读取其他门店。数据库凭据和 JWT secret 只从运行时环境读取，不进入前端文件。

## 发布检查

```bash
node --check server.js
node --check scripts/migrate.js
npm run migrate
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/manus-routes.json
```

发布时以 Manus Space 的 checkpoint 和 Publish 结果为准。Preview 可访问不代表正式发布已经完成；只有 Dashboard 或 publish 返回永久 URL 后，才可对外发送正式访问地址。
