# ONEIRA 梦面包｜连锁烘焙运营工作台

这是 ONEIRA V5.2 的 Manus Space 生产版。它是一个手机优先的连锁烘焙运营 Web App，支持店长、运营、管理员三种角色，数据使用 Manus Space 托管的 MySQL 兼容数据库，不使用 Supabase、Render、Railway 或浏览器 localStorage 作为数据库。

## 已实现能力

- 店长：只能查看自己的门店，直接填写今日日报、查看历史日报、目标月历和问题处理结果。
- 运营：查看全部门店、日报状态、目标完成情况、问题反馈和 CSV 导出。
- 管理员：管理门店、店长员工、日报模板和操作日志。
- 日报：动态字段、必填校验、一店一天一份、重复提交覆盖并保留版本号。
- 目标：月目标支持按天平均、周末权重、自定义每日目标，并自动回填日报实际营业额和完成率。
- 问题反馈：提交、处理、处理结果和审计记录完整关联。
- 权限：后端 API 强制校验角色和门店范围，不依赖前端隐藏按钮。
- 同步：同一服务内提供 Socket.IO 变更通知，所有数据来自同一个数据库。
- 发布：Docker 生产入口，监听 `PORT`，健康检查 `/api/health`。

## 默认登录信息

首次启动会幂等初始化：

| 角色 | 账号/门店 | 密码或口令 |
|---|---|---|
| 店长 | 门店：咸阳店；姓名：李店长 | `BAKE2024` |
| 运营 | `运营` | `oneira2026` |
| 管理员 | `管理员` | `oneira2026` |

上线后请立即修改默认管理员和运营密码；当前管理页面支持员工与门店管理，生产环境建议后续增加独立密码修改页。

## Manus Space 发布方式

本项目已经按 Manus Space 的托管方式配置：`server=true`、`database=true`，数据库连接由运行时的 `DATABASE_URL` 注入，服务由根目录 `Dockerfile` 启动，健康检查为 `/api/health`。

平台启动时会执行 `db/migrations/001_initial.sql`，并通过 `schema_migrations` 记录完成状态；随后只补充缺失的初始化数据，不覆盖已有业务数据。开发 Preview 和正式发布使用同一个项目数据库，因此不要在生产数据上反复做破坏性 DDL。

### 在 Manus Space 中发布

1. 打开当前项目的 Manus Space Dashboard。
2. 确认项目已启用 Server 和 Database。
3. 等待 Preview 显示 ONEIRA 登录页，并访问 `/api/health` 确认返回 `ok: true`。
4. 点击 **Publish** 发布当前 checkpoint。
5. 使用上面的默认账号完成登录、日报、目标、反馈和管理员模板同步测试。

不需要安装 Node，不需要配置 Supabase，也不需要购买 Render 或 Railway。

## 本地检查

```bash
npm ci
npm run migrate
npm start
```

需要设置 `DATABASE_URL` 和可选的 `JWT_SECRET`。生产环境不要使用默认 JWT secret。

## 目录

- `server.js`：Express API、认证、角色权限和数据联动。
- `db/migrations/001_initial.sql`：MySQL 兼容初始迁移。
- `scripts/migrate.js`：幂等迁移和初始化种子。
- `public/index.html`：手机优先的工作台界面。
- `public/manus-routes.json`：Manus Space 页面路由清单。
- `Dockerfile`：生产容器入口。

## 营业日报模板与自动计算

店长端支持把门店营业日报整段粘贴导入，也支持复制当前模板。系统自动计算：实收金额=总营业额-优惠/折扣券合计；平台收入=美团团购+美团外卖+抖音团购+淘宝闪购；试吃占比和报损占比=对应金额/(试吃金额+报损金额+总营业额)。目标日历按天显示营业额与实收金额，运营/管理员可按门店筛选。
