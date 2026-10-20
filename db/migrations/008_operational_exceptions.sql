CREATE TABLE IF NOT EXISTS operational_exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exception_key VARCHAR(180) NOT NULL,
  store_id INT NOT NULL,
  exception_date DATE NOT NULL,
  exception_type VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  note VARCHAR(500) NOT NULL DEFAULT '',
  handled_by INT NULL,
  handled_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_exception_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_exception_handler FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_exception_key (exception_key),
  KEY idx_exception_store_date (store_id, exception_date),
  KEY idx_exception_status (status)
);
