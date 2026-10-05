CREATE TABLE IF NOT EXISTS ranking_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  metric_key VARCHAR(120) NOT NULL,
  label VARCHAR(120) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT '',
  source_key VARCHAR(120) NOT NULL,
  aggregation VARCHAR(20) NOT NULL DEFAULT 'sum',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_ranking_metric_key (metric_key)
);
CREATE TABLE IF NOT EXISTS ai_settings (
  id TINYINT PRIMARY KEY,
  endpoint VARCHAR(500) NOT NULL DEFAULT '',
  model VARCHAR(120) NOT NULL DEFAULT '',
  api_key TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO ranking_metrics(metric_key,label,unit,source_key,aggregation,sort_order) VALUES
('revenue','营业额','元','totalRevenue','sum',1),
('received','实收金额','元','received','sum',2),
('orders','订单量','单','orders','sum',3),
('trialAmount','试吃金额','元','trialAmount','sum',4),
('wasteAmount','报损金额','元','wasteAmount','sum',5),
('trialRatio','试吃占比','%','trialRatio','avg',6),
('wasteRatio','报损占比','%','wasteRatio','avg',7),
('members','会员新增','人','members','sum',8),
('physicalCardBalance','实体卡余量','张','physicalCardBalance','avg',9)
ON DUPLICATE KEY UPDATE label=VALUES(label),unit=VALUES(unit),source_key=VALUES(source_key),aggregation=VALUES(aggregation);
INSERT INTO ai_settings(id,endpoint,model,enabled) VALUES(1,'','',FALSE) ON DUPLICATE KEY UPDATE id=id;
