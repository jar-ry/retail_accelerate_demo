-- ============================================================
-- Baby Mart Supplier Collaboration Platform
-- 04_create_tasks.sql
-- Scheduled tasks for automated agent comms
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA AI;
USE WAREHOUSE DEMO_AI_WH;

CREATE OR REPLACE TASK WEEKLY_SUPPLIER_COMMS_TASK
  WAREHOUSE = DEMO_AI_WH
  SCHEDULE = 'USING CRON 0 8 * * 1 Australia/Melbourne'
  COMMENT = 'Triggers weekly supplier performance summary generation every Monday at 8am AEST'
AS
CALL BABY_MART_DEMO.AI.GENERATE_WEEKLY_SUPPLIER_COMMS();

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.GENERATE_WEEKLY_SUPPLIER_COMMS()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    -- Placeholder: In production this would iterate over suppliers
    -- and call the Cortex Agent for each, storing results
    RETURN 'Weekly supplier comms generated successfully';
END;
$$;

ALTER TASK WEEKLY_SUPPLIER_COMMS_TASK SUSPEND;
