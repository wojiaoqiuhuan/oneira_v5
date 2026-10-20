ALTER TABLE monthly_goals ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE monthly_goals ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS goal_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  goal_id INT NOT NULL,
  store_id INT NOT NULL,
  `month` CHAR(7) NOT NULL,
  version INT NOT NULL,
  goal_value DECIMAL(14,2) NOT NULL,
  rule VARCHAR(30) NOT NULL DEFAULT 'average',
  snapshot JSON NOT NULL,
  changed_by INT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_goal_versions_goal FOREIGN KEY (goal_id) REFERENCES monthly_goals(id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_versions_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_versions_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_goal_versions_goal (goal_id, version)
);
