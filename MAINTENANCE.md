# ONEIRA 生产维护手册

## 1. 日常检查

生产环境优先检查健康接口：

```bash
curl -sS https://oneira-4v8y8pei.manus.space/api/health
```

正常响应应包含 `"ok":true`。如果页面无法打开，先检查 Manus Space Preview/Publish 状态，再检查服务日志和数据库连接，不要直接删除或重建数据库。

## 2. 发布流程

代码合并到 `main` 后，确认 Manus Space 已记录新的 checkpoint，再从 Manus Space Dashboard 执行 Publish。发布前至少确认：

| 检查项 | 说明 |
|---|---|
| 服务 | `/api/health` 返回 200 和 `ok:true` |
| 登录 | 店长、运营、管理员均能登录 |
| 日报 | 必填项拦截、粘贴导入、自动计算正常 |
| 分析 | 汇总明细显示日期、时间、门店和提交人 |
| 排行 | 管理员修改配置后分析页选择器同步 |
| 导出 | CSV 返回 200 且包含表头 |
| AI | 已配置时可生成分析；未配置时给出清晰提示 |
| 数据库 | 新迁移已写入 `schema_migrations` |

## 3. 数据库迁移

当前迁移顺序如下：

```text
001_initial
002_reviews_annotations
003_ranking_ai
```

迁移是幂等的。需要手动执行时使用：

```bash
npm run migrate
```

不要重复执行原始 SQL，也不要在生产环境手动删除 `schema_migrations`。如果迁移失败，保留错误日志，先确认数据库连接和当前迁移状态。

## 4. AI 配置维护

管理员在系统管理中维护 AI 配置。Endpoint 应填写兼容 Chat Completions 的服务根地址，例如：

```text
https://api.example.com/v1
```

模型名称由供应商决定。API Key 不会显示回前端；如果只修改 Endpoint、模型或启用状态，可以让 API Key 留空以保持原值。更换 Key 时重新填写并保存。

AI 分析只接收当前登录角色有权限访问的日报数据。不要在提示词中粘贴银行卡、个人身份证号、客户联系方式等非经营必要信息。

## 5. 权限与数据范围

店长只能访问自己的门店；运营可以访问全部门店经营数据；管理员可以管理系统配置、日报、排行、AI 配置和审计日志。后端接口会再次校验角色和门店范围，不能只依赖前端按钮隐藏。

## 6. 常见问题

### 页面显示空白

先打开浏览器控制台检查脚本错误，再访问 `/api/health`。如果健康接口正常，通常是前端资源或运行时脚本错误；如果健康接口失败，检查服务进程和发布版本。

### 日报仍然可以空提交

确认管理员在日报模板中勾选了必填字段，并确认最新 checkpoint 已发布。后端会读取 `report_fields.required`，返回缺少字段名称；如果接口没有返回该提示，说明当前服务不是最新版本。

### CSV 返回 401

CSV 下载使用短期登录 Token 参数。重新登录后从分析页再次点击导出，不要手工复用旧链接。

### AI 返回未配置

检查 AI Endpoint、模型、API Key 和启用开关。Endpoint 必须使用 `http://` 或 `https://`，并且供应商需要支持 `/chat/completions`。

### 排行没有数据

确认日期范围内已经提交日报，并确认对应排行指标已启用。金额指标使用合计，占比和库存类指标通常使用平均。

## 7. 备份建议

业务数据全部保存在 Manus Space 托管 MySQL 中。生产维护时应定期导出日报 CSV，并保留 GitHub `main` 分支和 Manus Space checkpoint。不要把 `.env`、真实 API Key 或数据库连接字符串提交到 GitHub。
