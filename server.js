import express from 'express';
import http from 'http';
import cors from 'cors';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = mysql.createPool({ uri: DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionLimit: 8, dateStrings: true });
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true, credentials: true } });
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const q = async (sql, params = []) => (await pool.query(sql, params))[0];
const execSql = async (sql, params = []) => (await pool.execute(sql, params))[0];
const secret = () => process.env.JWT_SECRET || process.env.MANUS_JWT_SECRET || 'oneira-dev-secret-change-me';
const sign = user => jwt.sign({ id: user.id, role: user.role, storeId: user.store_id || null, name: user.name }, secret(), { expiresIn: '7d' });
const tokenFrom = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
const auth = (roles = []) => (req, res, next) => {
  try {
    req.user = jwt.verify(tokenFrom(req), secret());
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: '无权限' });
    next();
  } catch { res.status(401).json({ error: '登录已失效' }); }
};
const json = value => (value == null ? {} : typeof value === 'string' ? JSON.parse(value) : value);
async function log(req, action, entity, entityId, detail = {}) {
  await execSql('INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)', [req.user?.id || null, action, entity, String(entityId ?? ''), JSON.stringify(detail)]);
}
function changed() { io.emit('data:changed', { at: new Date().toISOString() }); }

async function migrateAndSeed() {
  await execSql('CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const [[done]] = await pool.query('SELECT id FROM schema_migrations WHERE id=?', ['001_initial']);
  if (!done) {
    const sql = await (await import('fs/promises')).readFile(path.join(__dirname, 'db/migrations/001_initial.sql'), 'utf8');
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) {
      if (!statement.toLowerCase().startsWith('create table if not exists schema_migrations')) await execSql(statement);
    }
    await execSql('INSERT INTO schema_migrations(id) VALUES(?)', ['001_initial']);
  }
  const stores = await q('SELECT id FROM stores WHERE name=? LIMIT 1', ['咸阳店']);
  let storeId = stores[0]?.id;
  if (!storeId) storeId = (await execSql('INSERT INTO stores(name,address,login_code,manager_name) VALUES(?,?,?,?)', ['咸阳店', '咸阳市', 'BAKE2024', '李店长'])).insertId;
  if (!(await q("SELECT id FROM users WHERE name=? AND role='store' LIMIT 1", ['李店长'])).length) await execSql("INSERT INTO users(name,store_id,role) VALUES(?,?, 'store')", ['李店长', storeId]);
  const hash = await bcrypt.hash('oneira2026', 10);
  if (!(await q("SELECT id FROM users WHERE name='运营' AND role='ops' LIMIT 1")).length) await execSql("INSERT INTO users(name,role,password_hash) VALUES('运营','ops',?)", [hash]);
  if (!(await q("SELECT id FROM users WHERE name='管理员' AND role='admin' LIMIT 1")).length) await execSql("INSERT INTO users(name,role,password_hash) VALUES('管理员','admin',?)", [hash]);
  if (!Number((await q('SELECT COUNT(*) AS count FROM report_fields'))[0].count)) await execSql("INSERT INTO report_fields(label,`key`,field_type,unit,required,sort_order) VALUES ('营业额','revenue','number','元',1,1),('客单量','orders','number','单',1,2),('损耗率','wasteRate','number','%',1,3),('会员新增','members','number','人',0,4)");
}

app.get('/api/health', async (_req, res) => { try { await q('SELECT 1 AS ok'); res.json({ ok: true, version: '5.2.0-manus-space', service: 'oneira-workbench' }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/sync/version', (_req, res) => res.json({ at: new Date().toISOString() }));
app.post('/api/auth/store-login', async (req, res) => { const { storeName, name, code } = req.body; const rows = await q("SELECT u.*,s.name AS store_name FROM users u JOIN stores s ON s.id=u.store_id WHERE s.name=? AND u.name=? AND s.login_code=? AND u.role='store' AND s.status='active'", [storeName, name, code]); if (!rows.length) return res.status(401).json({ error: '门店、姓名或口令错误' }); const token = sign(rows[0]); res.json({ token, user: { id: rows[0].id, name: rows[0].name, role: 'store', storeId: rows[0].store_id, storeName: rows[0].store_name } }); });
app.post('/api/auth/staff-login', async (req, res) => { const { name, password, role } = req.body; const rows = await q('SELECT * FROM users WHERE name=? AND role=?', [name, role]); if (!rows.length || !(await bcrypt.compare(password || '', rows[0].password_hash || ''))) return res.status(401).json({ error: '账号或密码错误' }); const token = sign(rows[0]); res.json({ token, user: { id: rows[0].id, name: rows[0].name, role: rows[0].role } }); });
app.get('/api/me', auth(), (req, res) => res.json({ user: req.user }));

app.get('/api/stores', auth(['ops', 'admin']), async (_req, res) => res.json(await q('SELECT id,name,address,manager_name,status,created_at FROM stores ORDER BY id')));
app.post('/api/stores', auth(['admin']), async (req, res) => { const { name, address = '', managerName = '', code } = req.body; if (!name || !code) return res.status(400).json({ error: '门店名称和口令必填' }); const r = await execSql('INSERT INTO stores(name,address,manager_name,login_code) VALUES(?,?,?,?)', [name, address, managerName, code]); if (managerName) await execSql("INSERT INTO users(name,store_id,role) VALUES(?,?, 'store')", [managerName, r.insertId]); await log(req, 'create', 'stores', r.insertId, { name }); changed(); res.json({ id: r.insertId, name, address, manager_name: managerName, status: 'active' }); });
app.patch('/api/stores/:id', auth(['admin']), async (req, res) => { const { name, address, managerName, code, status } = req.body; await execSql('UPDATE stores SET name=COALESCE(?,name),address=COALESCE(?,address),manager_name=COALESCE(?,manager_name),login_code=COALESCE(?,login_code),status=COALESCE(?,status) WHERE id=?', [name, address, managerName, code, status, req.params.id]); if (managerName) await execSql("UPDATE users SET name=? WHERE store_id=? AND role='store'", [managerName, req.params.id]); await log(req, 'update', 'stores', req.params.id, { changed: req.body }); changed(); res.json((await q('SELECT * FROM stores WHERE id=?', [req.params.id]))[0]); });
app.delete('/api/stores/:id', auth(['admin']), async (req, res) => { if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: '需要二次确认' }); await execSql("UPDATE stores SET status='archived' WHERE id=?", [req.params.id]); await log(req, 'archive', 'stores', req.params.id); changed(); res.json({ ok: true }); });
app.get('/api/users', auth(['admin']), async (_req, res) => res.json(await q("SELECT u.id,u.name,u.store_id,u.role,s.name AS store_name,u.created_at FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='store' ORDER BY s.id,u.id")));
app.post('/api/users', auth(['admin']), async (req, res) => { const { name, storeId } = req.body; if (!name || !storeId) return res.status(400).json({ error: '姓名和门店必填' }); const r = await execSql("INSERT INTO users(name,store_id,role) VALUES(?,?, 'store')", [name, storeId]); await log(req, 'create', 'users', r.insertId, { name, storeId }); changed(); res.json({ id: r.insertId, name, store_id: storeId, role: 'store' }); });
app.delete('/api/users/:id', auth(['admin']), async (req, res) => { if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: '需要二次确认' }); await execSql("DELETE FROM users WHERE id=? AND role='store'", [req.params.id]); await log(req, 'delete', 'users', req.params.id); changed(); res.json({ ok: true }); });
app.get('/api/report-fields', auth(), async (_req, res) => res.json(await q('SELECT * FROM report_fields WHERE enabled=1 ORDER BY sort_order,id')));
app.put('/api/report-fields', auth(['admin']), async (req, res) => { const fields = req.body.fields || []; const keys = new Set(); for (const f of fields) { if (!f.label || !f.key || keys.has(f.key)) return res.status(400).json({ error: '日报字段名称或唯一键重复' }); keys.add(f.key); } await execSql('UPDATE report_fields SET enabled=0'); for (let i = 0; i < fields.length; i++) { const f = fields[i]; await execSql('INSERT INTO report_fields(label,`key`,field_type,unit,required,sort_order,enabled) VALUES(?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE label=VALUES(label),field_type=VALUES(field_type),unit=VALUES(unit),required=VALUES(required),sort_order=VALUES(sort_order),enabled=1', [f.label, f.key, f.field_type || 'number', f.unit || '', !!f.required, i + 1]); } await log(req, 'update', 'report_fields', 'all', { count: fields.length }); changed(); res.json({ ok: true }); });

app.get('/api/reports', auth(), async (req, res) => { const conditions = []; const params = []; if (req.user.role === 'store') { conditions.push('r.store_id=?'); params.push(req.user.storeId); } else if (req.query.storeId) { conditions.push('r.store_id=?'); params.push(req.query.storeId); } if (req.query.month) { conditions.push("DATE_FORMAT(r.report_date,'%Y-%m')=?"); params.push(req.query.month); } const rows = await q(`SELECT r.*,s.name AS store_name,u.name AS submitter_name FROM daily_reports r JOIN stores s ON s.id=r.store_id LEFT JOIN users u ON u.id=r.submitted_by ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY r.report_date DESC,r.id DESC LIMIT 500`, params); res.json(rows.map(r => ({ ...r, payload: json(r.payload) }))); });
app.post('/api/reports', auth(['store', 'admin']), async (req, res) => { const storeId = req.user.role === 'store' ? req.user.storeId : Number(req.body.storeId); const { date, payload = {} } = req.body; if (!storeId || !date) return res.status(400).json({ error: '缺少门店或日期' }); const old = await q('SELECT id,version FROM daily_reports WHERE store_id=? AND report_date=?', [storeId, date]); let reportId; if (old.length) { reportId = old[0].id; await execSql('UPDATE daily_reports SET payload=?,submitted_by=?,version=version+1 WHERE id=?', [JSON.stringify(payload), req.user.id, reportId]); } else { reportId = (await execSql('INSERT INTO daily_reports(store_id,report_date,submitted_by,payload,version) VALUES(?,?,?,?,1)', [storeId, date, req.user.id, JSON.stringify(payload)])).insertId; } const revenue = Number(payload.revenue || 0); await execSql("UPDATE tasks SET actual_value=?,status=IF(? >= target_value,'done','pending') WHERE store_id=? AND task_date=?", [revenue, revenue, storeId, date]); await log(req, old.length ? 'update' : 'create', 'daily_reports', reportId, { date }); changed(); res.json((await q('SELECT * FROM daily_reports WHERE id=?', [reportId]))[0]); });

app.get('/api/goals', auth(), async (req, res) => { const store = req.user.role === 'store' ? req.user.storeId : req.query.storeId; const month = req.query.month || new Date().toISOString().slice(0, 7); const params = [month]; let where = 'g.month=?'; if (store) { where += ' AND g.store_id=?'; params.push(store); } res.json(await q(`SELECT g.*,s.name AS store_name FROM monthly_goals g JOIN stores s ON s.id=g.store_id WHERE ${where} ORDER BY g.id`, params)); });
app.post('/api/goals', auth(['ops', 'admin']), async (req, res) => { const { storeId, month, goalValue, rule = 'average', title = '营业额目标', customTargets } = req.body; if (!storeId || !month || Number(goalValue) <= 0) return res.status(400).json({ error: '门店、月份、目标值必填' }); const [y, m] = month.split('-').map(Number); const days = new Date(y, m, 0).getDate(); let targets; if (rule === 'custom') { if (!Array.isArray(customTargets) || customTargets.length !== days) return res.status(400).json({ error: `自定义目标必须提供${days}天数据` }); targets = customTargets.map(Number); if (targets.some(x => !Number.isFinite(x) || x < 0) || Math.abs(targets.reduce((a, b) => a + b, 0) - Number(goalValue)) > 0.01) return res.status(400).json({ error: '每日目标之和必须等于月目标' }); } else { const weights = Array.from({ length: days }, (_, i) => rule === 'weekendWeight' && [0, 6].includes(new Date(y, m - 1, i + 1).getDay()) ? 1.5 : 1); const sum = weights.reduce((a, b) => a + b, 0); targets = weights.map(w => Number(goalValue) * w / sum); } await execSql('INSERT INTO monthly_goals(store_id,`month`,goal_type,goal_value,rule,created_by) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE goal_value=VALUES(goal_value),rule=VALUES(rule),created_by=VALUES(created_by)', [storeId, month, 'revenue', goalValue, rule, req.user.id]); const goal = (await q('SELECT * FROM monthly_goals WHERE store_id=? AND `month`=? AND goal_type=?', [storeId, month, 'revenue']))[0]; for (let d = 1; d <= days; d++) { const dt = `${month}-${String(d).padStart(2, '0')}`; await execSql('INSERT INTO tasks(store_id,goal_id,title,target_value,unit,task_date) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE target_value=VALUES(target_value),title=VALUES(title)', [storeId, goal.id, title, targets[d - 1], '元', dt]); } await execSql("UPDATE tasks t JOIN daily_reports r ON r.store_id=t.store_id AND r.report_date=t.task_date SET t.actual_value=COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revenue')) AS DECIMAL(14,2)),0), t.status=IF(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revenue')) AS DECIMAL(14,2)),0) >= t.target_value,'done','pending') WHERE t.store_id=? AND t.task_date BETWEEN ? AND ?", [storeId, `${month}-01`, `${month}-${String(days).padStart(2, '0')}`]); await log(req, 'upsert', 'monthly_goals', goal.id, { month, goalValue, rule }); changed(); res.json(goal); });
app.get('/api/tasks', auth(), async (req, res) => { const store = req.user.role === 'store' ? req.user.storeId : req.query.storeId; const month = req.query.month || new Date().toISOString().slice(0, 7); const params = [month]; let where = "DATE_FORMAT(t.task_date,'%Y-%m')=?"; if (store) { where += ' AND t.store_id=?'; params.push(store); } res.json(await q(`SELECT t.*,s.name AS store_name FROM tasks t JOIN stores s ON s.id=t.store_id WHERE ${where} ORDER BY t.task_date`, params)); });
app.patch('/api/tasks/:id', auth(['ops', 'admin']), async (req, res) => { const { targetValue, title } = req.body; if (targetValue !== undefined && Number(targetValue) < 0) return res.status(400).json({ error: '目标不能为负数' }); await execSql('UPDATE tasks SET target_value=COALESCE(?,target_value),title=COALESCE(?,title) WHERE id=?', [targetValue === undefined ? null : Number(targetValue), title || null, req.params.id]); await log(req, 'update', 'tasks', req.params.id, req.body); changed(); res.json((await q('SELECT * FROM tasks WHERE id=?', [req.params.id]))[0]); });

app.get('/api/analytics', auth(['ops', 'admin']), async (req, res) => {
  const now = new Date();
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const to = validDate(req.query.to) ? req.query.to : now.toISOString().slice(0, 10);
  const from = validDate(req.query.from) ? req.query.from : `${to.slice(0, 7)}-01`;
  if (from > to) return res.status(400).json({ error: '开始日期不能晚于结束日期' });
  const params = [from, to];
  let filter = 'WHERE r.report_date BETWEEN ? AND ?';
  if (req.query.storeId && req.query.storeId !== 'all') { filter += ' AND r.store_id=?'; params.push(Number(req.query.storeId)); }
  const metric = req.query.metric || 'revenue';
  const byStore = await q(`SELECT r.store_id,s.name AS store_name,
    COUNT(*) AS report_days,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revenue')) AS DECIMAL(14,2))),0) AS revenue,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.orders')) AS DECIMAL(14,2))),0) AS orders,
    COALESCE(AVG(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.wasteRate')) AS DECIMAL(14,2))),0) AS waste_rate,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.members')) AS DECIMAL(14,2))),0) AS members
    FROM daily_reports r JOIN stores s ON s.id=r.store_id ${filter}
    GROUP BY r.store_id,s.name ORDER BY ${metric === 'orders' ? 'orders' : metric === 'wasteRate' ? 'waste_rate' : metric === 'members' ? 'members' : 'revenue'} DESC`, params);
  const byDay = await q(`SELECT DATE_FORMAT(r.report_date,'%Y-%m-%d') AS day,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revenue')) AS DECIMAL(14,2))),0) AS revenue,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.orders')) AS DECIMAL(14,2))),0) AS orders,
    COALESCE(AVG(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.wasteRate')) AS DECIMAL(14,2))),0) AS waste_rate,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.members')) AS DECIMAL(14,2))),0) AS members
    FROM daily_reports r ${filter} GROUP BY r.report_date ORDER BY r.report_date`, params);
  const totals = byStore.reduce((acc, row) => ({
    revenue: acc.revenue + Number(row.revenue || 0), orders: acc.orders + Number(row.orders || 0),
    members: acc.members + Number(row.members || 0), reportDays: acc.reportDays + Number(row.report_days || 0),
    wasteRateSum: acc.wasteRateSum + Number(row.waste_rate || 0)
  }), { revenue: 0, orders: 0, members: 0, reportDays: 0, wasteRateSum: 0 });
  const result = {
    from, to, metric,
    totals: { revenue: totals.revenue, orders: totals.orders, members: totals.members, reportDays: totals.reportDays, wasteRate: byStore.length ? totals.wasteRateSum / byStore.length : 0, avgOrderValue: totals.orders ? totals.revenue / totals.orders : 0 },
    byStore: byStore.map(row => ({ storeId: row.store_id, storeName: row.store_name, reportDays: Number(row.report_days || 0), revenue: Number(row.revenue || 0), orders: Number(row.orders || 0), wasteRate: Number(row.waste_rate || 0), members: Number(row.members || 0), avgOrderValue: Number(row.orders || 0) ? Number(row.revenue || 0) / Number(row.orders || 0) : 0 })),
    byDay: byDay.map(row => ({ day: row.day, revenue: Number(row.revenue || 0), orders: Number(row.orders || 0), wasteRate: Number(row.waste_rate || 0), members: Number(row.members || 0), avgOrderValue: Number(row.orders || 0) ? Number(row.revenue || 0) / Number(row.orders || 0) : 0 }))
  };
  res.json(result);
});

app.get('/api/issues', auth(), async (req, res) => { const params = []; let where = ''; if (req.user.role === 'store') { where = 'WHERE i.store_id=?'; params.push(req.user.storeId); } res.json(await q(`SELECT i.*,s.name AS store_name FROM issues i LEFT JOIN stores s ON s.id=i.store_id ${where} ORDER BY i.created_at DESC LIMIT 300`, params)); });
app.post('/api/issues', auth(['store']), async (req, res) => { const { type = '问题', content = '' } = req.body; if (!content.trim()) return res.status(400).json({ error: '请输入内容' }); const r = await execSql('INSERT INTO issues(store_id,submitter_name,type,content) VALUES(?,?,?,?)', [req.user.storeId, req.user.name, type, content]); await log(req, 'create', 'issues', r.insertId); changed(); res.json((await q('SELECT * FROM issues WHERE id=?', [r.insertId]))[0]); });
app.patch('/api/issues/:id', auth(['ops', 'admin']), async (req, res) => { await execSql("UPDATE issues SET status='resolved',handler_id=?,handled_at=NOW(),handling_note=? WHERE id=?", [req.user.id, req.body.note || '', req.params.id]); await log(req, 'resolve', 'issues', req.params.id, { note: req.body.note || '' }); changed(); res.json((await q('SELECT * FROM issues WHERE id=?', [req.params.id]))[0]); });
app.get('/api/audit', auth(['admin']), async (_req, res) => res.json(await q('SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 300')));
app.get('/api/export/reports.csv', async (req, res) => { try { const u = jwt.verify(req.query.token || '', secret()); if (!['ops', 'admin'].includes(u.role)) throw new Error('forbidden'); } catch { return res.status(401).json({ error: '登录已失效' }); } const month = req.query.month || new Date().toISOString().slice(0, 7); const rows = await q("SELECT r.report_date,s.name AS store_name,r.payload,u.name AS submitter_name FROM daily_reports r JOIN stores s ON s.id=r.store_id LEFT JOIN users u ON u.id=r.submitted_by WHERE DATE_FORMAT(r.report_date,'%Y-%m')=? ORDER BY r.report_date,s.id", [month]); const lines = ['日期,门店,营业额,客单量,损耗率,会员新增,提交人']; for (const r of rows) { const p = json(r.payload); lines.push([r.report_date, r.store_name, p.revenue || '', p.orders || '', p.wasteRate || '', p.members || '', r.submitter_name || ''].map(x => '"' + String(x).replaceAll('"', '""') + '"').join(',')); } res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="oneira-reports-${month}.csv"`); res.send('\ufeff' + lines.join('\n')); });

io.on('connection', socket => socket.emit('ready', { ok: true }));
app.use((req, res, next) => { if (req.method !== 'GET' || req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
async function boot() { await migrateAndSeed(); server.listen(PORT, '0.0.0.0', () => console.log(`ONEIRA Manus Space running on ${PORT}`)); }
boot().catch(error => { console.error(error); process.exit(1); });
