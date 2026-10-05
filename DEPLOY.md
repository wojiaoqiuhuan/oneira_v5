# ONEIRA V5.2 GitHub + Railway 发布清单

1. GitHub 新建空仓库。
2. 上传本目录全部文件到仓库根目录。
3. Railway → New Project → Deploy from GitHub Repo。
4. 添加 PostgreSQL。
5. 将 PostgreSQL 的 DATABASE_URL 提供给 Web Service。
6. Web Service Variables 增加 JWT_SECRET、NODE_ENV=production。
7. Deploy。
8. 打开 Railway 提供的公网域名。
9. 测试 `/api/health`。
10. 用演示账号登录，确认日报、目标、反馈和管理员功能。
11. 修改默认管理员/运营密码。
12. 正式绑定自定义域名。
