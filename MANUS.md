# ONEIRA｜Manus Space 运行维护手册

## 服务启动顺序

1. 读取运行时环境变量 `DATABASE_URL`、`JWT_SECRET` 和 `PORT`。
2. 建立 `schema_migrations` 表。
3. 按顺序执行 `db/migrations/*.sql` 中尚未执行的迁移。
4. 幂等初始化门店、账号、日报字段、目标和报货基础数据。
5. 监听 `0.0.0.0:$PORT`。
6. `/api/health` 返回 2xx 后，平台将服务视为可用。

## 数据与一致性

- 所有业务数据以 Managed MySQL 为准，不使用 `localStorage` 持久化业务数据。
- 报表、月目标、日报、报货和关键管理写入使用数据库事务。
- API 返回 `Cache-Control: no-store`，避免移动端看到旧数据。
- Socket.IO 发送数据变更通知；收到通知后前端重新拉取数据库数据。
- 每家门店的产品、分类、SKU 和价格独立维护，门店克隆是显式操作。
- 目标完成率和月度进度统一基于实收金额，不使用毛营业额。

## 安全边界

- 所有受保护读取和写操作由后端 JWT、角色和门店范围校验。
- 店长请求会绑定自己的 `store_id`，不能通过修改前端参数访问其他门店。
- 密码使用 bcrypt；数据库凭据、JWT secret、AI API Key 只从运行时环境或服务端配置读取。
- 公开 GitHub 仓库不得提交 `.env`、生产数据库连接串、API Key、JWT secret 或运行日志。
- 首次部署后立即修改初始化账号和门店口令。

## 数据库迁移

当前迁移：

| 文件 | 内容 |
|---|---|
| `001_initial.sql` | 门店、用户、日报、目标、反馈和审计基础表 |
| `002_reviews_annotations.sql` | 周/月复盘和日历标注 |
| `003_ranking_ai.sql` | 排行指标和 AI 配置 |
| `004_ordering_system.sql` | 报货分类、SKU、门店模板、日报货记录 |
| `005_received_goals.sql` | 将目标完成逻辑切换为实收金额 |
| `006_audit_retention.sql` | 审计日志索引和 5000 条保留策略 |

执行迁移：

```bash
npm run migrate
```

迁移必须幂等。生产环境不要手工删除迁移记录或直接执行破坏性 DDL。

## 运行检查

```bash
node --check server.js
node --check scripts/migrate.js
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/manus-routes.json
```

Git 提交前：

```bash
git diff --check
git status --short --branch
git log -3 --oneline
```

## 故障排查

### 页面空白

检查健康接口、数据库连接、迁移日志、监听地址和路由清单。Cloud Preview 通过代理嵌入，不要配置 `X-Frame-Options: DENY/SAMEORIGIN` 或 `frame-ancestors 'none'/'self'`。

### API 请求失败

检查浏览器 Network 中的 HTTP 状态码和响应消息。401/403 优先检查 token、角色和门店范围；400 检查必填字段；500 检查服务日志和数据库事务回滚。

### 报货保存失败

确认当前门店有独立产品模板，SKU 未被删除或停用，日期格式有效；批量保存和 Excel 导入必须只写入当前门店可见产品。

### 弹窗或列表滚动异常

长内容弹窗必须只有一个主滚动轨道，内容区域需要 `min-height: 0` 和明确高度链；移动端日报列表使用分页/卡片，不应把全部历史记录一次性铺开。

## 发布原则

Manus Space checkpoint 和正式 Publish 结果是生产版本依据。GitHub 是公开代码镜像与协作仓库。发布后应同时核对：

- Manus Space 正式地址可访问。
- `/api/health` 返回成功。
- GitHub `main` 包含同一份源代码提交。
- 管理员、运营、店长三个角色各完成最小回归。
