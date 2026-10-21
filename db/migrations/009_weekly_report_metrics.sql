ALTER TABLE period_reviews ADD COLUMN manual_metrics JSON NULL AFTER next_actions;
ALTER TABLE period_reviews ADD COLUMN auto_snapshot JSON NULL AFTER manual_metrics;
