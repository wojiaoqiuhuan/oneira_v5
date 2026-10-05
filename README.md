# ONEIRA 梦面包｜连锁烘焙运营工作台

ONEIRA V5.2 是部署在 Manus Space 的生产版连锁烘焙运营 Web App。系统手机优先，支持店长、运营、管理员三种角色；数据使用 Manus Space 托管的 MySQL 兼容数据库，不使用 Supabase、Render、Railway，也不把浏览器 `localStorage` 当作业务数据库。

## 最新更新

详见 [CHANGELOG.md](./CHANGELOG.md)。最新版本已包含：

- 门店汇总明细直接显示日报提交日期、提交时间和提交人。
- 日报必填字段增加前端提示与后端数据库级兜底，缺少必填项时禁止提交。
- 管理员可配置排行榜指标、指标名称、单位和统计方式（合计/平均）。
- 排行支持营业额、实收金额、订单量、试吃金额、报损金额、试吃占比、报损占比、会员新增、实体卡余量等日报数据。
- 新增 AI 经营分析，可按角色权限范围分析数据、复制结论和导出 CSV。
- 管理员可配置兼容 OpenAI Chat Completions 的 AI Endpoint、模型、API Key 和启用状态。
- 店长也可以查看自己门店权限范围内的经营分析和导出数据。

## 已实现能力

- **店长**：只能查看自己的门店，填写今日日报，查看历史日报、目标月历、反馈、周月复盘和本店经营分析。
- **运营**：查看全部门店、日报状态、目标完成情况、反馈、周月复盘、经营分析、排行和 CSV 导出。
- **管理员**：管理门店、店长员工、运营/管理员账号口令、日报模板、日报记录、排行榜、AI 配置和审计日志。
- **日报**：动态字段、必填规则、一店一天一份、重复提交覆盖、提交人记录、提交时间记录和版本号。
- **自动计算**：实收金额、平台收入、试吃占比、报损占比和目标完成率自动计算。
- **目标**：月目标支持按天平均、周末权重、自定义每日目标，并自动回填日报实际营业额。
- **反馈中心**：店长、运营、管理员均可新增、查看、编辑、删除；运营和管理员可更新处理状态及备注。
- **排行与分析**：管理员可维护排行指标；各角色只看到自己权限范围内的数据。
- **AI 分析**：使用兼容 OpenAI Chat Completions 的接口，对当前角色可访问日报进行趋势、异常、门店差异和行动建议分析。
- **权限**：后端 API 强制校验角色和门店范围，不依赖前端隐藏按钮。
- **同步**：Socket.IO 发送数据变更通知，所有业务数据来自同一个数据库。
- **发布**：Docker 生产入口，监听 `PORT`，健康检查 `/api/health`。

## 默认登录信息

首次启动会幂等初始化以下账号和门店：

| 角色 | 账号/门店 | 密码或口令 |
|---|---|---|
| 店长 | 门店：咸阳店；姓名：李店长 | `BAKE2024` |
| 运营 | `运营` | `oneira2026` |
| 管理员 | `管理员` | `oneira2026` |

上线后请立即在 **系统管理 → 运营与管理员账号** 修改默认管理员和运营口令，并在 **门店与店长** 中维护门店口令。

## AI 配置

管理员进入 **系统管理 → AI 分析配置**：

1. 填写兼容 OpenAI Chat Completions 的 Endpoint，例如 `https://api.example.com/v1`。
2. 填写模型名称，例如 `gpt-4o-mini` 或供应商提供的兼容模型名。
3. 填写 API Key；已配置的 Key 可留空保持不变。
4. 勾选 **启用 AI 分析** 并保存。
5. 运营分析页或店长本店分析页点击 **AI 分析**。

系统只把当前角色权限范围内的日报发送给 AI。API Key 只在服务端使用，不返回到浏览器页面。请使用具备数据保护能力的供应商，并根据企业合规要求决定是否启用。

### 推荐供应商预设

管理员可以在配置弹窗中直接选择：

| 供应商 | Endpoint | 模型填写 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` 或控制台可用模型 |
| 豆包 / 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 方舟控制台中的模型 ID |

两者均使用 OpenAI 兼容 Chat Completions 格式。需要先在对应供应商控制台申请 API Key 并开通模型。

## Manus Space 发布方式

本项目按 Manus Space 托管方式配置：`server=true`、`database=true`。数据库连接由运行时 `DATABASE_URL` 注入，服务由根目录 `Dockerfile` 启动，健康检查为 `/api/health`。

启动时会执行幂等迁移并通过 `schema_migrations` 记录：

- `001_initial`：基础门店、用户、日报、目标、反馈和审计表。
- `002_reviews_annotations`：周月复盘和日历标注。
- `003_ranking_ai`：排行指标和 AI 配置。

开发 Preview 和正式发布使用同一个项目数据库，请不要在生产数据上反复执行破坏性 DDL。

### 在 Manus Space 中发布

1. 打开当前项目的 Manus Space Dashboard。
2. 确认项目已启用 Server 和 Database。
3. 等待 Preview 显示 ONEIRA 登录页，并访问 `/api/health` 确认返回 `ok: true`。
4. 点击 **Publish** 发布当前 checkpoint。
5. 使用默认账号完成登录、日报必填拦截、目标、反馈、排行和 AI 配置测试。

不需要安装 Node，不需要配置 Supabase，也不需要购买 Render 或 Railway。

## 本地检查

```bash
npm ci
npm run migrate
npm start
```

需要设置 `DATABASE_URL` 和可选的 `JWT_SECRET`。生产环境不要使用默认 JWT secret。

## 目录

- `server.js`：Express API、认证、角色权限、迁移和数据联动。
- `db/migrations/001_initial.sql`：MySQL 基础迁移。
- `db/migrations/002_reviews_annotations.sql`：复盘与日历标注迁移。
- `db/migrations/003_ranking_ai.sql`：排行指标与 AI 配置迁移。
- `scripts/migrate.js`：幂等迁移和初始化种子。
- `public/index.html`：手机优先的紫罗兰新拟物工作台界面。
- `public/manus-routes.json`：Manus Space 页面路由清单。
- `Dockerfile`：生产容器入口。
- `MAINTENANCE.md`：日常维护、发布和故障排查说明。

## 营业日报模板与自动计算

店长端支持把门店营业日报整段粘贴导入，也支持复制当前模板。系统自动计算：

- 实收金额 = 总营业额 − 优惠/折扣券合计。
- 平台收入 = 美团团购 + 美团外卖 + 抖音团购 + 淘宝闪购。
- 试吃占比 = 试吃金额 ÷（试吃金额 + 报损金额 + 总营业额）。
- 报损占比 = 报损金额 ÷（试吃金额 + 报损金额 + 总营业额）。

目标日历按天显示目标、营业额、完成率和标注；运营/管理员可按门店筛选。
