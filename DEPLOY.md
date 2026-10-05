# ONEIRA V5.2｜Manus Space 发布清单

## 你需要做什么

本项目已经使用 Manus Space 的 Server + Database 配置。你不需要安装 Node、不需要建立 Supabase 项目，也不需要充值 Render/Railway。

### 第 1 步：打开项目

在 Manus 当前任务的项目预览或 Dashboard 中打开 **ONEIRA 梦面包｜连锁烘焙运营工作台**。

### 第 2 步：检查 Preview

等待登录页出现，然后访问：

```text
/api/health
```

如果看到类似下面的内容，说明服务已经启动：

```json
{"ok":true,"version":"5.2.0-manus-space","service":"oneira-workbench"}
```

### 第 3 步：发布

点击 Manus Space Dashboard 的 **Publish**。发布必须基于已经保存的 checkpoint；不要把 Preview 地址当成长期正式地址。

### 第 4 步：首次登录

店长：门店 `咸阳店`、姓名 `李店长`、口令 `BAKE2024`。

运营：账号 `运营`，密码 `oneira2026`。

管理员：账号 `管理员`，密码 `oneira2026`。

### 第 5 步：验收

按以下顺序点击测试：

1. 店长登录并提交今日日报；
2. 运营登录并查看日报；
3. 运营创建月目标；
4. 店长打开目标月历，确认每日目标和实际营业额；
5. 店长提交问题反馈；
6. 运营处理问题；
7. 店长确认看到处理结果；
8. 管理员修改日报字段；
9. 店长重新进入日报，确认字段已同步；
10. 运营或管理员导出 CSV。

## 技术配置

- 运行入口：`npm start`
- 端口：读取 `PORT`，默认 3000
- 数据库：读取 Manus Space 运行时 `DATABASE_URL`
- 健康检查：`/api/health`
- 迁移：`db/migrations/001_initial.sql`
- 初始化：`scripts/migrate.js` 和服务启动时的幂等种子逻辑
- 页面路由：`public/manus-routes.json`

## 重要提醒

Manus Space 的 Preview 和正式发布共用项目数据库。首次测试产生的数据会保留在项目数据库中。正式使用前请管理员修改默认密码，并确认门店名称、店长姓名和门店口令。
