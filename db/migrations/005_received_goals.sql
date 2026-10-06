-- Monthly goals and daily task completion are based on received cash, not gross revenue.
UPDATE tasks t
JOIN daily_reports r ON r.store_id=t.store_id AND r.report_date=t.task_date
SET t.actual_value=COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.received')) AS DECIMAL(14,2)),0),
    t.status=IF(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.received')) AS DECIMAL(14,2)),0) >= t.target_value,'done','pending');

UPDATE tasks SET title='实收金额目标' WHERE title IS NULL OR title IN ('营业额目标','营业目标');
