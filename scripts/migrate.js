import fs from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = mysql.createPool({ uri: url, ssl: { rejectUnauthorized: false }, connectionLimit: 4, dateStrings: true });

async function ensureMigrationTable(conn) {
  await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

async function seed(conn) {
  const [[store]] = await conn.query('SELECT id FROM stores WHERE name=? LIMIT 1', ['咸阳店']);
  let storeId = store?.id;
  if (!storeId) {
    const [r] = await conn.query('INSERT INTO stores(name,address,login_code,manager_name) VALUES(?,?,?,?)', ['咸阳店', '咸阳市', 'BAKE2024', '李店长']);
    storeId = r.insertId;
  }
  const [[manager]] = await conn.query("SELECT id FROM users WHERE name=? AND role='store' LIMIT 1", ['李店长']);
  if (!manager) await conn.query("INSERT INTO users(name,store_id,role) VALUES(?,?, 'store')", ['李店长', storeId]);
  const [[reportNameColumn]] = await conn.query("SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='daily_reports' AND column_name='submitted_by_name'");
  if (!Number(reportNameColumn.count)) await conn.query('ALTER TABLE daily_reports ADD COLUMN submitted_by_name VARCHAR(120) NULL AFTER submitted_by');
  const password = await bcrypt.hash('oneira2026', 10);
  const [[ops]] = await conn.query("SELECT id FROM users WHERE name='运营' AND role='ops' LIMIT 1");
  if (!ops) await conn.query("INSERT INTO users(name,role,password_hash) VALUES('运营','ops',?)", [password]);
  const [[admin]] = await conn.query("SELECT id FROM users WHERE name='管理员' AND role='admin' LIMIT 1");
  if (!admin) await conn.query("INSERT INTO users(name,role,password_hash) VALUES('管理员','admin',?)", [password]);
  const [[fieldCount]] = await conn.query('SELECT COUNT(*) AS count FROM report_fields');
  if (!Number(fieldCount.count)) {
    await conn.query("INSERT INTO report_fields(label,`key`,field_type,unit,required,sort_order) VALUES ('营业额','revenue','number','元',1,1),('客单量','orders','number','单',1,2),('损耗率','wasteRate','number','%',1,3),('会员新增','members','number','人',0,4)");
  }
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await ensureMigrationTable(conn);
    const migrationId = '001_initial';
    const [[done]] = await conn.query('SELECT id FROM schema_migrations WHERE id=?', [migrationId]);
    if (!done) {
      const sql = await fs.readFile(path.resolve('db/migrations/001_initial.sql'), 'utf8');
      for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) {
        if (!statement.toLowerCase().startsWith('create table if not exists schema_migrations')) await conn.query(statement);
      }
      await conn.query('INSERT INTO schema_migrations(id) VALUES(?)', [migrationId]);
    }
    const [[done003]] = await conn.query('SELECT id FROM schema_migrations WHERE id=?', ['003_ranking_ai']);
    if (!done003) { const sql = await fs.readFile(path.resolve('db/migrations/003_ranking_ai.sql'), 'utf8'); for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await conn.query(statement); await conn.query('INSERT INTO schema_migrations(id) VALUES(?)', ['003_ranking_ai']); }
    await seed(conn);
    console.log('ONEIRA database ready');
  } finally {
    conn.release();
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exit(1); });
