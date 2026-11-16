-- Measurement data for Task 10, acme_test only (reset by every test run).
-- Adds recorded changes and requests on top of the 10,000-employee seed so the
-- time-based queries have rows to scan.

-- About 850 PERFORMANCE changes for every tenth working employee, recorded 0..119 days before 2026-11-15.
INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason, created_at)
SELECT c.employee_id, 2, ROUND(c.annual_base_salary * 1.05, 2), c.annual_bonus, c.currency, c.pay_frequency,
       DATE_SUB('2026-11-15', INTERVAL (c.employee_id % 120) DAY), 'PERFORMANCE',
       TIMESTAMP(DATE_SUB('2026-11-15', INTERVAL (c.employee_id % 120) DAY), '09:00:00')
FROM compensation_records c JOIN employees e ON e.id = c.employee_id
WHERE e.employment_status = 'CURRENTLY_WORKING' AND c.version = 1 AND c.employee_id % 10 = 0;

-- About 170 future-effective changes recorded this month.
INSERT INTO compensation_records (employee_id, version, annual_base_salary, annual_bonus, currency, pay_frequency, effective_from, change_reason, created_at)
SELECT c.employee_id, 2, ROUND(c.annual_base_salary * 1.03, 2), c.annual_bonus, c.currency, c.pay_frequency,
       '2026-12-01', 'MARKET_ADJUSTMENT', '2026-11-10 09:00:00'
FROM compensation_records c JOIN employees e ON e.id = c.employee_id
WHERE e.employment_status = 'CURRENTLY_WORKING' AND c.version = 1 AND c.employee_id % 50 = 7;
