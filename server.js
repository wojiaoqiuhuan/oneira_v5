import express from 'express';
import http from 'http';
import cors from 'cors';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = mysql.createPool({ uri: DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionLimit: 8, dateStrings: true });
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true, credentials: true } });
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); next(); });

const q = async (sql, params = []) => (await pool.query(sql, params))[0];
const execSql = async (sql, params = []) => (await pool.execute(sql, params))[0];
const secret = () => process.env.JWT_SECRET || process.env.MANUS_JWT_SECRET || 'oneira-dev-secret-change-me';
const sign = user => jwt.sign({ id: user.id, role: user.role, storeId: user.store_id || null, storeName: user.store_name || user.storeName || null, name: user.name }, secret(), { expiresIn: '7d' });
const tokenFrom = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
const auth = (roles = []) => (req, res, next) => {
  try {
    req.user = jwt.verify(tokenFrom(req), secret());
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: '无权限' });
    next();
  } catch { res.status(401).json({ error: '登录已失效' }); }
};
const authQuery = (roles = []) => (req, res, next) => { try { req.user = jwt.verify(tokenFrom(req) || String(req.query.token || ''), secret()); if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: '无权限' }); next(); } catch { res.status(401).json({ error: '登录已失效' }); } };
async function verifyActionPassword(req, res, next) {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ error: '请输入身份口令' });
  try {
    if (req.user.role === 'store') {
      const rows = await q('SELECT login_code FROM stores WHERE id=? AND status=\'active\'', [req.user.storeId]);
      if (!rows.length || password !== String(rows[0].login_code || '')) return res.status(401).json({ error: '身份口令错误' });
    } else {
      const rows = await q('SELECT password_hash FROM users WHERE id=? AND role=?', [req.user.id, req.user.role]);
      if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash || ''))) return res.status(401).json({ error: '身份口令错误' });
    }
    next();
  } catch (e) { res.status(500).json({ error: '身份口令校验失败' }); }
}
const json = value => (value == null ? {} : typeof value === 'string' ? JSON.parse(value) : value);
async function inTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tx = { q: async (sql, params=[]) => (await conn.query(sql, params))[0], exec: async (sql, params=[]) => (await conn.execute(sql, params))[0] };
    const result = await work(tx);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally { conn.release(); }
}
// Goal progress is based on the actual received amount, never gross revenue.
const reportRevenue = payload => Number(payload?.received ?? 0);
const AUDIT_RETENTION_LIMIT = 5000;
let auditWrites = 0;
async function trimAuditLogs() {
  if (++auditWrites % 50 !== 0) return;
  const oldRows = await q('SELECT id FROM audit_logs ORDER BY id DESC LIMIT 100000 OFFSET ?', [AUDIT_RETENTION_LIMIT]);
  if (!oldRows.length) return;
  const ids = oldRows.map(x => x.id);
  await execSql(`DELETE FROM audit_logs WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}
async function log(req, action, entity, entityId, detail = {}) {
  await execSql('INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?)', [req.user?.id || null, action, entity, String(entityId ?? ''), JSON.stringify(detail)]);
  await trimAuditLogs();
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
  const [[reportNameColumn]] = await pool.query("SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='daily_reports' AND column_name='submitted_by_name'");
  if (!Number(reportNameColumn.count)) await execSql('ALTER TABLE daily_reports ADD COLUMN submitted_by_name VARCHAR(120) NULL AFTER submitted_by');
  if (!(await q("SELECT id FROM users WHERE name='运营' AND role='ops' LIMIT 1")).length) await execSql("INSERT INTO users(name,role,password_hash) VALUES('运营','ops',?)", [hash]);
  if (!(await q("SELECT id FROM users WHERE name='管理员' AND role='admin' LIMIT 1")).length) await execSql("INSERT INTO users(name,role,password_hash) VALUES('管理员','admin',?)", [hash]);
  const [[reviewMigration]] = await pool.query('SELECT id FROM schema_migrations WHERE id=?', ['002_reviews_annotations']);
  if (!reviewMigration) {
    const sql = await (await import('fs/promises')).readFile(path.join(__dirname, 'db/migrations/002_reviews_annotations.sql'), 'utf8');
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await execSql(statement);
    await execSql('INSERT INTO schema_migrations(id) VALUES(?)', ['002_reviews_annotations']);
  }
  if (!Number((await q('SELECT COUNT(*) AS count FROM report_fields'))[0].count)) await execSql("INSERT INTO report_fields(label,`key`,field_type,unit,required,sort_order) VALUES ('营业额','revenue','number','元',1,1),('客单量','orders','number','单',1,2),('损耗率','wasteRate','number','%',1,3),('会员新增','members','number','人',0,4)");
  const [[rankingMigration]] = await pool.query('SELECT id FROM schema_migrations WHERE id=?', ['003_ranking_ai']);
  if (!rankingMigration) { const sql = await (await import('fs/promises')).readFile(path.join(__dirname, 'db/migrations/003_ranking_ai.sql'), 'utf8'); for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await execSql(statement); await execSql('INSERT INTO schema_migrations(id) VALUES(?)', ['003_ranking_ai']); }
  const [[orderingMigration]] = await pool.query('SELECT id FROM schema_migrations WHERE id=?', ['004_ordering_system']);
  if (!orderingMigration) { const sql = await (await import('fs/promises')).readFile(path.join(__dirname, 'db/migrations/004_ordering_system.sql'), 'utf8'); for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await execSql(statement); await execSql('INSERT INTO schema_migrations(id) VALUES(?)', ['004_ordering_system']); }
  const [[receivedGoalMigration]] = await pool.query('SELECT id FROM schema_migrations WHERE id=?', ['005_received_goals']);
  if (!receivedGoalMigration) { const sql = await (await import('fs/promises')).readFile(path.join(__dirname, 'db/migrations/005_received_goals.sql'), 'utf8'); for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await execSql(statement); await execSql('INSERT INTO schema_migrations(id) VALUES(?)', ['005_received_goals']); }
  const [[auditMigration]] = await pool.query('SELECT id FROM schema_migrations WHERE id=?', ['006_audit_retention']);
  if (!auditMigration) { const sql = await (await import('fs/promises')).readFile(path.join(__dirname, 'db/migrations/006_audit_retention.sql'), 'utf8'); for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) { try { await execSql(statement); } catch (error) { if (!/Duplicate key name/i.test(error.message)) throw error; } } await execSql('INSERT INTO schema_migrations(id) VALUES(?)', ['006_audit_retention']); }
  await seedOrderingCatalog();
}

const DEFAULT_ORDERING_CATEGORIES = [
  ['DM','丹麦/可颂类',10],['TS','吐司类',20],['RO','软欧/碱水类',30],['DT','蛋挞类',40],['CK','蛋糕/甜点类',50],['CK3','3寸小蛋糕类',60],['QT','其他',90]
];
const DEFAULT_ORDERING_PRODUCTS = [
  ['YL-001','原味可颂','DM','个',12],['YL-002','热狗可颂','DM','个',16.8],['YL-003','丹麦巧克力碱水结','DM','个',15.5],['YL-004','脏脏包','DM','个',15],['YL-005','德式丹麦肠','DM','个',16],['YL-006','海螺卷','DM','个',10.5],['YL-007','开心果海螺卷','DM','个',12],['YL-008','丹麦辣条碱水结','DM','个',12],['YL-009','树莓开心果蛋挞','DT','个',13.8],['YL-010','丹麦国王塔','DM','个',12],['YL-011','猪肉脯吐司','TS','个',21],['YL-012','红豆肉松吐司','TS','个',22],['YL-013','海盐生吐司','TS','个',16],['YL-014','拉丝麻薯菠萝包','DM','个',12.8],['YL-015','芝士肉松圈','RO','个',13.8],['YL-016','芋泥肉松','RO','个',12.8],['YL-017','黑金碱水球','RO','个',12.8],['YL-018','香肠芝士碱水球','RO','个',12.8],['YL-019','巧克力碱水贝果','RO','个',12.8],['YL-020','帕斯雀牛肉贝果','RO','个',13.8],['YL-021','黑椒牛肉法棍','RO','个',18],['YL-022','核桃马里奥','RO','个',16.9],['YL-023','开心果核桃马里奥','RO','个',16.9],['YL-024','蓝莓乳酪','RO','个',20],['YL-025','墨鱼芝士肠','RO','个',16],['YL-026','辣椒圈碱水香肠','RO','个',16],['YL-027','蔓越莓坚果','RO','个',18],['YL-028','坚果乳酪大满贯','RO','个',20],['YL-029','全麦核桃','RO','个',15],['YL-030','蓝莓提拉米苏','CK','个',27],['YL-031','原味提拉米苏','CK','个',25],['YL-032','芒果提拉米苏','CK','个',25],['YL-033','梦龙巧克力','CK','个',29.5],['YL-034','开心果树莓巴斯克','CK','个',26],['YL-035','香柠酸奶巴斯克','CK','个',26],['YL-036','黑巧蓝莓巴斯克','CK','个',26],['YL-037','奥利奥便当盒','CK','盒',19.9],['YL-038','巧克力便当盒','CK','盒',22.5],['YL-039','茉莉桃桃','CK3','个',26],['YL-040','柠柠青提','CK3','个',28],['YL-041','蓝莓假日','CK3','个',28],['YL-042','榴莲芒果','CK3','个',33]
];
async function seedOrderingCatalogForStore(storeId) {
  const [[existing]] = await pool.query('SELECT COUNT(*) AS count FROM ordering_products WHERE store_id=?', [storeId]);
  if (Number(existing.count)) return;
  const categoryIds = {};
  for (const [code,name,sort] of DEFAULT_ORDERING_CATEGORIES) { const r = await execSql('INSERT INTO ordering_categories(store_id,category_code,name,sort_order) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),name=VALUES(name),sort_order=VALUES(sort_order)', [storeId,code,name,sort]); categoryIds[code] = r.insertId; }
  for (let i=0;i<DEFAULT_ORDERING_PRODUCTS.length;i++) { const [sku,name,code,unit,price]=DEFAULT_ORDERING_PRODUCTS[i]; await execSql('INSERT INTO ordering_products(store_id,category_id,sku,name,unit,unit_price,sort_order) VALUES(?,?,?,?,?,?,?)', [storeId,categoryIds[code],sku,name,unit,price,i+1]); }
}
async function seedOrderingCatalog() { const stores = await q("SELECT id FROM stores WHERE status='active' ORDER BY id"); for (const store of stores) await seedOrderingCatalogForStore(store.id); }
app.get('/api/health', async (_req, res) => { try { await q('SELECT 1 AS ok'); res.json({ ok: true, version: '5.2.0-manus-space', service: 'oneira-workbench' }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/sync/version', (_req, res) => res.json({ at: new Date().toISOString() }));
app.get('/api/public/stores', async (_req, res) => res.json(await q("SELECT id,name FROM stores WHERE status='active' ORDER BY id")));
app.post('/api/auth/store-login', async (req, res) => { const storeName = String(req.body.storeName || '').trim(); const name = String(req.body.name || '').trim().slice(0, 120); const code = String(req.body.code || '').trim(); if (!storeName || !code || !name) return res.status(400).json({ error: '请选择门店并填写本次提交姓名和门店口令' }); const rows = await q("SELECT s.id AS store_id,s.name AS store_name,u.id AS user_id FROM stores s LEFT JOIN users u ON u.store_id=s.id AND u.role='store' WHERE s.name=? AND s.login_code=? AND s.status='active' ORDER BY u.id LIMIT 1", [storeName, code]); if (!rows.length) return res.status(401).json({ error: '门店或口令错误' }); const identity = { id: rows[0].user_id || null, name, role: 'store', store_id: rows[0].store_id, store_name: rows[0].store_name }; const token = sign(identity); res.json({ token, user: { id: identity.id, name, role: 'store', storeId: identity.store_id, storeName: identity.store_name } }); });
app.post('/api/auth/staff-login', async (req, res) => { const { name, password, role } = req.body; const rows = await q('SELECT * FROM users WHERE name=? AND role=?', [name, role]); if (!rows.length || !(await bcrypt.compare(password || '', rows[0].password_hash || ''))) return res.status(401).json({ error: '账号或密码错误' }); const token = sign(rows[0]); res.json({ token, user: { id: rows[0].id, name: rows[0].name, role: rows[0].role } }); });
app.post('/api/auth/verify-password', auth(['store','ops','admin']), verifyActionPassword, (_req,res) => res.json({ ok:true }));
app.get('/api/me', auth(), (req, res) => res.json({ user: req.user }));

app.get('/api/stores', auth(['ops', 'admin']), async (_req, res) => res.json(await q('SELECT id,name,address,manager_name,status,created_at FROM stores ORDER BY id')));
app.post('/api/stores', auth(['admin']), async (req, res) => { const { name, address = '', managerName = '', code } = req.body; if (!name || !code) return res.status(400).json({ error: '门店名称和口令必填' }); const r = await execSql('INSERT INTO stores(name,address,manager_name,login_code) VALUES(?,?,?,?)', [name, address, managerName, code]); await seedOrderingCatalogForStore(r.insertId); if (managerName) await execSql("INSERT INTO users(name,store_id,role) VALUES(?,?, 'store')", [managerName, r.insertId]); await log(req, 'create', 'stores', r.insertId, { name }); changed(); res.json({ id: r.insertId, name, address, manager_name: managerName, status: 'active' }); });
app.patch('/api/stores/:id', auth(['admin']), async (req, res) => { const { name = null, address = null, managerName = null, code = null, status = null } = req.body; await execSql('UPDATE stores SET name=COALESCE(?,name),address=COALESCE(?,address),manager_name=COALESCE(?,manager_name),login_code=COALESCE(?,login_code),status=COALESCE(?,status) WHERE id=?', [name, address, managerName, code, status, req.params.id]); if (managerName) await execSql("UPDATE users SET name=? WHERE store_id=? AND role='store'", [managerName, req.params.id]); await log(req, 'update', 'stores', req.params.id, { changed: req.body }); changed(); res.json((await q('SELECT * FROM stores WHERE id=?', [req.params.id]))[0]); });
app.delete('/api/stores/:id', auth(['admin']), verifyActionPassword, async (req, res) => { if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: '需要二次确认' }); await execSql("UPDATE stores SET status='archived' WHERE id=?", [req.params.id]); await log(req, 'archive', 'stores', req.params.id); changed(); res.json({ ok: true }); });
app.get('/api/users', auth(['admin']), async (_req, res) => res.json(await q("SELECT u.id,u.name,u.store_id,u.role,s.name AS store_name,u.created_at FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role='store' ORDER BY s.id,u.id")));
app.get('/api/admin/accounts', auth(['admin']), async (_req,res) => res.json(await q("SELECT id,name,role,created_at FROM users WHERE role IN ('ops','admin') ORDER BY role,id")));
app.patch('/api/admin/accounts/:id', auth(['admin']), async (req,res) => { const rows=await q("SELECT id,name,role FROM users WHERE id=? AND role IN ('ops','admin')",[req.params.id]); if(!rows.length)return res.status(404).json({error:'账号不存在'}); const {name,password}=req.body; if(!String(name||'').trim())return res.status(400).json({error:'账号名称不能为空'}); if(password!==undefined && String(password).length<6)return res.status(400).json({error:'口令至少需要6位'}); const hash=password!==undefined?await bcrypt.hash(String(password),10):null; await execSql('UPDATE users SET name=?,password_hash=COALESCE(?,password_hash) WHERE id=?',[String(name).trim(),hash,req.params.id]); await log(req,'update','users',req.params.id,{name, passwordChanged: password!==undefined}); changed(); res.json((await q('SELECT id,name,role,created_at FROM users WHERE id=?',[req.params.id]))[0]); });
app.post('/api/users', auth(['admin']), async (req, res) => { const { name, storeId } = req.body; if (!name || !storeId) return res.status(400).json({ error: '姓名和门店必填' }); const r = await execSql("INSERT INTO users(name,store_id,role) VALUES(?,?, 'store')", [name, storeId]); await log(req, 'create', 'users', r.insertId, { name, storeId }); changed(); res.json({ id: r.insertId, name, store_id: storeId, role: 'store' }); });
app.delete('/api/users/:id', auth(['admin']), verifyActionPassword, async (req, res) => { if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: '需要二次确认' }); await execSql("DELETE FROM users WHERE id=? AND role='store'", [req.params.id]); await log(req, 'delete', 'users', req.params.id); changed(); res.json({ ok: true }); });
app.get('/api/report-fields', auth(), async (_req, res) => res.json(await q('SELECT * FROM report_fields WHERE enabled=1 ORDER BY sort_order,id')));
app.put('/api/report-fields', auth(['admin']), async (req, res) => { if (req.body.password) { let passed=false; const rows=await q('SELECT password_hash FROM users WHERE id=? AND role=\'admin\'',[req.user.id]); if(rows.length) passed=await bcrypt.compare(String(req.body.password),rows[0].password_hash||''); if(!passed)return res.status(401).json({error:'身份口令错误'}); } const fields = req.body.fields || []; const keys = new Set(); for (const f of fields) { if (!f.label || !f.key || keys.has(f.key)) return res.status(400).json({ error: '日报字段名称或唯一键重复' }); keys.add(f.key); } await execSql('UPDATE report_fields SET enabled=0'); for (let i = 0; i < fields.length; i++) { const f = fields[i]; await execSql('INSERT INTO report_fields(label,`key`,field_type,unit,required,sort_order,enabled) VALUES(?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE label=VALUES(label),field_type=VALUES(field_type),unit=VALUES(unit),required=VALUES(required),sort_order=VALUES(sort_order),enabled=1', [f.label, f.key, f.field_type || 'number', f.unit || '', !!f.required, i + 1]); } await log(req, 'update', 'report_fields', 'all', { count: fields.length }); changed(); res.json({ ok: true }); });

app.get('/api/reports', auth(), async (req, res) => { const conditions = []; const params = []; if (req.user.role === 'store') { conditions.push('r.store_id=?'); params.push(req.user.storeId); } else if (req.query.storeId) { conditions.push('r.store_id=?'); params.push(req.query.storeId); } if (req.query.month) { conditions.push("DATE_FORMAT(r.report_date,'%Y-%m')=?"); params.push(req.query.month); } const rows = await q(`SELECT r.*,s.name AS store_name,COALESCE(r.submitted_by_name,u.name) AS submitter_name FROM daily_reports r JOIN stores s ON s.id=r.store_id LEFT JOIN users u ON u.id=r.submitted_by ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY r.report_date DESC,r.id DESC${req.user.role==='admin'&&!req.query.month?'':' LIMIT 500'}`, params); res.json(rows.map(r => ({ ...r, payload: json(r.payload) }))); });
app.delete('/api/reports/:id', auth(['store', 'admin']), verifyActionPassword, async (req, res) => { const rows=await q('SELECT id,store_id,report_date FROM daily_reports WHERE id=?',[req.params.id]); if(!rows.length)return res.status(404).json({error:'日报不存在'}); const r=rows[0]; if(req.user.role==='store'&&Number(r.store_id)!==Number(req.user.storeId))return res.status(403).json({error:'只能删除本门店日报'}); await inTransaction(async ({exec})=>{await exec('DELETE FROM daily_reports WHERE id=?',[r.id]);await exec("UPDATE tasks SET actual_value=0,status='pending' WHERE store_id=? AND task_date=?",[r.store_id,r.report_date]);}); await log(req,'delete','daily_reports',r.id,{storeId:r.store_id,date:r.report_date}); changed(); res.json({ok:true}); });
app.post('/api/reports', auth(['store','admin']), async (req,res) => { const storeId=req.user.role==='store'?req.user.storeId:Number(req.body.storeId); const {date,payload={}}=req.body; if(!storeId||!date)return res.status(400).json({error:'缺少门店或日期'}); const required=await q('SELECT `key`,label,field_type FROM report_fields WHERE enabled=1 AND required=1'); const missing=required.filter(f=>payload[f.key]===undefined||payload[f.key]===null||String(payload[f.key]).trim()===''); if(missing.length)return res.status(400).json({error:'请填写必填项：'+missing.map(f=>f.label).join('、'),missing:missing.map(f=>f.key)}); const result=await inTransaction(async ({q:tq,exec})=>{const old=await tq('SELECT id,version FROM daily_reports WHERE store_id=? AND report_date=?',[storeId,date]);let reportId;if(old.length){reportId=old[0].id;await exec('UPDATE daily_reports SET payload=?,submitted_by=?,submitted_by_name=?,version=version+1 WHERE id=?',[JSON.stringify(payload),req.user.id||null,req.user.name,reportId]);}else{reportId=(await exec('INSERT INTO daily_reports(store_id,report_date,submitted_by,submitted_by_name,payload,version) VALUES(?,?,?,?,?,1)',[storeId,date,req.user.id||null,req.user.name,JSON.stringify(payload)])).insertId;}const revenue=reportRevenue(payload);await exec("UPDATE tasks SET actual_value=?,status=IF(? >= target_value,'done','pending') WHERE store_id=? AND task_date=?",[revenue,revenue,storeId,date]);return {reportId,updated:old.length>0};});await log(req,result.updated?'update':'create','daily_reports',result.reportId,{date});changed();res.json((await q('SELECT * FROM daily_reports WHERE id=?',[result.reportId]))[0]); });
app.get('/api/goals', auth(), async (req, res) => { const store = req.user.role === 'store' ? req.user.storeId : req.query.storeId; const month = req.query.month || new Date().toISOString().slice(0, 7); const params = [month]; let where = 'g.month=?'; if (store) { where += ' AND g.store_id=?'; params.push(store); } res.json(await q(`SELECT g.*,s.name AS store_name FROM monthly_goals g JOIN stores s ON s.id=g.store_id WHERE ${where} ORDER BY g.id`, params)); });
app.post('/api/goals', auth(['ops','admin']), async (req,res) => { const {storeId,month,goalValue,rule='average',title='实收金额目标',customTargets}=req.body;if(!storeId||!month||Number(goalValue)<=0)return res.status(400).json({error:'门店、月份、目标值必填'});const [y,m]=month.split('-').map(Number),days=new Date(y,m,0).getDate();let targets;if(rule==='custom'){if(!Array.isArray(customTargets)||customTargets.length!==days)return res.status(400).json({error:`自定义目标必须提供${days}天数据`});targets=customTargets.map(Number);if(targets.some(x=>!Number.isFinite(x)||x<0)||Math.abs(targets.reduce((a,b)=>a+b,0)-Number(goalValue))>0.01)return res.status(400).json({error:'每日目标之和必须等于月目标'});}else{const weights=Array.from({length:days},(_,i)=>rule==='weekendWeight'&&[0,6].includes(new Date(y,m-1,i+1).getDay())?1.5:1);const sum=weights.reduce((a,b)=>a+b,0);targets=weights.map(w=>Number(goalValue)*w/sum);}const goal=await inTransaction(async ({q:tq,exec})=>{await exec('INSERT INTO monthly_goals(store_id,`month`,goal_type,goal_value,rule,created_by) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE goal_value=VALUES(goal_value),rule=VALUES(rule),created_by=VALUES(created_by)',[storeId,month,'revenue',goalValue,rule,req.user.id]);const g=(await tq('SELECT * FROM monthly_goals WHERE store_id=? AND `month`=? AND goal_type=?',[storeId,month,'revenue']))[0];for(let d=1;d<=days;d++){const dt=`${month}-${String(d).padStart(2,'0')}`;await exec('INSERT INTO tasks(store_id,goal_id,title,target_value,unit,task_date) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE target_value=VALUES(target_value),title=VALUES(title)',[storeId,g.id,title,targets[d-1],'元',dt]);}await exec("UPDATE tasks t JOIN daily_reports r ON r.store_id=t.store_id AND r.report_date=t.task_date SET t.actual_value=COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.received')) AS DECIMAL(14,2)),0),t.status=IF(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.received')) AS DECIMAL(14,2)),0)>=t.target_value,'done','pending') WHERE t.store_id=? AND t.task_date BETWEEN ? AND ?",[storeId,`${month}-01`,`${month}-${String(days).padStart(2,'0')}`]);return g;});await log(req,'upsert','monthly_goals',goal.id,{month,goalValue,rule});changed();res.json(goal); });
app.get('/api/tasks', auth(), async (req, res) => { const store = req.user.role === 'store' ? req.user.storeId : req.query.storeId; const month = req.query.month || new Date().toISOString().slice(0, 7); const params = [month]; let where = "DATE_FORMAT(t.task_date,'%Y-%m')=?"; if (store) { where += ' AND t.store_id=?'; params.push(store); } res.json(await q(`SELECT t.*,s.name AS store_name FROM tasks t JOIN stores s ON s.id=t.store_id WHERE ${where} ORDER BY t.task_date`, params)); });
app.patch('/api/tasks/:id', auth(['ops', 'admin']), async (req, res) => { const { targetValue, title } = req.body; if (targetValue !== undefined && Number(targetValue) < 0) return res.status(400).json({ error: '目标不能为负数' }); await execSql('UPDATE tasks SET target_value=COALESCE(?,target_value),title=COALESCE(?,title) WHERE id=?', [targetValue === undefined ? null : Number(targetValue), title || null, req.params.id]); await log(req, 'update', 'tasks', req.params.id, req.body); changed(); res.json((await q('SELECT * FROM tasks WHERE id=?', [req.params.id]))[0]); });

app.get('/api/ranking-metrics', auth(), async (_req,res)=>res.json(await q('SELECT * FROM ranking_metrics WHERE enabled=1 ORDER BY sort_order,id')));
app.put('/api/ranking-metrics', auth(['admin']), async (req,res)=>{const metrics=Array.isArray(req.body.metrics)?req.body.metrics:[];for(let i=0;i<metrics.length;i++){const m=metrics[i];if(!m.metric_key||!m.label||!m.source_key)return res.status(400).json({error:'排行名称和数据字段不能为空'});await execSql('INSERT INTO ranking_metrics(metric_key,label,unit,source_key,aggregation,enabled,sort_order) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label),unit=VALUES(unit),source_key=VALUES(source_key),aggregation=VALUES(aggregation),enabled=VALUES(enabled),sort_order=VALUES(sort_order)',[m.metric_key,m.label,m.unit||'',m.source_key,m.aggregation||'sum',m.enabled!==false,i+1]);}await execSql('UPDATE ranking_metrics SET enabled=0 WHERE metric_key NOT IN ('+metrics.map(()=>'?').join(',')+')',metrics.map(m=>m.metric_key));await log(req,'update','ranking_metrics','all',{count:metrics.length});changed();res.json(await q('SELECT * FROM ranking_metrics WHERE enabled=1 ORDER BY sort_order,id'));});
app.get('/api/ai/settings', auth(['admin']), async (_req,res)=>{const r=(await q('SELECT id,endpoint,model,enabled,updated_at,IF(api_key IS NULL OR api_key="",0,1) AS has_key FROM ai_settings WHERE id=1'))[0];res.json(r||{id:1,endpoint:'',model:'',enabled:false,has_key:0});});
app.put('/api/ai/settings', auth(['admin']), async (req,res)=>{const {endpoint='',model='',apiKey,enabled=false}=req.body;if(endpoint&&!/^https?:\/\//i.test(endpoint))return res.status(400).json({error:'AI 接口必须是 http 或 https 地址'});const key=apiKey===undefined?null:String(apiKey||'');await execSql('INSERT INTO ai_settings(id,endpoint,model,api_key,enabled,updated_by) VALUES(1,?,?,?,?,?) ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint),model=VALUES(model),api_key=CASE WHEN ? IS NULL THEN api_key WHEN ?="" THEN NULL ELSE ? END,enabled=VALUES(enabled),updated_by=VALUES(updated_by)',[endpoint,model,key,!!enabled,req.user.id,apiKey===undefined?null:key,key,key,]);await log(req,'update','ai_settings','1',{endpoint,model,enabled,apiKeyChanged:apiKey!==undefined});changed();res.json({ok:true});});
app.post('/api/ai/analyze', auth(), async (req,res)=>{const cfg=(await q('SELECT * FROM ai_settings WHERE id=1'))[0]||{};const endpoint=cfg.endpoint||process.env.OPENAI_API_BASE||'';const key=cfg.api_key||process.env.OPENAI_API_KEY||'';const model=cfg.model||'gpt-4o-mini';if(!endpoint||!key||!cfg.enabled&&!(process.env.OPENAI_API_KEY&&process.env.OPENAI_API_BASE))return res.status(400).json({error:'AI 尚未配置或未启用'});const from=req.body.from||new Date().toISOString().slice(0,7)+'-01',to=req.body.to||new Date().toISOString().slice(0,10);const sid=req.user.role==='store'?req.user.storeId:(req.body.storeId||'all');const rows=await q(`SELECT r.report_date,s.name AS store_name,r.submitted_by_name,r.payload FROM daily_reports r JOIN stores s ON s.id=r.store_id WHERE r.report_date BETWEEN ? AND ? ${sid!=='all'?'AND r.store_id=?':''} ORDER BY r.report_date`,sid==='all'?[from,to]:[from,to,Number(sid)]);const prompt=String(req.body.prompt||'请分析经营趋势、异常指标、门店差异和下一步行动建议。');const data=rows.map(r=>({date:r.report_date,store:r.store_name,submitter:r.submitted_by_name,payload:json(r.payload)}));try{const rr=await fetch(endpoint.replace(/\/$/, '')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model,temperature:0.2,messages:[{role:'system',content:'你是ONEIRA烘焙连锁运营分析助手。只基于提供的数据，使用简体中文，输出结论、异常、建议，避免编造。'},{role:'user',content:prompt+'\n数据：'+JSON.stringify(data)}]})});const out=await rr.json();if(!rr.ok)throw new Error(out.error?.message||'AI接口请求失败');res.json({content:out.choices?.[0]?.message?.content||'AI未返回分析结果',from,to,rows:data.length});}catch(e){res.status(502).json({error:'AI分析失败：'+e.message})}});
app.get('/api/analytics', auth(['store','ops', 'admin']), async (req, res) => {
  const rankingConfigs = await q('SELECT metric_key,source_key,aggregation FROM ranking_metrics WHERE enabled=1 ORDER BY sort_order,id');
  const requestedStore = req.user.role==='store' ? String(req.user.storeId) : (req.query.storeId || 'all');
  const now = new Date();
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const to = validDate(req.query.to) ? req.query.to : now.toISOString().slice(0, 10);
  const from = validDate(req.query.from) ? req.query.from : `${to.slice(0, 7)}-01`;
  if (from > to) return res.status(400).json({ error: '开始日期不能晚于结束日期' });
  const params = [from, to];
  let filter = 'WHERE r.report_date BETWEEN ? AND ?';
  if (requestedStore && requestedStore !== 'all') { filter += ' AND r.store_id=?'; params.push(Number(requestedStore)); }
  const metric = req.query.metric || 'revenue';
  const byStore = await q(`SELECT r.store_id,s.name AS store_name,
    COUNT(*) AS report_days,
    COALESCE(SUM(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.totalRevenue')) AS DECIMAL(14,2)),CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revenue')) AS DECIMAL(14,2)))),0) AS revenue,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.orders')) AS DECIMAL(14,2))),0) AS orders,
    COALESCE(AVG(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.wasteRate')) AS DECIMAL(14,2))),0) AS waste_rate,
    COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.members')) AS DECIMAL(14,2))),0) AS members
    FROM daily_reports r JOIN stores s ON s.id=r.store_id ${filter}
    GROUP BY r.store_id,s.name ORDER BY ${metric === 'orders' ? 'orders' : metric === 'wasteRate' ? 'waste_rate' : metric === 'members' ? 'members' : 'revenue'} DESC`, params);
  const byDay = await q(`SELECT DATE_FORMAT(r.report_date,'%Y-%m-%d') AS day,
    COALESCE(SUM(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.totalRevenue')) AS DECIMAL(14,2)),CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.revenue')) AS DECIMAL(14,2)))),0) AS revenue,
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
    byStore: byStore.map(row => ({ storeId: row.store_id, storeName: row.store_name, reportDays: Number(row.report_days || 0), revenue: Number(row.revenue || 0), orders: Number(row.orders || 0), wasteRate: Number(row.waste_rate || 0), members: Number(row.members || 0), avgOrderValue: Number(row.orders || 0) ? Number(row.revenue || 0) / Number(row.orders || 0) : 0, metricValues: {} })),
    byDay: byDay.map(row => ({ day: row.day, revenue: Number(row.revenue || 0), orders: Number(row.orders || 0), wasteRate: Number(row.waste_rate || 0), members: Number(row.members || 0), avgOrderValue: Number(row.orders || 0) ? Number(row.revenue || 0) / Number(row.orders || 0) : 0 })), details: (await q(`SELECT r.id,r.report_date,r.created_at,r.updated_at,r.submitted_by_name,s.name AS store_name,r.payload FROM daily_reports r JOIN stores s ON s.id=r.store_id WHERE r.report_date BETWEEN ? AND ? ${requestedStore&&requestedStore!=='all'?'AND r.store_id=?':''} ORDER BY r.report_date DESC,r.id DESC`, requestedStore&&requestedStore!=='all'?[from,to,Number(requestedStore)]:[from,to])).map(r=>({...r,payload:json(r.payload)}))
  };
  const detailRows = result.details || [];
  for (const row of result.byStore) { const items=detailRows.filter(d=>Number(d.store_id||0)===Number(row.storeId)||d.store_name===row.storeName); for (const cfg of rankingConfigs) { const vals=items.map(d=>Number((d.payload||{})[cfg.source_key])).filter(Number.isFinite); row.metricValues[cfg.metric_key]=cfg.aggregation==='avg'?(vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0):vals.reduce((a,b)=>a+b,0); } }
  result.byStore.sort((a,b)=>Number(b.metricValues[metric]??metricValueForLegacy(b,metric))-Number(a.metricValues[metric]??metricValueForLegacy(a,metric)));
  res.json(result);
});
function metricValueForLegacy(row,metric){return metric==='orders'?Number(row.orders||0):metric==='wasteRate'?Number(row.wasteRate||0):metric==='members'?Number(row.members||0):Number(row.revenue||0)}

app.get('/api/reviews', auth(), async (req, res) => {
  const params = []; let where = '1=1';
  if (req.user.role === 'store') { where += ' AND r.store_id=?'; params.push(req.user.storeId); }
  else if (req.query.storeId && req.query.storeId !== 'all') { where += ' AND r.store_id=?'; params.push(Number(req.query.storeId)); }
  if (req.query.periodType) { where += ' AND r.period_type=?'; params.push(req.query.periodType); }
  if (req.query.periodKey) { where += ' AND r.period_key=?'; params.push(req.query.periodKey); }
  res.json(await q(`SELECT r.*,s.name AS store_name,u.name AS author_user_name FROM period_reviews r JOIN stores s ON s.id=r.store_id LEFT JOIN users u ON u.id=r.author_id WHERE ${where} ORDER BY r.period_key DESC,r.updated_at DESC LIMIT 300`, params));
});
app.post('/api/reviews', auth(['store','ops','admin']), async (req, res) => {
  const storeId = req.user.role === 'store' ? req.user.storeId : Number(req.body.storeId);
  const { periodType, periodKey, title='', content='', highlights='', blockers='', nextActions='' } = req.body;
  if (!storeId || !['week','month'].includes(periodType) || !periodKey || !String(content).trim()) return res.status(400).json({ error: '门店、周期和复盘内容必填' });
  const existing = await q('SELECT id FROM period_reviews WHERE store_id=? AND period_type=? AND period_key=? AND author_id=? LIMIT 1', [storeId, periodType, periodKey, req.user.id || null]);
  let id;
  if (existing.length) { id=existing[0].id; await execSql('UPDATE period_reviews SET title=?,content=?,highlights=?,blockers=?,next_actions=?,author_role=? WHERE id=?', [title,content,highlights,blockers,nextActions,req.user.role,id]); }
  else { id=(await execSql('INSERT INTO period_reviews(store_id,author_id,author_role,period_type,period_key,title,content,highlights,blockers,next_actions) VALUES(?,?,?,?,?,?,?,?,?,?)', [storeId,req.user.id||null,req.user.role,periodType,periodKey,title,content,highlights,blockers,nextActions])).insertId; }
  await log(req, existing.length ? 'update' : 'create', 'period_reviews', id, { storeId, periodType, periodKey }); changed(); res.json((await q('SELECT r.*,s.name AS store_name FROM period_reviews r JOIN stores s ON s.id=r.store_id WHERE r.id=?',[id]))[0]);
});
app.delete('/api/reviews/:id', auth(['ops','admin','store']), verifyActionPassword, async (req,res) => { const rows=await q('SELECT * FROM period_reviews WHERE id=?',[req.params.id]); if(!rows.length)return res.status(404).json({error:'复盘不存在'}); if(req.user.role==='store'&&(rows[0].store_id!==req.user.storeId||rows[0].author_id!==req.user.id))return res.status(403).json({error:'无权限'}); await execSql('DELETE FROM period_reviews WHERE id=?',[req.params.id]); await log(req,'delete','period_reviews',req.params.id); changed(); res.json({ok:true}); });
app.get('/api/annotations', auth(), async (req,res) => {
  const params=[]; let where='1=1';
  if(req.user.role==='store'){where+=' AND a.store_id=?';params.push(req.user.storeId)} else if(req.query.storeId&&req.query.storeId!=='all'){where+=' AND a.store_id=?';params.push(Number(req.query.storeId))}
  if(req.query.month){where+=" AND DATE_FORMAT(a.annotation_date,'%Y-%m')=?";params.push(req.query.month)}
  res.json(await q(`SELECT a.*,s.name AS store_name FROM calendar_annotations a JOIN stores s ON s.id=a.store_id WHERE ${where} ORDER BY a.annotation_date DESC,a.created_at DESC LIMIT 500`,params));
});
app.post('/api/annotations', auth(['store','ops','admin']), async (req,res)=>{ const storeId=req.user.role==='store'?req.user.storeId:Number(req.body.storeId); const {date,type='note',title='',content='',reminderAt=null}=req.body; if(!storeId||!date||!String(content).trim())return res.status(400).json({error:'日期和标注内容必填'}); const r=await execSql('INSERT INTO calendar_annotations(store_id,annotation_date,author_id,author_name,annotation_type,title,content,reminder_at) VALUES(?,?,?,?,?,?,?,?)',[storeId,date,req.user.id||null,req.user.name,type,title,content,reminderAt||null]); await log(req,'create','calendar_annotations',r.insertId,{storeId,date,type});changed();res.json((await q('SELECT a.*,s.name AS store_name FROM calendar_annotations a JOIN stores s ON s.id=a.store_id WHERE a.id=?',[r.insertId]))[0]); });
app.patch('/api/annotations/:id', auth(['store','ops','admin']), verifyActionPassword, async(req,res)=>{const rows=await q('SELECT * FROM calendar_annotations WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'标注不存在'});if(req.user.role==='store'&&(rows[0].store_id!==req.user.storeId||rows[0].author_id!==req.user.id))return res.status(403).json({error:'无权限'});const {type,title='',content,reminderAt=null,status}=req.body;await execSql('UPDATE calendar_annotations SET annotation_type=COALESCE(?,annotation_type),title=COALESCE(?,title),content=COALESCE(?,content),reminder_at=?,status=COALESCE(?,status) WHERE id=?',[type||null,title,content||null,reminderAt||null,status||null,req.params.id]);await log(req,'update','calendar_annotations',req.params.id,req.body);changed();res.json({ok:true});});
app.delete('/api/annotations/:id', auth(['store','ops','admin']), verifyActionPassword, async(req,res)=>{const rows=await q('SELECT * FROM calendar_annotations WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'标注不存在'});if(req.user.role==='store'&&(rows[0].store_id!==req.user.storeId||rows[0].author_id!==req.user.id))return res.status(403).json({error:'无权限'});await execSql('DELETE FROM calendar_annotations WHERE id=?',[req.params.id]);await log(req,'delete','calendar_annotations',req.params.id);changed();res.json({ok:true});});
app.get('/api/issues', auth(), async (req, res) => { const params = []; let where = ''; if (req.user.role === 'store') { where = 'WHERE i.store_id=?'; params.push(req.user.storeId); } res.json(await q(`SELECT i.*,s.name AS store_name FROM issues i LEFT JOIN stores s ON s.id=i.store_id ${where} ORDER BY i.created_at DESC LIMIT 300`, params)); });
app.post('/api/issues', auth(['store','ops','admin']), async (req, res) => { const storeId=req.user.role==='store'?req.user.storeId:Number(req.body.storeId); const { type = '问题', content = '' } = req.body; if (!storeId || !String(content).trim()) return res.status(400).json({ error: '门店和反馈内容必填' }); const r = await execSql('INSERT INTO issues(store_id,submitter_name,type,content) VALUES(?,?,?,?)', [storeId, req.user.name, type, content]); await log(req, 'create', 'issues', r.insertId); changed(); res.json((await q('SELECT * FROM issues WHERE id=?', [r.insertId]))[0]); });
app.patch('/api/issues/:id', auth(['store','ops','admin']), async (req, res) => { const rows=await q('SELECT * FROM issues WHERE id=?',[req.params.id]); if(!rows.length)return res.status(404).json({error:'反馈不存在'}); if(req.user.role==='store'&&rows[0].store_id!==req.user.storeId)return res.status(403).json({error:'无权限'}); const {type,content,status,note}=req.body; await execSql("UPDATE issues SET type=COALESCE(?,type),content=COALESCE(?,content),status=COALESCE(?,status),handler_id=CASE WHEN ? IS NOT NULL THEN ? ELSE handler_id END,handled_at=CASE WHEN ? IN ('resolved','closed') THEN NOW() ELSE handled_at END,handling_note=COALESCE(?,handling_note) WHERE id=?", [type||null,content||null,status||null,req.user.role==='store'?null:req.user.id,req.user.role==='store'?null:req.user.id,status||null,note||null,req.params.id]); await log(req, 'update', 'issues', req.params.id, { type,content,status,note }); changed(); res.json((await q('SELECT * FROM issues WHERE id=?',[req.params.id]))[0]); });
app.delete('/api/issues/:id', auth(['store','ops','admin']), verifyActionPassword, async (req,res)=>{const rows=await q('SELECT * FROM issues WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'反馈不存在'});if(req.user.role==='store'&&rows[0].store_id!==req.user.storeId)return res.status(403).json({error:'无权限'});await execSql('DELETE FROM issues WHERE id=?',[req.params.id]);await log(req,'delete','issues',req.params.id);changed();res.json({ok:true});});

function orderStoreId(req, requested) {
  if (req.user.role === 'store') return Number(req.user.storeId);
  if (requested !== undefined && requested !== null && requested !== '' && requested !== 'all') return Number(requested);
  return null;
}
async function categoryForStore(storeId, categoryId) { if (categoryId === undefined || categoryId === null || categoryId === '') return null; const rows=await q('SELECT id FROM ordering_categories WHERE id=? AND store_id=?',[Number(categoryId),Number(storeId)]); return rows[0]?.id||null; }
async function requireOrderStore(req, res, requested, createIfMissing = false) {
  const storeId = orderStoreId(req, requested);
  if (!storeId) { res.status(400).json({ error: '请选择门店' }); return null; }
  const rows = await q("SELECT id,name FROM stores WHERE id=? AND status='active'", [storeId]);
  if (!rows.length) { res.status(404).json({ error: '门店不存在或已停用' }); return null; }
  return rows[0];
}
app.get('/api/ordering/bootstrap', auth(['store','ops','admin']), async (req,res) => {
  const store = await requireOrderStore(req,res,req.query.storeId); if (!store) return;
  const date = String(req.query.date || new Date().toISOString().slice(0,10));
  const categories = await q('SELECT * FROM ordering_categories WHERE store_id=? AND enabled=1 ORDER BY sort_order,id',[store.id]);
  const products = await q('SELECT p.*,c.name AS category_name,c.category_code,c.sort_order AS category_sort FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id WHERE p.store_id=? AND p.enabled=1 ORDER BY COALESCE(c.sort_order,999),c.id,p.sort_order,p.id',[store.id]);
  const tasks = await q('SELECT id,target_value,actual_value,status FROM tasks WHERE store_id=? AND task_date=? LIMIT 1',[store.id,date]);
  const orderRows = await q('SELECT * FROM daily_orders WHERE store_id=? AND order_date=? LIMIT 1',[store.id,date]);
  const order = orderRows[0] || null;
  const items = order ? await q('SELECT * FROM daily_order_items WHERE order_id=? ORDER BY category_name,sort_order,id',[order.id]) : [];
  res.json({store,categories,products,target:tasks[0]||null,order,items});
});
app.get('/api/ordering/categories', auth(['store','ops','admin']), async (req,res)=>{const store=await requireOrderStore(req,res,req.query.storeId);if(!store)return;res.json(await q('SELECT * FROM ordering_categories WHERE store_id=? ORDER BY sort_order,id',[store.id]));});
app.get('/api/ordering/products', auth(['store','ops','admin']), async (req,res)=>{const store=await requireOrderStore(req,res,req.query.storeId);if(!store)return;const include=req.query.includeDisabled==='true';res.json(await q(`SELECT p.*,c.name AS category_name,c.category_code FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id WHERE p.store_id=? ${include?'':'AND p.enabled=1'} ORDER BY COALESCE(c.sort_order,999),p.sort_order,p.id`,[store.id]));});
app.post('/api/ordering/categories', auth(['store','ops','admin']), async (req,res) => { const store=await requireOrderStore(req,res,req.body.storeId); if(!store)return; const name=String(req.body.name||'').trim(); const code=String(req.body.categoryCode||('C'+Date.now())).trim().toUpperCase(); if(!name)return res.status(400).json({error:'分类名称必填'}); try { const r=await execSql('INSERT INTO ordering_categories(store_id,category_code,name,sort_order,enabled) VALUES(?,?,?,?,?)',[store.id,code,name,Number(req.body.sortOrder||0),req.body.enabled!==false]); await log(req,'create','ordering_categories',r.insertId,{storeId:store.id,name}); changed(); res.json((await q('SELECT * FROM ordering_categories WHERE id=?',[r.insertId]))[0]); } catch(e){res.status(400).json({error:e.code==='ER_DUP_ENTRY'?'分类名称或代码已存在':'分类创建失败'})} });
app.patch('/api/ordering/categories/:id', auth(['store','ops','admin']), verifyActionPassword, async (req,res) => { const rows=await q('SELECT * FROM ordering_categories WHERE id=?',[req.params.id]); if(!rows.length)return res.status(404).json({error:'分类不存在'}); if(req.user.role==='store'&&Number(rows[0].store_id)!==Number(req.user.storeId))return res.status(403).json({error:'只能管理本门店分类'}); const {name,categoryCode,sortOrder,enabled}=req.body; await execSql('UPDATE ordering_categories SET name=COALESCE(?,name),category_code=COALESCE(?,category_code),sort_order=COALESCE(?,sort_order),enabled=COALESCE(?,enabled) WHERE id=?',[name?String(name).trim():null,categoryCode?String(categoryCode).trim().toUpperCase():null,sortOrder===undefined?null:Number(sortOrder),enabled===undefined?null:!!enabled,req.params.id]); await log(req,'update','ordering_categories',req.params.id,req.body);changed();res.json((await q('SELECT * FROM ordering_categories WHERE id=?',[req.params.id]))[0]); });
app.delete('/api/ordering/categories/:id', auth(['store','ops','admin']), verifyActionPassword, async (req,res) => { const rows=await q('SELECT * FROM ordering_categories WHERE id=?',[req.params.id]); if(!rows.length)return res.status(404).json({error:'分类不存在'}); if(req.user.role==='store'&&Number(rows[0].store_id)!==Number(req.user.storeId))return res.status(403).json({error:'只能管理本门店分类'}); const used=(await q('SELECT COUNT(*) AS count FROM ordering_products WHERE category_id=? AND enabled=1',[req.params.id]))[0].count; if(Number(used))return res.status(409).json({error:'该分类仍有启用产品，请先移动或停用产品'}); await execSql('UPDATE ordering_categories SET enabled=0 WHERE id=?',[req.params.id]); await log(req,'archive','ordering_categories',req.params.id);changed();res.json({ok:true}); });
app.post('/api/ordering/products/clone', auth(['ops','admin']), async (req,res)=>{const sourceId=Number(req.body.sourceStoreId),targetId=Number(req.body.targetStoreId);if(!sourceId||!targetId||sourceId===targetId)return res.status(400).json({error:'请选择不同的来源和目标门店'});const source=(await q("SELECT id,name FROM stores WHERE id=? AND status='active'",[sourceId]))[0];const target=(await q("SELECT id,name FROM stores WHERE id=? AND status='active'",[targetId]))[0];if(!source||!target)return res.status(404).json({error:'门店不存在或已停用'});const categories=await q('SELECT * FROM ordering_categories WHERE store_id=?',[sourceId]);const map={};for(const c of categories){const r=await execSql('INSERT INTO ordering_categories(store_id,category_code,name,sort_order,enabled) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),name=VALUES(name),sort_order=VALUES(sort_order),enabled=VALUES(enabled)',[targetId,c.category_code,c.name,c.sort_order,c.enabled]);map[c.id]=r.insertId}const products=await q('SELECT * FROM ordering_products WHERE store_id=?',[sourceId]);for(const p of products)await execSql('INSERT INTO ordering_products(store_id,category_id,sku,name,unit,unit_price,sort_order,enabled,note) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),name=VALUES(name),unit=VALUES(unit),unit_price=VALUES(unit_price),sort_order=VALUES(sort_order),enabled=VALUES(enabled),note=VALUES(note)',[targetId,map[p.category_id]||null,p.sku,p.name,p.unit,p.unit_price,p.sort_order,p.enabled,p.note]);await log(req,'clone','ordering_products',targetId,{sourceStoreId:sourceId,productCount:products.length});changed();res.json({ok:true,source:source.name,target:target.name,count:products.length});});
app.post('/api/ordering/products', auth(['store','ops','admin']), async (req,res) => { const store=await requireOrderStore(req,res,req.body.storeId);if(!store)return;const name=String(req.body.name||'').trim(),sku=String(req.body.sku||'').trim(),unitPrice=Number(req.body.unitPrice||0);if(!name||!sku)return res.status(400).json({error:'产品名称和 SKU 必填'});if(!Number.isFinite(unitPrice)||unitPrice<0)return res.status(400).json({error:'单价不能为负数'});const categoryId=await categoryForStore(store.id,req.body.categoryId);if(req.body.categoryId&&categoryId===null)return res.status(400).json({error:'分类不属于当前门店'});try{const r=await execSql('INSERT INTO ordering_products(store_id,category_id,sku,name,unit,unit_price,sort_order,enabled,note) VALUES(?,?,?,?,?,?,?,?,?)',[store.id,categoryId,sku,name,String(req.body.unit||'个'),unitPrice,Number(req.body.sortOrder||0),req.body.enabled!==false,String(req.body.note||'')]);await log(req,'create','ordering_products',r.insertId,{storeId:store.id,sku,name});changed();res.json((await q('SELECT p.*,c.name AS category_name FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id WHERE p.id=?',[r.insertId]))[0]);}catch(e){res.status(400).json({error:e.code==='ER_DUP_ENTRY'?'该 SKU 已存在':'产品创建失败'})}});
app.get('/api/ordering/products/export.xlsx', authQuery(['store','ops','admin']), async (req,res) => {
  const store = await requireOrderStore(req,res,req.query.storeId);
  if (!store) return;
  const rows = await q(`SELECT p.sku,p.name,c.category_code,c.name AS category_name,p.unit,p.unit_price,p.sort_order,p.enabled,p.note
    FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id
    WHERE p.store_id=? ORDER BY COALESCE(c.sort_order,999),p.sort_order,p.id`, [store.id]);
  const data = rows.map(p => ({
    'SKU': p.sku, '产品名称': p.name, '分类编码': p.category_code || '', '产品分类': p.category_name || '',
    '单位': p.unit || '个', '单价': Number(p.unit_price || 0), '排序': Number(p.sort_order || 0),
    '启用状态': Number(p.enabled) ? '启用' : '停用', '备注': p.note || ''
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:22},{wch:12},{wch:18},{wch:10},{wch:12},{wch:8},{wch:10},{wch:28}];
  XLSX.utils.book_append_sheet(wb, ws, '产品模板');
  const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename=oneira-products-${store.id}.xlsx`);
  res.send(buffer);
});

app.put('/api/ordering/products/batch', auth(['store','ops','admin']), async (req,res) => {
  const store = await requireOrderStore(req,res,req.body.storeId);
  if (!store) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({error:'没有需要保存的产品修改'});
  const ids = items.map(x => Number(x.id)).filter(Number.isInteger);
  if (ids.length !== items.length || new Set(ids).size !== ids.length) return res.status(400).json({error:'产品列表中存在重复或无效 ID'});
  const placeholders = ids.map(() => '?').join(',');
  const existing = await q(`SELECT * FROM ordering_products WHERE store_id=? AND id IN (${placeholders})`, [store.id, ...ids]);
  if (existing.length !== items.length) return res.status(403).json({error:'只能修改当前门店的产品'});
  const byId = Object.fromEntries(existing.map(x => [Number(x.id), x]));
  const categories = await q('SELECT id FROM ordering_categories WHERE store_id=?', [store.id]);
  const categoryIds = new Set(categories.map(x => Number(x.id)));
  const seen = new Set();
  const normalized = [];
  for (const [index,item] of items.entries()) {
    const id = Number(item.id), old = byId[id];
    const sku = String(item.sku ?? '').trim(), name = String(item.name ?? '').trim(), unit = String(item.unit ?? '个').trim() || '个';
    const price = Number(item.unitPrice);
    const categoryId = item.categoryId === null || item.categoryId === '' || item.categoryId === undefined ? null : Number(item.categoryId);
    if (!sku || !name) return res.status(400).json({error:`第 ${index + 1} 行 SKU 和产品名称必填`});
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({error:`${name} 的单价必须是非负数字`});
    if (categoryId !== null && !categoryIds.has(categoryId)) return res.status(400).json({error:`${name} 的分类不属于当前门店`});
    const key = sku.toLowerCase();
    if (seen.has(key)) return res.status(400).json({error:`SKU ${sku} 在本次修改中重复`});
    seen.add(key);
    normalized.push({id,sku,name,unit,price,categoryId,sortOrder:item.sortOrder===undefined?old.sort_order:Number(item.sortOrder),enabled:item.enabled===undefined?!!old.enabled:!!item.enabled,note:item.note===undefined?String(old.note||''):String(item.note||'')});
  }
  const other = await q(`SELECT id,sku FROM ordering_products WHERE store_id=? AND id NOT IN (${placeholders})`, [store.id, ...ids]);
  const otherSkus = new Map(other.map(x => [String(x.sku).toLowerCase(), x]));
  for (const item of normalized) if (otherSkus.has(item.sku.toLowerCase())) return res.status(400).json({error:`SKU ${item.sku} 已被当前门店其他产品使用`});
  try {
    await inTransaction(async ({exec}) => {
      for (const item of normalized) {
        const result = await exec(`UPDATE ordering_products SET category_id=?,sku=?,name=?,unit=?,unit_price=?,sort_order=?,enabled=?,note=? WHERE id=? AND store_id=?`, [item.categoryId,item.sku,item.name,item.unit,item.price,item.sortOrder,item.enabled,item.note,item.id,store.id]);
        if (result.affectedRows !== 1) throw Error('产品在保存期间发生变化');
      }
    });
  } catch (e) { return res.status(400).json({error:e.code==='ER_DUP_ENTRY'?'SKU 已存在，未保存任何修改':'批量保存失败，未保存任何修改'}); }
  try { await log(req,'batch_update','ordering_products',`store:${store.id}`,{storeId:store.id,count:normalized.length,ids}); } catch (e) { console.error('batch product audit log failed', e); }
  changed();
  res.json({ok:true,count:normalized.length,products:await q(`SELECT p.*,c.name AS category_name,c.category_code FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id WHERE p.store_id=? ORDER BY COALESCE(c.sort_order,999),p.sort_order,p.id`,[store.id])});
});

app.post('/api/ordering/products/import-xlsx', auth(['store','ops','admin']), async (req,res) => {
  const store = await requireOrderStore(req,res,req.body.storeId);
  if (!store) return;
  const encoded = String(req.body.fileBase64 || '').replace(/^data:.*?;base64,/, '');
  if (!encoded) return res.status(400).json({error:'没有收到 Excel 文件'});
  let rows;
  try {
    const workbook = XLSX.read(Buffer.from(encoded,'base64'), {type:'buffer', cellDates:false});
    const first = workbook.SheetNames[0];
    if (!first) throw Error('Excel 没有工作表');
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[first], {defval:'', raw:false});
  } catch (e) { return res.status(400).json({error:'Excel 无法读取，请使用 .xlsx 或 .xls 文件'}); }
  if (!rows.length) return res.status(400).json({error:'Excel 中没有产品数据'});
  const categories = await q('SELECT id,category_code,name FROM ordering_categories WHERE store_id=?', [store.id]);
  const byCode = new Map(categories.map(x => [String(x.category_code||'').trim().toLowerCase(), x]));
  const byName = new Map(categories.map(x => [String(x.name||'').trim().toLowerCase(), x]));
  const existing = await q('SELECT * FROM ordering_products WHERE store_id=?', [store.id]);
  const bySku = new Map(existing.map(x => [String(x.sku||'').trim().toLowerCase(), x]));
  const seen = new Set(), valid = [], errors = [];
  const pick = (row, names) => { for (const name of names) if (row[name] !== undefined && String(row[name]).trim() !== '') return row[name]; return ''; };
  for (const [i,row] of rows.entries()) {
    const line = i + 2, sku = String(pick(row,['SKU','sku','产品SKU'])).trim(), name = String(pick(row,['产品名称','产品名','name','名称'])).trim();
    const categoryCode = String(pick(row,['分类编码','categoryCode','分类代码'])).trim();
    const categoryName = String(pick(row,['产品分类','分类名称','categoryName'])).trim();
    const unit = String(pick(row,['单位','unit']) || '个').trim() || '个';
    const rawPrice = pick(row,['单价','unitPrice','价格']);
    const price = Number(String(rawPrice).replace(/[,￥¥\s]/g,''));
    const sortOrder = Number(pick(row,['排序','sortOrder']) || i + 1);
    const enabledRaw = String(pick(row,['启用状态','enabled','状态'])).trim().toLowerCase();
    const enabled = enabledRaw ? !['停用','禁用','否','0','false','disabled'].includes(enabledRaw) : true;
    const note = String(pick(row,['备注','note']));
    if (!sku || !name) { errors.push({line,message:'SKU 和产品名称必填'}); continue; }
    if (!Number.isFinite(price) || price < 0) { errors.push({line,message:'单价必须是非负数字'}); continue; }
    const key = sku.toLowerCase();
    if (seen.has(key)) { errors.push({line,message:`SKU ${sku} 在 Excel 中重复`}); continue; }
    seen.add(key);
    const category = categoryCode ? byCode.get(categoryCode.toLowerCase()) : (categoryName ? byName.get(categoryName.toLowerCase()) : null);
    if ((categoryCode || categoryName) && !category) { errors.push({line,message:`分类 ${categoryCode || categoryName} 不属于当前门店`}); continue; }
    valid.push({sku,name,categoryId:category?.id||null,unit,unitPrice:price,sortOrder:Number.isFinite(sortOrder)?sortOrder:i+1,enabled,note,old:bySku.get(key)||null,line});
  }
  const duplicates = valid.filter(x => bySku.has(x.sku.toLowerCase()) && String(bySku.get(x.sku.toLowerCase()).sku).toLowerCase() !== x.sku.toLowerCase());
  if (duplicates.length) for (const x of duplicates) errors.push({line:x.line,message:`SKU ${x.sku} 与现有产品冲突`});
  const dedupValid = valid.filter(x => !duplicates.includes(x));
  const compare = (x) => { const o=x.old; if(!o)return 'created'; return Number(o.category_id||0)===Number(x.categoryId||0)&&String(o.sku)===x.sku&&String(o.name)===x.name&&String(o.unit)===x.unit&&Number(o.unit_price)===Number(x.unitPrice)&&Number(o.sort_order)===Number(x.sortOrder)&&!!o.enabled===!!x.enabled&&String(o.note||'')===String(x.note||'')?'unchanged':'updated'; };
  const counts = dedupValid.reduce((a,x)=>(a[compare(x)]++,a),{created:0,updated:0,unchanged:0});
  if (req.body.preview !== true) {
    if (errors.length) return res.status(400).json({error:'Excel 存在异常行，请修正后重新导入',errors,counts,validCount:dedupValid.length});
    try {
      await inTransaction(async ({exec}) => {
        for (const x of dedupValid) await exec(`INSERT INTO ordering_products(store_id,category_id,sku,name,unit,unit_price,sort_order,enabled,note) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),name=VALUES(name),unit=VALUES(unit),unit_price=VALUES(unit_price),sort_order=VALUES(sort_order),enabled=VALUES(enabled),note=VALUES(note)`,[store.id,x.categoryId,x.sku,x.name,x.unit,x.unitPrice,x.sortOrder,x.enabled,x.note]);
        await exec('INSERT INTO ordering_imports(store_id,source_name,row_count,summary,imported_by) VALUES(?,?,?,?,?)',[store.id,String(req.body.sourceName||'Excel 产品模板'),rows.length,JSON.stringify({...counts,errorCount:errors.length,mode:'incremental'}),req.user.id||null]);
      });
    } catch (e) { return res.status(400).json({error:e.code==='ER_DUP_ENTRY'?'SKU 重复，未导入任何数据':'Excel 导入失败，未导入任何数据'}); }
    try { await log(req,'import','ordering_products','xlsx',{storeId:store.id,rowCount:rows.length,...counts,errorCount:errors.length}); } catch (e) { console.error('xlsx product audit log failed', e); }
    changed();
  }
  res.json({ok:true,preview:req.body.preview===true,rows:rows.length,validCount:dedupValid.length,errors,counts,storeId:store.id});
});

app.patch('/api/ordering/products/:id', auth(['store','ops','admin']), verifyActionPassword, async (req,res) => {const rows=await q('SELECT * FROM ordering_products WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'产品不存在'});if(req.user.role==='store'&&Number(rows[0].store_id)!==Number(req.user.storeId))return res.status(403).json({error:'只能管理本门店产品'});const b=req.body;const categoryId=await categoryForStore(rows[0].store_id,b.categoryId===undefined?rows[0].category_id:b.categoryId);if(b.categoryId!==undefined&&categoryId===null)return res.status(400).json({error:'分类不属于当前门店'});if(b.unitPrice!==undefined&&(Number(b.unitPrice)<0||!Number.isFinite(Number(b.unitPrice))))return res.status(400).json({error:'单价不能为负数'});await execSql('UPDATE ordering_products SET category_id=?,sku=COALESCE(?,sku),name=COALESCE(?,name),unit=COALESCE(?,unit),unit_price=COALESCE(?,unit_price),sort_order=COALESCE(?,sort_order),enabled=COALESCE(?,enabled),note=COALESCE(?,note) WHERE id=?',[categoryId,b.sku?String(b.sku).trim():null,b.name?String(b.name).trim():null,b.unit?String(b.unit):null,b.unitPrice===undefined?null:Number(b.unitPrice),b.sortOrder===undefined?null:Number(b.sortOrder),b.enabled===undefined?null:!!b.enabled,b.note===undefined?null:String(b.note),req.params.id]);await log(req,'update','ordering_products',req.params.id,b);changed();res.json((await q('SELECT p.*,c.name AS category_name FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id WHERE p.id=?',[req.params.id]))[0]);});
app.delete('/api/ordering/products/:id', auth(['store','ops','admin']), verifyActionPassword, async (req,res) => {const rows=await q('SELECT * FROM ordering_products WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'产品不存在'});if(req.user.role==='store'&&Number(rows[0].store_id)!==Number(req.user.storeId))return res.status(403).json({error:'只能管理本门店产品'});await execSql('UPDATE ordering_products SET enabled=0 WHERE id=?',[req.params.id]);await log(req,'archive','ordering_products',req.params.id);changed();res.json({ok:true});});
app.post('/api/ordering/products/import', auth(['store','ops','admin']), async (req,res) => {
  const store = await requireOrderStore(req,res,req.body.storeId); if (!store) return;
  const products = Array.isArray(req.body.products) ? req.body.products : [];
  if (!products.length) return res.status(400).json({error:'没有可导入的产品'});
  const categories = await q('SELECT id,category_code FROM ordering_categories WHERE store_id=?',[store.id]);
  const byCode = new Map(categories.map(x => [String(x.category_code||'').toLowerCase(), Number(x.id)]));
  const categoryIds = new Set(categories.map(x => Number(x.id))), seen = new Set(), rows = [];
  for (const [i,p] of products.entries()) {
    const sku=String(p.sku||'').trim(), name=String(p.name||'').trim(), price=Number(p.unitPrice||0);
    let categoryId = p.categoryId===undefined || p.categoryId===null || p.categoryId==='' ? (p.categoryCode ? byCode.get(String(p.categoryCode).trim().toLowerCase()) ?? null : null) : Number(p.categoryId);
    if (!sku || !name) return res.status(400).json({error:`第 ${i+1} 行 SKU 和产品名称必填`});
    if (!Number.isFinite(price) || price<0) return res.status(400).json({error:`第 ${i+1} 行单价不能为负数`});
    if (categoryId!==null && !categoryIds.has(categoryId)) return res.status(400).json({error:`第 ${i+1} 行分类不属于当前门店`});
    if (seen.has(sku.toLowerCase())) return res.status(400).json({error:`SKU ${sku} 在导入内容中重复`});
    seen.add(sku.toLowerCase());
    rows.push([store.id,categoryId,sku,name,String(p.unit||'个'),price,Number(p.sortOrder||i+1),p.enabled!==false,String(p.note||'')]);
  }
  try {
    await inTransaction(async ({exec}) => {
      for (const row of rows) await exec('INSERT INTO ordering_products(store_id,category_id,sku,name,unit,unit_price,sort_order,enabled,note) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),name=VALUES(name),unit=VALUES(unit),unit_price=VALUES(unit_price),sort_order=VALUES(sort_order),enabled=VALUES(enabled),note=VALUES(note)',row);
      await exec('INSERT INTO ordering_imports(store_id,source_name,row_count,summary,imported_by) VALUES(?,?,?,?,?)',[store.id,String(req.body.sourceName||'产品批量导入'),rows.length,JSON.stringify({count:rows.length,mode:'incremental'}),req.user.id||null]);
    });
  } catch (e) { return res.status(400).json({error:e.code==='ER_DUP_ENTRY'?'SKU 重复，未导入任何数据':'产品导入失败，未导入任何数据'}); }
  try { await log(req,'import','ordering_products','batch',{storeId:store.id,count:rows.length}); } catch (e) { console.error('legacy product audit log failed', e); }
  changed(); res.json({ok:true,count:rows.length});
});
app.get('/api/ordering/orders', auth(['store','ops','admin']), async (req,res)=>{const month=String(req.query.month||new Date().toISOString().slice(0,7));if(req.query.storeId==='all'&&req.user.role!=='store'){return res.json(await q('SELECT o.*,s.name AS store_name FROM daily_orders o JOIN stores s ON s.id=o.store_id WHERE DATE_FORMAT(o.order_date,\'%Y-%m\')=? ORDER BY o.order_date DESC',[month]))}const store=await requireOrderStore(req,res,req.query.storeId);if(!store)return;res.json(await q('SELECT o.*,s.name AS store_name FROM daily_orders o JOIN stores s ON s.id=o.store_id WHERE o.store_id=? AND DATE_FORMAT(o.order_date,\'%Y-%m\')=? ORDER BY o.order_date DESC',[store.id,month]));});
app.get('/api/ordering/print', authQuery(['store','ops','admin']), async (req,res)=>{const store=await requireOrderStore(req,res,req.query.storeId);if(!store)return;const categoryRows=await q('SELECT name,sort_order FROM ordering_categories WHERE store_id=? AND enabled=1 ORDER BY sort_order,id',[store.id]);const categoryOrder=new Map(categoryRows.map((x,i)=>[String(x.name),Number(x.sort_order??i)]));const dates=String(req.query.dates||'').split(',').map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));if(!dates.length)return res.status(400).send('请选择打印日期');const escHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const orders=await q('SELECT o.*,s.name AS store_name FROM daily_orders o JOIN stores s ON s.id=o.store_id WHERE o.store_id=? AND o.order_date IN ('+dates.map(()=>'?').join(',')+') ORDER BY o.order_date',[store.id,...dates]);const orderByDate=new Map(orders.map(x=>[String(x.order_date).slice(0,10),x]));const orderIds=orders.map(x=>x.id);const items=orderIds.length?await q('SELECT * FROM daily_order_items WHERE order_id IN ('+orderIds.map(()=>'?').join(',')+') ORDER BY category_name,sort_order,id',orderIds):[];const itemByOrder=new Map();for(const item of items){if(!itemByOrder.has(item.order_id))itemByOrder.set(item.order_id,[]);itemByOrder.get(item.order_id).push(item)}const groups=new Map();for(const date of dates){const order=orderByDate.get(date);for(const item of (order?itemByOrder.get(order.id)||[]:[])){const key=String(item.category_name||'其他')+'\\u0000'+String(item.sku||item.product_name);if(!groups.has(key))groups.set(key,{category:item.category_name||'其他',sku:item.sku||'',name:item.product_name||'',unit:item.unit||'',prices:[],qty:{}});const row=groups.get(key);row.qty[date]=(row.qty[date]||0)+Number(item.quantity||0);row.prices.push(Number(item.unit_price||0))}}const categories={};for(const row of groups.values())(categories[row.category]??=[]).push(row);const palette=['#7657d9','#0f8b8d','#d26a2e','#d34f73','#4b70c8','#6d8b34','#9b59b6','#b8871c'];const dateWidth=dates.length>8?58:72;const weekNames=['日','一','二','三','四','五','六'];const dateLabel=d=>`${d.slice(5)} 周${weekNames[new Date(d+'T00:00:00').getDay()]}`;const colHead=dates.map(d=>`<th class="date">${escHtml(dateLabel(d))}<small>${orderByDate.has(d)?(orderByDate.get(d).status==='submitted'?'已提交':'草稿'):'无报货'}</small></th>`).join('');const tables=Object.entries(categories).sort(([a],[b])=>(categoryOrder.get(a)??9999)-(categoryOrder.get(b)??9999)||a.localeCompare(b,'zh-CN')).map(([category,list],catIndex)=>`<section class="category cat-${catIndex%palette.length}"><h2 style="border-left-color:${palette[catIndex%palette.length]};background:#f3efff"><i style="background:${palette[catIndex%palette.length]}"></i>${escHtml(category)}<span>${list.length} 个产品</span></h2><table><thead><tr><th class="product">产品 / SKU</th><th class="unit">单位</th>${colHead}<th>合计</th></tr></thead><tbody>${list.sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN')).map(row=>{const total=dates.reduce((n,d)=>n+Number(row.qty[d]||0),0);return `<tr><td class="product"><b>${escHtml(row.name)}</b><small>${escHtml(row.sku)} · ¥${(row.prices[0]||0).toFixed(2)}</small></td><td>${escHtml(row.unit)}</td>${dates.map(d=>`<td class="date qty">${row.qty[d]?row.qty[d]:''}</td>`).join('')}<td class="qty total">${total||''}</td></tr>`}).join('')}</tbody></table></section>`).join('');const summary=dates.map(d=>{const o=orderByDate.get(d);return `<span><b>${escHtml(dateLabel(d))}</b> ${o?`¥${Number(o.total_amount||0).toFixed(0)}`:'—'}</span>`}).join('');res.type('html').send(`<!doctype html><meta charset="utf-8"><title>${escHtml(store.name)} 多日期后厨出货表</title><style>@page{size:A4 landscape;margin:6mm}*{box-sizing:border-box}body{font-family:Arial,'Microsoft YaHei',sans-serif;margin:0;color:#17191d;font-size:9px;line-height:1.3}h1{font-size:18px;margin:0 0 2px;letter-spacing:.02em}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #222;padding-bottom:4px;margin-bottom:4px}header p{margin:0;color:#555;font-size:7px}.summary{display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 7px;color:#444;font-size:9px}.summary span{white-space:nowrap}.print-sheet{width:1123px;min-height:794px;padding:20px 24px;background:#fff}.toolbar{display:flex;gap:8px;margin-top:10px}.toolbar button{border:1px solid #7657d9;background:#7657d9;color:#fff;border-radius:6px;padding:7px 12px;cursor:pointer}.toolbar button:first-child{background:#fff;color:#333;border-color:#999}.category{margin:0 0 5px;break-inside:avoid}.category h2{font-size:12px;margin:3px 0 2px;padding:2px 4px;background:#f3efff;border-left:4px solid #7657d9;color:#202127}.category h2 i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px}.category h2 span{font-weight:400;color:#666;margin-left:8px;font-size:9px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #999;padding:4px 5px;text-align:center;height:23px;overflow:hidden;white-space:nowrap}th{background:#f2f0f7;font-weight:700}th small{display:block;font-size:7px;font-weight:400;color:#666}.product{width:300px;text-align:left}.unit{width:48px}.date{width:${dateWidth}px;min-width:${dateWidth}px}.product b,.product small{display:block;overflow:hidden;text-overflow:ellipsis}.product small{font-size:7px;color:#666}.qty{font-size:11px;font-weight:700}.total{background:#faf7ff}.empty{padding:12px;border:1px solid #bbb;text-align:center;color:#666}@media print{button{display:none}.print-sheet{width:auto;min-height:0;padding:0}.category{break-inside:avoid}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}button{margin-top:10px;padding:6px 12px}</style><style>.print-sheet{width:1123px;min-height:794px;padding:24px 28px;background:#fff}.toolbar{display:flex;gap:8px;margin-top:10px}.toolbar button{border:1px solid #7657d9;background:#7657d9;color:#fff;border-radius:6px;padding:7px 12px;cursor:pointer}.toolbar button:first-child{background:#fff;color:#333;border-color:#999}@media print{button{display:none}.print-sheet{width:auto;min-height:0;padding:0}}</style><script src="/vendor/html2canvas.min.js"></script><div class="print-sheet"><header><div><h1>${escHtml(store.name)} · 多日期后厨出货表</h1><p>产品按分类汇总；横向日期列用于快速核对不同日期出货量</p></div><p>打印日期：${escHtml(dates.join('、'))}</p></header><div class="summary">${summary}</div>${tables||'<div class="empty">所选日期没有报货明细</div>'}</div><div class="toolbar"><button onclick="window.print()">打印</button><button id="saveImage" onclick="saveAsImage(this)">保存为 A4 高清图片</button></div><script>async function saveAsImage(button){if(!window.html2canvas)return alert("图片导出组件正在加载，请稍后再试");button.disabled=true;button.textContent="正在生成高清图片…";try{const canvas=await html2canvas(document.querySelector(".print-sheet"),{scale:3,backgroundColor:"#fff",useCORS:true,logging:false,windowWidth:1123});const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error("image")),"image/png"));const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="oneira-orders-${dates[0]}-${dates[dates.length-1]}.png";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){alert("图片生成失败，请重试")}finally{button.disabled=false;button.textContent="保存为 A4 高清图片"}}</script>`)});
app.get('/api/ordering/orders/:date/print', authQuery(['store','ops','admin']), async (req,res)=>{const store=await requireOrderStore(req,res,req.query.storeId);if(!store)return;const weekNames=['日','一','二','三','四','五','六'];const dateWithWeek=`${req.params.date} 周${weekNames[new Date(req.params.date+'T00:00:00').getDay()]}`;const rows=await q('SELECT o.*,s.name AS store_name FROM daily_orders o JOIN stores s ON s.id=o.store_id WHERE o.store_id=? AND o.order_date=?',[store.id,req.params.date]);if(!rows.length)return res.status(404).send('报货单不存在');const items=await q('SELECT * FROM daily_order_items WHERE order_id=? ORDER BY category_name,sort_order,id',[rows[0].id]);const groups={};for(const x of items)(groups[x.category_name]??=[]).push(x);const escHtml=x=>String(x??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));let body=Object.entries(groups).map(([cat,list])=>`<h2>${escHtml(cat)}</h2><table><tr><th>SKU</th><th>产品</th><th>单位</th><th>数量</th><th>金额</th></tr>${list.map(x=>`<tr><td>${escHtml(x.sku)}</td><td>${escHtml(x.product_name)}</td><td>${escHtml(x.unit)}</td><td>${x.quantity}</td><td>¥${Number(x.amount).toFixed(2)}</td></tr>`).join('')}</table>`).join('');res.type('html').send(`<!doctype html><meta charset=\"utf-8\"><title>${escHtml(store.name)} ${dateWithWeek} 报货单</title><style>body{font-family:Arial,'Microsoft YaHei',sans-serif;margin:28px;color:#17191d}h1{margin-bottom:4px}h2{margin:24px 0 8px;border-bottom:2px solid #7657d9;padding-bottom:5px}table{width:100%;border-collapse:collapse;margin-bottom:14px}th,td{padding:8px;border:1px solid #d9d7e5;text-align:left}th{background:#ebe5ff}@media print{button{display:none}}</style><script src="/vendor/html2canvas.min.js"></script><div class="print-sheet"><h1>${escHtml(store.name)} · ${escHtml(dateWithWeek)} 报货单</h1><p>状态：${rows[0].status==='submitted'?'已提交':'草稿'}　总数量：${rows[0].total_quantity}　报货总金额：¥${Number(rows[0].total_amount).toFixed(2)}</p>${body}</div><div class="toolbar"><button onclick="window.print()">打印</button><button onclick="saveAsImage(this)">保存为 A4 高清图片</button></div><script>async function saveAsImage(button){if(!window.html2canvas)return alert("图片导出组件正在加载，请稍后再试");button.disabled=true;button.textContent="正在生成高清图片…";try{const canvas=await html2canvas(document.querySelector(".print-sheet"),{scale:3,backgroundColor:"#fff",useCORS:true,logging:false,windowWidth:1123});const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error("image")),"image/png"));const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="oneira-order-${req.params.date}.png";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(e){alert("图片生成失败，请重试")}finally{button.disabled=false;button.textContent="保存为 A4 高清图片"}}</script>`);});
app.get('/api/ordering/orders/:date', auth(['store','ops','admin']), async (req,res)=>{const store=await requireOrderStore(req,res,req.query.storeId);if(!store)return;const rows=await q('SELECT o.*,s.name AS store_name FROM daily_orders o JOIN stores s ON s.id=o.store_id WHERE o.store_id=? AND o.order_date=?',[store.id,req.params.date]);if(!rows.length)return res.json({order:null,items:[]});res.json({order:rows[0],items:await q('SELECT * FROM daily_order_items WHERE order_id=? ORDER BY category_name,sort_order,id',[rows[0].id])});});
app.put('/api/ordering/orders/:date', auth(['store','ops','admin']), async (req,res)=>{
  const store=await requireOrderStore(req,res,req.body.storeId); if(!store)return;
  const date=req.params.date;
  const existingRow=(await q('SELECT * FROM daily_orders WHERE store_id=? AND order_date=?',[store.id,date]))[0]||null;
  const existingItems=existingRow?await q('SELECT * FROM daily_order_items WHERE order_id=? ORDER BY category_name,sort_order,id',[existingRow.id]):[];
  const oldByProduct=new Map(existingItems.map(x=>[Number(x.product_id),x]));
  const products=await q("SELECT p.*,COALESCE(c.name,'其他') AS category_name FROM ordering_products p LEFT JOIN ordering_categories c ON c.id=p.category_id WHERE p.store_id=? AND p.enabled=1",[store.id]);
  const incoming=Array.isArray(req.body.items)?req.body.items:[], byId=new Map(incoming.map(x=>[Number(x.productId),Number(x.quantity||0)]));
  const target=Number(req.body.targetValue||0), status=req.body.status==='submitted'?'submitted':'draft';
  let totalQty=0,totalAmount=0; const items=[], currentIds=new Set();
  for(const p of products){
    currentIds.add(Number(p.id)); const quantity=Number(byId.get(Number(p.id))||0);
    if(!Number.isFinite(quantity)||quantity<0)return res.status(400).json({error:'产品数量必须是非负数字'});
    if(quantity<=0)continue;
    const old=oldByProduct.get(Number(p.id));
    const snapshot=old||{sku:p.sku,product_name:p.name,category_name:p.category_name,unit:p.unit,unit_price:p.unit_price,sort_order:p.sort_order};
    const unitPrice=Number(snapshot.unit_price||0), amount=quantity*unitPrice; totalQty+=quantity; totalAmount+=amount;
    items.push([p.id,snapshot.sku,snapshot.product_name,snapshot.category_name,snapshot.unit,snapshot.unit_price,quantity,amount,snapshot.sort_order]);
  }
  for(const old of existingItems){
    if(currentIds.has(Number(old.product_id))||Number(old.quantity||0)<=0)continue;
    totalQty+=Number(old.quantity||0); totalAmount+=Number(old.amount||0);
    items.push([old.product_id,old.sku,old.product_name,old.category_name,old.unit,old.unit_price,old.quantity,old.amount,old.sort_order]);
  }
  let orderId;
  try {
    orderId=await inTransaction(async({q:tq,exec})=>{
      const locked=(await tq('SELECT id FROM daily_orders WHERE store_id=? AND order_date=? FOR UPDATE',[store.id,date]))[0]; let id;
      if(locked){id=locked.id;await exec("UPDATE daily_orders SET target_value=?,status=?,total_quantity=?,total_amount=?,submitted_by=?,submitted_by_name=?,submitted_at=IF(?='submitted',NOW(),submitted_at) WHERE id=?",[target,status,totalQty,totalAmount,req.user.id||null,req.user.name,status,id]);await exec('DELETE FROM daily_order_items WHERE order_id=?',[id]);}
      else{id=(await exec("INSERT INTO daily_orders(store_id,order_date,target_value,status,total_quantity,total_amount,created_by,submitted_by,submitted_by_name,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,IF(?='submitted',NOW(),NULL))",[store.id,date,target,status,totalQty,totalAmount,req.user.id||null,req.user.id||null,req.user.name,status])).insertId;}
      for(const item of items)await exec('INSERT INTO daily_order_items(order_id,product_id,sku,product_name,category_name,unit,unit_price,quantity,amount,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,...item]); return {id,updated:!!locked};
    });
  } catch(e){return res.status(400).json({error:'报货保存失败，未保存任何修改'});}
  try { await log(req,orderId.updated?'update':'create','daily_orders',orderId.id,{storeId:store.id,date,status,totalQty,totalAmount}); } catch(e){ console.error('order audit log failed',e); }
  changed(); res.json({order:(await q('SELECT * FROM daily_orders WHERE id=?',[orderId.id]))[0],items:await q('SELECT * FROM daily_order_items WHERE order_id=? ORDER BY category_name,sort_order,id',[orderId.id])});
});
app.delete('/api/ordering/orders/:date', auth(['store','ops','admin']), verifyActionPassword, async (req,res)=>{const store=await requireOrderStore(req,res,req.body?.storeId||req.query.storeId);if(!store)return;const rows=await q('SELECT id FROM daily_orders WHERE store_id=? AND order_date=?',[store.id,req.params.date]);if(!rows.length)return res.status(404).json({error:'报货单不存在'});await execSql('DELETE FROM daily_orders WHERE id=?',[rows[0].id]);await log(req,'delete','daily_orders',rows[0].id,{storeId:store.id,date:req.params.date});changed();res.json({ok:true});});

app.get('/api/audit', auth(['admin']), async (req, res) => { res.set('Cache-Control', 'no-store'); const limit=Math.min(Math.max(Number(req.query.limit||5000),1),5000); res.json(await q(`SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ${limit}`)); });
async function removeAuditLogs(req,res){ const ids=Array.isArray(req.body?.ids)?[...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0,5000):[]; const before=String(req.body?.before||'').trim(); let deleted=0; if(ids.length){ const result=await execSql(`DELETE FROM audit_logs WHERE id IN (${ids.map(()=>'?').join(',')})`,ids); deleted=result.affectedRows||0; } else if(/^\d{4}-\d{2}-\d{2}$/.test(before)){ const result=await execSql('DELETE FROM audit_logs WHERE created_at < ?', [before+' 00:00:00']); deleted=result.affectedRows||0; } else return res.status(400).json({error:'请选择要删除的日志或指定日期'}); res.json({ok:true,deleted}); }
app.delete('/api/audit', auth(['admin']), verifyActionPassword, removeAuditLogs);
// POST aliases are intentional: some embedded mobile webviews/proxies strip DELETE request bodies.
app.post('/api/audit/bulk-delete', auth(['admin']), verifyActionPassword, removeAuditLogs);
app.post('/api/audit/cleanup', auth(['admin']), verifyActionPassword, removeAuditLogs);
app.get('/api/export/ordering.csv', async (req,res)=>{let identity;try{identity=jwt.verify(req.query.token||'',secret());if(!['store','ops','admin'].includes(identity.role))throw new Error('forbidden')}catch{return res.status(401).json({error:'登录已失效'})}const month=String(req.query.month||new Date().toISOString().slice(0,7));const sid=identity.role==='store'?Number(identity.storeId):Number(req.query.storeId||0);if(!sid)return res.status(400).json({error:'缺少门店'});const rows=await q('SELECT o.order_date,s.name AS store_name,o.status,i.sku,i.product_name,i.category_name,i.unit,i.quantity,i.unit_price,i.amount FROM daily_orders o JOIN stores s ON s.id=o.store_id JOIN daily_order_items i ON i.order_id=o.id WHERE o.store_id=? AND DATE_FORMAT(o.order_date,\'%Y-%m\')=? ORDER BY o.order_date,i.category_name,i.sort_order',[sid,month]);const lines=['日期,门店,状态,分类,SKU,产品,单位,数量,单价,金额'];for(const r of rows)lines.push([r.order_date,r.store_name,r.status==='submitted'?'已提交':'草稿',r.category_name,r.sku,r.product_name,r.unit,r.quantity,r.unit_price,r.amount].map(x=>'\"'+String(x??'').replaceAll('\"','\"\"')+'\"').join(','));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename=\"oneira-ordering-${month}.csv\"`);res.send('\ufeff'+lines.join('\n'));});
app.get('/api/export/reports.csv', async (req, res) => { let identity; try { identity = jwt.verify(req.query.token || '', secret()); if (!['store','ops', 'admin'].includes(identity.role)) throw new Error('forbidden'); } catch { return res.status(401).json({ error: '登录已失效' }); } const month = req.query.month || new Date().toISOString().slice(0, 7); const storeClause=identity.role==='store'?' AND r.store_id=?':''; const rows = await q("SELECT r.report_date,s.name AS store_name,r.payload,COALESCE(r.submitted_by_name,u.name) AS submitter_name FROM daily_reports r JOIN stores s ON s.id=r.store_id LEFT JOIN users u ON u.id=r.submitted_by WHERE DATE_FORMAT(r.report_date,'%Y-%m')=?"+storeClause+" ORDER BY r.report_date,s.id", identity.role==='store'?[month,identity.storeId]:[month]); const lines = ['日期,门店,总营业额,优惠折扣,实收金额,平台收入,会员卡消费,会员卡充值,现金,到店微信支付宝云闪付,试吃数量,报损数量,试吃金额,试吃占比,报损金额,报损占比,会员实体卡余量,提交人']; for (const r of rows) { const p = json(r.payload); lines.push([r.report_date, r.store_name, p.totalRevenue ?? p.revenue ?? '', p.discounts ?? '', p.received ?? '', p.platformTotal ?? '', p.memberCardConsumption ?? '', p.memberCardRecharge ?? '', p.cash ?? '', p.onsiteDigital ?? '', p.trialCount ?? '', p.wasteCount ?? '', p.trialAmount ?? '', p.trialRatio ?? '', p.wasteAmount ?? '', p.wasteRatio ?? '', p.physicalCardBalance ?? '', r.submitter_name || ''].map(x => '"' + String(x).replaceAll('"', '""') + '"').join(',')); } res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="oneira-reports-${month}.csv"`); res.send('\ufeff' + lines.join('\n')); });

io.on('connection', socket => socket.emit('ready', { ok: true }));
app.use((req, res, next) => { if (req.method !== 'GET' || req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
async function boot() { await migrateAndSeed(); server.listen(PORT, '0.0.0.0', () => console.log(`ONEIRA Manus Space running on ${PORT}`)); }
boot().catch(error => { console.error(error); process.exit(1); });
