# ONEIRA 梦面包｜连锁烘焙运营工作台

> 面向连锁烘焙门店的手机优先运营工作台：日报、目标、报货、经营分析、反馈和审计在同一条数据链路内闭环。

- **正式地址**：<https://oneira-4v8y8pei.manus.space>
- **GitHub**：<https://github.com/wojiaoqiuhuan/oneira_v5>
- **运行方式**：Manus Space Server + Managed MySQL
- **当前版本**：V5.2.0（持续增量更新）

## 项目定位

ONEIRA 不是传统 ERP 后台，而是面向手机端工作的轻量化经营控制室。店长负责填报与报货，运营负责看经营状态和目标完成情况，管理员负责配置系统规则；所有角色通过同一套后端权限、数据库事务和实时同步保持数据一致。

视觉采用紫罗兰新拟物方向，结合 Apple / Linear / Vercel Dashboard 的克制信息层级：卡片化 KPI、毛玻璃、细边框、微渐变、底部导航和移动端优先交互。

## 核心功能

### 角色与权限

| 角色 | 权限范围 |
|---|---|
| 店长 | 仅查看自己的门店；填写、补交、编辑、删除、复制历史日报；查看目标日历、报货、反馈、周复盘/月总结和本店分析 |
| 运营 | 查看权限范围内全部门店；查看日报提交状态、目标完成度、经营排行、趋势、反馈、周复盘/月总结和 CSV 导出 |
| 管理员 | 管理门店、店长、运营/管理员账号、日报模板、日报记录、排行指标、AI 配置、审计日志和门店产品模板 |

后端 API 强制执行 JWT、角色和门店范围校验，前端隐藏按钮不作为安全边界。

### 营业日报

- 支持按日期填报、历史补交、编辑、删除、复制历史日报。
- 支持整段文字粘贴导入，也支持复制标准模板。
- 管理员可动态新增、编辑、隐藏字段，设置单位、数字/文字类型和必填规则。
- 每个门店每天一份日报；重复提交会覆盖同日记录，并保留提交人、提交时间和版本信息。
- 近期日报默认显示最近 7 条摘要；历史日报按 15 条分页；手机端自动卡片化，完整内容通过详情弹窗查看。

### 自动计算与目标

所有月目标、日目标和完成率使用 **实收金额** 作为核心指标：

- 实收金额 = 总营业额 − 优惠/折扣券合计
- 平台收入 = 美团团购 + 美团外卖 + 抖音团购 + 淘宝闪购
- 试吃占比 = 试吃金额 ÷（试吃金额 + 报损金额 + 总营业额）
- 报损占比 = 报损金额 ÷（试吃金额 + 报损金额 + 总营业额）
- 完成率 = 实收金额 ÷ 当日目标金额

目标支持月目标、按天平均、周末权重和店长自定义每日拆分。日历支持点击查看当天营业额、实收、目标、完成率、报货金额、标注、评论和提醒。

### 报货管理

- 独立报货模块，店长可按日期或整周填写每个 SKU 数量。
- 按产品分类分组展示并汇总，显示报货金额与预估营业额比例。
- 支持跨月份选择日期、选择性复制历史报货、打印自选日期和 CSV/Excel 导入导出。
- 产品与价格按门店独立维护，支持门店模板复制/克隆；不会把一家店的品名、分类或价格强行覆盖到其他门店。
- 批量编辑支持分类筛选、搜索、一次性保存多项修改、停用产品和 Excel 差异预览。
- 历史报货支持查看、编辑、复制和删除，保留金额快照便于追溯。

### 经营分析、排行与 AI

- 按日期、门店和指标查看趋势与排行。
- 支持营业额、实收、订单量、试吃金额、报损金额、试吃占比、报损占比、会员新增等指标。
- 管理员可修改排行名称、单位和统计方式（合计/平均）。
- 门店汇总明细按门店折叠，展开后查看日期、提交时间、提交人、实收等明细。
- AI 分析支持 OpenAI Chat Completions 兼容接口，可配置 DeepSeek 或豆包/火山方舟；分析任务在后台运行，结果支持一键复制。
- API Key 只存储和使用于服务端，不返回浏览器；AI 只接收当前角色权限范围内的数据。

### 反馈、复盘与审计

- 店长、运营、管理员均可对反馈进行增删改查。
- 运营和管理员可更新反馈处理状态、处理备注和处理人。
- 店长和运营支持周复盘、月总结，日历支持特殊情况标注、评论和提醒。
- 审计日志记录操作者、时间、对象和动作；自动保留最近 5000 条，支持搜索、批量删除和按日期清理。

## 技术架构

- **Backend**：Node.js、Express 5、Socket.IO
- **Database**：Manus Space Managed MySQL，`mysql2`
- **Auth**：JWT + bcryptjs，支持 Header / 查询参数令牌
- **Frontend**：单页 Web App，原生 HTML/CSS/JavaScript，移动端优先
- **Import/Export**：`xlsx`，支持 Excel 批量导入、差异预览和导出
- **Deployment**：Docker，监听 `PORT`（默认 3000）
- **Health check**：`GET /api/health`
- **Route manifest**：`public/manus-routes.json`

项目不使用 Supabase、Render、Railway，也不把浏览器 `localStorage` 当作业务数据库。

## 项目结构

```text
oneira/
├── public/index.html              # 前端单页应用、样式和交互
├── public/manus-routes.json       # 页面路由清单
├── server.js                      # API、认证、权限、事务、Socket.IO
├── db/migrations/                 # 幂等数据库迁移
│   ├── 001_initial.sql
│   ├── 002_reviews_annotations.sql
│   ├── 003_ranking_ai.sql
│   ├── 004_ordering_system.sql
│   ├── 005_received_goals.sql
│   └── 006_audit_retention.sql
├── scripts/migrate.js             # 迁移与初始化种子
├── Dockerfile                     # 生产容器入口
├── DEPLOY.md                      # Manus Space 发布说明
├── MANUS.md                       # 运行维护与故障排查
└── CHANGELOG.md                   # 版本更新记录
```

## 本地运行

要求 Node.js 18+ 和一个 MySQL 兼容数据库：

```bash
npm ci
cp .env.example .env
# 编辑 .env，至少填写 DATABASE_URL 和随机 JWT_SECRET
npm run migrate
npm start
```

服务启动后访问 `http://localhost:3000`，健康检查：

```bash
curl http://localhost:3000/api/health
```

生产环境不要使用默认 JWT secret，也不要把真实数据库连接串、AI API Key 或账号密码提交到 GitHub。

## Manus Space 发布

项目已配置 `server=true`、`database=true`、Docker 运行入口和 `/api/health` 健康检查。发布步骤见 [DEPLOY.md](./DEPLOY.md)。正式地址为：

<https://oneira-4v8y8pei.manus.space>

Preview 与正式发布共用项目数据库，验收时产生的数据会保留。上线后请立即修改管理员、运营和门店口令。

## GitHub 同步

当前公开仓库：<https://github.com/wojiaoqiuhuan/oneira_v5>

Manus Space 的托管主仓库与 GitHub 镜像分开维护。更新流程为：

```bash
git fetch origin main
git push origin main                 # 保存 Manus Space checkpoint
# 将同一份 main 同步到 GitHub
git push github main
```

不要把 `.env`、数据库凭据、AI Key、运行日志或临时文件提交到仓库。

## 默认初始化数据

首次迁移会幂等创建演示门店、角色和日报字段。具体种子值以 `scripts/migrate.js` 当前代码为准；正式使用前请管理员登录 **系统管理** 修改所有初始口令并确认门店口令。

## 许可证与使用说明

本仓库用于 ONEIRA 梦面包项目的公开代码协作和部署记录。若用于其他门店或组织，请自行完成账号、数据、品牌素材、隐私与合规配置。
