CREATE TABLE IF NOT EXISTS stores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  login_code VARCHAR(120) NOT NULL,
  manager_name VARCHAR(120) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stores_name (name)
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  store_id INT NULL,
  role ENUM('store','ops','admin') NOT NULL,
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL,
  KEY idx_users_store_role (store_id, role),
  KEY idx_users_role_name (role, name)
);

CREATE TABLE IF NOT EXISTS report_fields (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  `key` VARCHAR(120) NOT NULL,
  field_type VARCHAR(20) NOT NULL DEFAULT 'number',
  unit VARCHAR(40) NOT NULL DEFAULT '',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_report_fields_key (`key`)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  report_date DATE NOT NULL,
  submitted_by INT NULL,
  submitted_by_name VARCHAR(120) NULL,
  payload JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_submitter FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_reports_store_date (store_id, report_date),
  KEY idx_reports_date (report_date)
);

CREATE TABLE IF NOT EXISTS monthly_goals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  `month` CHAR(7) NOT NULL,
  goal_type VARCHAR(30) NOT NULL,
  goal_value DECIMAL(14,2) NOT NULL,
  rule VARCHAR(30) NOT NULL DEFAULT 'average',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_goals_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_goals_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_goals_store_month_type (store_id, `month`, goal_type)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  goal_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  target_value DECIMAL(14,2) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT '',
  task_date DATE NOT NULL,
  actual_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_goal FOREIGN KEY (goal_id) REFERENCES monthly_goals(id) ON DELETE CASCADE,
  UNIQUE KEY uq_tasks_goal_date (goal_id, task_date),
  KEY idx_tasks_store_date (store_id, task_date)
);

CREATE TABLE IF NOT EXISTS issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  submitter_name VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  handler_id INT NULL,
  handled_at TIMESTAMP NULL,
  handling_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_issues_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_issues_handler FOREIGN KEY (handler_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_issues_store_status (store_id, status)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(120) NULL,
  detail JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_audit_created (created_at)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
