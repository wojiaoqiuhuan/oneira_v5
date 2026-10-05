# Manus 一键部署说明

这是 ONEIRA 烘焙连锁工作台 V5.1 可部署项目，已整理为标准 Node.js + PostgreSQL + Socket.IO 服务。

## Manus 部署

1. 将整个项目导入 Manus。
2. 选择 Node.js / Docker 项目均可；优先使用 Dockerfile。
3. 配置 PostgreSQL 数据库，并注入 `DATABASE_URL`。
4. 注入 `JWT_SECRET`（随机长字符串）。
5. `NODE_ENV=production`。
6. 启动命令：`npm start`（Docker 模式无需额外配置）。
7. 健康检查：`GET /api/health`。
8. 部署后直接访问 Manus 提供的公网域名。

## 数据库

服务首次启动会自动执行 `schema.sql` 并创建演示数据。生产环境建议先用测试数据库验证，再切换正式数据库。

## 默认演示账号

- 店长：咸阳店 / 李店长 / BAKE2024
- 运营：运营 / oneira2026
- 管理员：管理员 / oneira2026

上线后立即修改管理员密码、门店口令和 JWT_SECRET。

## 关键运行参数

- Node.js 20+
- HTTP 端口：`PORT`，平台会自动注入
- PostgreSQL：`DATABASE_URL`
- JWT：`JWT_SECRET`
- WebSocket：与同一 HTTP 服务共用，不需要单独端口

## 部署检查

打开 `/api/health`，返回 `ok: true` 即表示应用和数据库连接正常。
