# ONEIRA 烘焙连锁工作台 V5.2

GitHub + Railway 可部署生产基础版。技术栈：Node.js 20、Express 5、PostgreSQL、Socket.IO。

## 最快上线方式

### 1. 上传 GitHub

在 GitHub 新建一个空仓库，例如 `oneira-workbench`，把本项目根目录的全部文件上传进去。

不要再套一层文件夹；`package.json`、`Dockerfile`、`server.js` 应该直接位于仓库根目录。

### 2. Railway 连接 GitHub

在 Railway 新建 Project → Deploy from GitHub Repo → 选择刚才的仓库。

Railway 会识别根目录的 `Dockerfile` / `railway.toml` 并构建。

### 3. 创建 PostgreSQL

在同一个 Railway Project 中新增 PostgreSQL 服务，并将 PostgreSQL 的 `DATABASE_URL` 注入 Web 服务。

Railway 通常可以直接使用 PostgreSQL 服务提供的 `DATABASE_URL` 变量；如果界面要求选择引用变量，选择 PostgreSQL 服务的 `DATABASE_URL` 即可。

### 4. 设置 JWT_SECRET

在 Web Service → Variables 添加：

```text
JWT_SECRET=<随机长字符串>
NODE_ENV=production
```

`PORT` 不需要手动设置，Railway 会提供；应用会自动读取 `process.env.PORT`。

### 5. 发布

点击 Deploy。健康检查地址：

```text
/api/health
```

看到：

```json
{"ok":true,"version":"5.2.0","service":"oneira-workbench"}
```

即表示服务已正常启动并连接数据库。

## 默认演示账号

店长：
- 门店：咸阳店
- 姓名：李店长
- 口令：BAKE2024

运营：
- 姓名：运营
- 密码：oneira2026

管理员：
- 姓名：管理员
- 密码：oneira2026

正式上线后请立即修改管理员/运营密码和 JWT_SECRET。

## 数据初始化

应用第一次连接数据库时会自动执行 `schema.sql`，创建表并写入演示数据；已有数据不会重复初始化。

## GitHub 更新自动发布

以后修改代码并 push 到 GitHub：

```bash
git add .
git commit -m "update"
git push
```

Railway 会根据项目设置自动重新部署。

## 重要安全说明

- 正式环境只使用 HTTPS。
- 不要把 `.env` 提交到 GitHub。
- `JWT_SECRET` 必须使用随机长字符串。
- 正式上线后修改演示账号密码。
- 生产环境建议将 CORS 限制为正式域名。
- 删除/归档等关键操作应在正式运营前进行完整测试。

## 核心数据链路

日报 → KPI → 每日任务实际完成 → 月历完成率

问题反馈 → 运营处理 → 店长可见

管理员日报模板 → 店长日报表单

门店口令 / 员工姓名 → 登录与操作追溯
