CREATE TABLE IF NOT EXISTS ordering_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  category_code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_categories_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE KEY uq_order_category_store_code (store_id, category_code),
  UNIQUE KEY uq_order_category_store_name (store_id, name),
  KEY idx_order_categories_store (store_id, enabled, sort_order)
);

CREATE TABLE IF NOT EXISTS ordering_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  category_id INT NULL,
  sku VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT '个',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_products_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_products_category FOREIGN KEY (category_id) REFERENCES ordering_categories(id) ON DELETE SET NULL,
  UNIQUE KEY uq_order_product_store_sku (store_id, sku),
  KEY idx_order_products_store (store_id, enabled, sort_order),
  KEY idx_order_products_category (category_id, sort_order)
);

CREATE TABLE IF NOT EXISTS daily_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  order_date DATE NOT NULL,
  target_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('draft','submitted') NOT NULL DEFAULT 'draft',
  total_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by INT NULL,
  submitted_by INT NULL,
  submitted_by_name VARCHAR(120) NULL,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_daily_orders_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_daily_orders_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_daily_orders_submitter FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_daily_order_store_date (store_id, order_date),
  KEY idx_daily_orders_date (order_date, store_id)
);

CREATE TABLE IF NOT EXISTS daily_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  sku VARCHAR(80) NOT NULL,
  product_name VARCHAR(160) NOT NULL,
  category_name VARCHAR(120) NOT NULL DEFAULT '其他',
  unit VARCHAR(40) NOT NULL DEFAULT '个',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES daily_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES ordering_products(id) ON DELETE SET NULL,
  UNIQUE KEY uq_order_item_product (order_id, product_id),
  KEY idx_order_items_order_category (order_id, category_name, sort_order)
);

CREATE TABLE IF NOT EXISTS ordering_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  row_count INT NOT NULL DEFAULT 0,
  summary JSON NOT NULL,
  imported_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_import_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_import_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
);
