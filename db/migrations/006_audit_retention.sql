-- Keep audit lookups fast and make the retention policy explicit.
ALTER TABLE audit_logs ADD KEY idx_audit_action_created (action, created_at);
ALTER TABLE audit_logs ADD KEY idx_audit_entity_created (entity, created_at);
