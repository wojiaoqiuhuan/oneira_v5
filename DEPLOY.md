# ONEIRA｜Manus Space 部署与验收说明

## 1. 当前发布信息

- 正式地址：<https://oneira-4v8y8pei.manus.space>
- GitHub：<https://github.com/wojiaoqiuhuan/oneira_v5>
- 托管方式：Manus Space Server + Managed MySQL
- 健康检查：`GET /api/health`
- 容器默认端口：`3000`
- 当前项目不使用 Supabase、Render 或 Railway。

Manus Space 的托管主仓库负责 checkpoint 和正式发布，GitHub 仓库用于公开代码同步与协作。两者都应保持同一份 `main` 代码。

## 2. 发布前检查

```bash
npm ci
node --check server.js
node --check scripts/migrate.js
npm run migrate
npm start
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/manus-routes.json
```

预期健康检查返回 `ok: true`。正式环境需要由平台注入：

- `DATABASE_URL`：MySQL 兼容数据库连接串
- `JWT_SECRET`：随机长字符串
- `PORT`：平台端口，未提供时默认 3000

不要将 `.env`、真实数据库连接、AI API Key 或 JWT secret 提交到公开仓库。

## 3. Manus Space 发布流程

1. 打开 Manus Space 项目 Dashboard。
2. 确认 Server 和 Database 已启用。
3. 等待 Preview 登录页加载完成。
4. 访问 `/api/health` 确认后端已就绪。
5. 确认当前 checkpoint 包含待发布代码。
6. 点击 **Publish**，等待正式地址返回 2xx。
7. 使用管理员、运营、店长角色分别完成最小回归。

Preview 和正式发布共用项目数据库。不要在生产数据上反复执行破坏性 DDL；迁移由 `scripts/migrate.js` 和服务启动流程幂等执行，并由 `schema_migrations` 记录。

## 4. 功能验收顺序

### 店长

1. 选择门店并登录。
2. 进入日报，选择今天或历史日期。
3. 通过手工填写或粘贴模板提交日报。
4. 确认实收、平台收入、试吃占比和报损占比自动计算。
5. 查看近期日报、历史日报分页、详情弹窗和复制入口。
6. 进入目标日历查看每日目标、实收和完成率。
7. 进入报货，按分类填写 SKU 数量，保存并查看金额比例。
8. 选择历史日期复制报货，确认可以调整后再保存。
9. 提交反馈、查看处理状态和备注。

### 运营

1. 登录后查看全部门店经营分析。
2. 按门店、日期和指标查看趋势与排行。
3. 创建月度实收目标并设置每日拆分。
4. 查看门店汇总明细，确认按门店折叠和按日期展开。
5. 处理反馈、填写周复盘/月总结并导出 CSV。
6. 确认日报提交人、提交时间和实收金额准确显示。

### 管理员

1. 管理门店、店长、运营和管理员口令。
2. 编辑日报模板、设置字段类型和必填项并下发。
3. 查看、编辑、覆盖、删除全部门店日报。
4. 管理每个门店独立的报货分类、SKU、价格和停用状态。
5. 使用批量编辑、分类筛选、产品搜索和 Excel 导入/导出。
6. 配置排行指标、AI Endpoint/模型/API Key 和启用状态。
7. 查看、筛选和清理审计日志。

## 5. GitHub 同步

当前公开仓库为：<https://github.com/wojiaoqiuhuan/oneira_v5>

普通代码同步使用独立的 `github` remote，不替换 Manus Space 的托管 `origin`：

```bash
git fetch origin main
git push origin main
git push github main
```

推送前检查：

```bash
git status --short --branch
git diff --check
git log -3 --oneline
```

不要使用 `--force`，不要提交 `.env`、临时日志、数据库导出或密钥。

## 6. 常见问题

### 页面空白或一直显示连接中

1. 检查 `/api/health` 是否 2xx。
2. 检查运行时 `DATABASE_URL` 是否存在且可连接。
3. 检查 `PORT` 与 Docker/平台监听端口是否一致。
4. 查看服务日志中的迁移和初始化错误。
5. 确认 `public/manus-routes.json` 是合法 JSON。

### 登录慢或保存没有反馈

前端所有关键写入都使用事务、`Cache-Control: no-store` 和按钮 busy 状态。若仍然缓慢，优先检查数据库连接池、网络延迟和平台冷启动，不要通过浏览器缓存业务数据绕过问题。

### 数据显示不一致

确认所有角色使用同一 Manus Space 项目和数据库；检查服务是否完成最新迁移，并刷新页面重新拉取数据。Socket.IO 只负责通知，最终数据以数据库查询结果为准。
