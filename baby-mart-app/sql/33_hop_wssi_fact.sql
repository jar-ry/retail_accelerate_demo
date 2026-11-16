-- ============================================================
-- Head of Planning — the WSSI weekly fact
--
-- Weekly stock, sales and intake: department x week x version, for the 52-week
-- window FY26 H2 + FY27 H1 (Jan-Dec 2026). Class -> department -> RBU -> business;
-- never SKU.
--
-- VERSIONS. Exactly four, as planners use them: TY this year, LY last year, BUD
-- budget, MERCH_FC the merch forecast. Budget does not move once approved; the
-- forecast is continually reviewed.
--
--   TY        REAL. POS through the last COMPLETE week. A week with only part of
--             its trading loaded would read as a shortfall that is not real.
--   LY        REAL. POS for the same weeks 364 days earlier, stored at their own
--             dates and joined back week to week.
--   BUD       GENERATED. FY26 H2 = LY x (1 + department LFL). FY27 H1 is the store
--             plan, split to department by each department's LY week grown at its
--             top-down LFL, and scaled so every week ties to the store plan
--             exactly. The budget being traded against IS the board-locked plan.
--             Like the uploaded budget it stands for, it carries sales, units and
--             margin only: no full-price / clearance split.
--   MERCH_FC  GENERATED. Budget adjusted by the merch view of each department.
--             Prams forecast below budget -- the committed range cannot deliver
--             it -- while consumables forecast above.
--
-- FULL PRICE vs CLEARANCE is REAL: a POS line carrying a discount or a promotion
-- is clearance (CL), everything else full price (FP). POS cannot tell a promotion
-- from a clearance markdown, so both count as clearance (PLANNING_SETTING
-- CLEARANCE_DEFINITION).
--
-- STOCK IS MODELLED, not measured, and STOCK_BASIS says so on every row. The store
-- SOH feed implies 60-113 weeks of cover against POS; trading on it would make
-- every stock row in the WSSI read as broken. Stock is instead modelled at a plan
-- cover per department and rolled forward, so the roll-forward identity
--     closing = last closing - (sales - POS margin) + receipts at cost
-- holds by construction. The real feed is kept beside it in C_SOH_FEED_AUD for the
-- weeks it covers, and VW_WSSI_INTEGRITY reports the gap -- surfaced, not hidden.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

CREATE OR REPLACE TABLE FACT_WSSI_WEEKLY
  COMMENT = 'WSSI weekly fact, department x week x version (TY, LY, BUD, MERCH_FC), FY26 H2 + FY27 H1. TY/LY and the FP/CL split are real POS; BUD/FC are generated; stock is MODELLED (see STOCK_BASIS).'
AS
WITH dept AS (
  SELECT DISTINCT RBU_CODE, RBU_DESCRIPTION, DEPARTMENT_NUM, DEPARTMENT_NAME_BARE, DEPARTMENT_LABEL
  FROM DIM_MERCH_HIERARCHY
), actuals_end AS (
  -- The last COMPLETE trading week. POS runs to a Thursday, so the part-week
  -- after it is excluded rather than reported as a collapse in sales.
  SELECT MAX(c.WEEK_END_DATE) AS D
  FROM DIM_CALENDAR_WEEK c
  WHERE c.WEEK_END_DATE <= (
    SELECT MAX(dd.CALENDAR_DATE)
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_DATE dd ON dd.DATE_KEY = t.DATE_KEY)
), win AS (
  SELECT * FROM DIM_CALENDAR_WEEK
  WHERE (FY_YEAR = 2026 AND FY_HALF = 'H2') OR (FY_YEAR = 2027 AND FY_HALF = 'H1')
), pos_wk AS (
  SELECT h.DEPARTMENT_NUM, c.WEEK_END_DATE,
         SUM(tl.NET_REVENUE)                                                     AS SLS,
         SUM(tl.QUANTITY)                                                        AS U,
         SUM(tl.MARGIN_AMOUNT)                                                   AS GP,
         SUM(IFF(tl.DISCOUNT_AMOUNT > 0 OR tl.PROMOTION_KEY IS NOT NULL, tl.NET_REVENUE, 0))   AS SLS_CL,
         SUM(IFF(tl.DISCOUNT_AMOUNT > 0 OR tl.PROMOTION_KEY IS NOT NULL, tl.QUANTITY, 0))      AS U_CL,
         SUM(IFF(tl.DISCOUNT_AMOUNT > 0 OR tl.PROMOTION_KEY IS NOT NULL, tl.MARGIN_AMOUNT, 0)) AS GP_CL
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = tl.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  JOIN dept h ON h.DEPARTMENT_NAME_BARE = UPPER(p.CATEGORY)
  JOIN DIM_CALENDAR_WEEK c ON d.CALENDAR_DATE BETWEEN c.WEEK_START_DATE AND c.WEEK_END_DATE
  WHERE c.WEEK_END_DATE <= (SELECT D FROM actuals_end)
  GROUP BY h.DEPARTMENT_NUM, c.WEEK_END_DATE
), ly_by_ty AS (
  -- Last year's week, keyed by THIS year's week, to grow the plan versions from.
  SELECT w.WEEK_END_DATE, w.FY_YEAR, p.DEPARTMENT_NUM,
         p.SLS, p.U, p.GP, p.SLS_CL, p.U_CL, p.GP_CL
  FROM win w
  JOIN pos_wk p ON p.WEEK_END_DATE = DATEADD(day, -364, w.WEEK_END_DATE)
), mfp AS (
  SELECT ENTITY_CODE AS DEPARTMENT_NUM,
         MAX(IFF(MEASURE_CODE = 'LFL_GROWTH_PCT',           MEASURE_VALUE, NULL)) AS LFL,
         MAX(IFF(MEASURE_CODE = 'F26_FIRST_MARGIN_PCT',     MEASURE_VALUE, NULL)) AS FM26,
         MAX(IFF(MEASURE_CODE = 'F27_TPR_FIRST_MARGIN_PCT', MEASURE_VALUE, NULL)) AS FM27
  FROM FACT_MFP_PRODUCT_PLAN
  WHERE PLAN_LEVEL = 'DEPARTMENT' AND IS_CURRENT
  GROUP BY ENTITY_CODE
), sp_wk AS (
  -- The budget is struck from the store plan AS IT STANDS when this runs, which in
  -- the build order (30-38) is the plan the board then approves in 38. Re-running
  -- this after post-lock edits would carry them into the budget; verify_hop.py's
  -- "budget is the board-approved plan" gate catches that.
  SELECT WEEK_END_DATE, SUM(PLAN_SALES_AUD) AS SP, SUM(PLAN_MARGIN_AUD) AS SPM
  FROM VW_STORE_PLAN_WEEKLY GROUP BY WEEK_END_DATE
), bud_raw AS (
  SELECT l.*, l.SLS * (1 + m.LFL) AS RAW
  FROM ly_by_ty l JOIN mfp m ON m.DEPARTMENT_NUM = l.DEPARTMENT_NUM
), bud_sls AS (
  SELECT b.DEPARTMENT_NUM, b.WEEK_END_DATE, b.FY_YEAR, sp.SPM,
         IFF(b.FY_YEAR = 2027, b.RAW * sp.SP / SUM(b.RAW) OVER (PARTITION BY b.WEEK_END_DATE), b.RAW) AS SLS,
         b.SLS AS LY_SLS, b.U AS LY_U, b.GP AS LY_GP, b.SLS_CL AS LY_SLS_CL, b.U_CL AS LY_U_CL, b.GP_CL AS LY_GP_CL
  FROM bud_raw b
  LEFT JOIN sp_wk sp ON sp.WEEK_END_DATE = b.WEEK_END_DATE
), bud AS (
  -- Margin at last year's department rate plus 0.3pt, and for FY27 H1 scaled so
  -- each week ties to the store plan's margin too: the departments split the
  -- approved margin, they do not restate it.
  SELECT b.*,
         IFF(b.FY_YEAR = 2027,
             b.SLS * (b.LY_GP / NULLIF(b.LY_SLS, 0) + 0.003) * b.SPM
               / SUM(b.SLS * (b.LY_GP / NULLIF(b.LY_SLS, 0) + 0.003)) OVER (PARTITION BY b.WEEK_END_DATE),
             b.SLS * (b.LY_GP / NULLIF(b.LY_SLS, 0) + 0.003)) AS GP
  FROM bud_sls b
), fc_adj AS (
  SELECT * FROM VALUES ('010', 0.065), ('020', 0.050), ('030', -0.020), ('040', 0.010), ('050', -0.050)
  AS t(DEPARTMENT_NUM, ADJ)
), flow AS (
  SELECT 'TY' AS VERSION, p.DEPARTMENT_NUM, p.WEEK_END_DATE,
         p.SLS, p.U, p.GP,
         p.SLS - p.SLS_CL AS SLS_FP, p.U - p.U_CL AS U_FP, p.GP - p.GP_CL AS GP_FP,
         p.SLS_CL, p.U_CL, p.GP_CL
  FROM pos_wk p JOIN win w ON w.WEEK_END_DATE = p.WEEK_END_DATE
  UNION ALL
  SELECT 'LY', p.DEPARTMENT_NUM, p.WEEK_END_DATE,
         p.SLS, p.U, p.GP,
         p.SLS - p.SLS_CL, p.U - p.U_CL, p.GP - p.GP_CL,
         p.SLS_CL, p.U_CL, p.GP_CL
  FROM pos_wk p JOIN win w ON p.WEEK_END_DATE = DATEADD(day, -364, w.WEEK_END_DATE)
  UNION ALL
  -- Budget: sales and margin from the store plan, units at last year's ASP.
  SELECT 'BUD', b.DEPARTMENT_NUM, b.WEEK_END_DATE,
         b.SLS,
         ROUND(b.SLS / NULLIF(b.LY_SLS / NULLIF(b.LY_U, 0), 0), 0),
         b.GP,
         NULL, NULL, NULL, NULL, NULL, NULL
  FROM bud b
  UNION ALL
  -- Forecast: carries the FP/CL split at last year's mix and last year's FP margin.
  SELECT 'MERCH_FC', b.DEPARTMENT_NUM, b.WEEK_END_DATE,
         b.SLS * (1 + a.ADJ),
         ROUND(b.SLS * (1 + a.ADJ) / NULLIF(b.LY_SLS / NULLIF(b.LY_U, 0), 0), 0),
         b.SLS * (1 + a.ADJ) * (b.LY_GP / NULLIF(b.LY_SLS, 0)),
         b.SLS * (1 + a.ADJ) * (1 - b.LY_SLS_CL / NULLIF(b.LY_SLS, 0)),
         ROUND(b.SLS * (1 + a.ADJ) / NULLIF(b.LY_SLS / NULLIF(b.LY_U, 0), 0) * (1 - b.LY_U_CL / NULLIF(b.LY_U, 0)), 0),
         b.SLS * (1 + a.ADJ) * (1 - b.LY_SLS_CL / NULLIF(b.LY_SLS, 0))
           * ((b.LY_GP - b.LY_GP_CL) / NULLIF(b.LY_SLS - b.LY_SLS_CL, 0)),
         b.SLS * (1 + a.ADJ) * (b.LY_SLS_CL / NULLIF(b.LY_SLS, 0)),
         ROUND(b.SLS * (1 + a.ADJ) / NULLIF(b.LY_SLS / NULLIF(b.LY_U, 0), 0) * (b.LY_U_CL / NULLIF(b.LY_U, 0)), 0),
         b.SLS * (1 + a.ADJ) * (b.LY_GP / NULLIF(b.LY_SLS, 0))
           - b.SLS * (1 + a.ADJ) * (1 - b.LY_SLS_CL / NULLIF(b.LY_SLS, 0))
             * ((b.LY_GP - b.LY_GP_CL) / NULLIF(b.LY_SLS - b.LY_SLS_CL, 0))
  FROM bud b JOIN fc_adj a ON a.DEPARTMENT_NUM = b.DEPARTMENT_NUM
), cover AS (
  -- Plan cover in weeks. Prams hold the deepest stock -- high ticket, long lead
  -- times -- and consumables the leanest.
  SELECT * FROM VALUES ('010', 6), ('020', 9), ('030', 11), ('040', 13), ('050', 16)
  AS t(DEPARTMENT_NUM, COVER_WKS)
), ucost AS (
  SELECT DEPARTMENT_NUM, SUM(SLS - GP) / NULLIF(SUM(U), 0) AS UCOST
  FROM pos_wk
  WHERE WEEK_END_DATE BETWEEN (SELECT MIN(LY_WEEK_END_DATE) FROM STORE_PLAN_WEEK_SLOT)
                          AND (SELECT MAX(LY_WEEK_END_DATE) FROM STORE_PLAN_WEEK_SLOT)
  GROUP BY DEPARTMENT_NUM
), s1 AS (
  SELECT f.*, f.SLS - f.GP AS COGS,
         COALESCE(AVG(f.SLS - f.GP) OVER (PARTITION BY f.VERSION, f.DEPARTMENT_NUM ORDER BY f.WEEK_END_DATE
                                          ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING),
                  f.SLS - f.GP)                                                  AS FWD_COGS4
  FROM flow f
), s2 AS (
  SELECT s1.*, c.COVER_WKS,
         c.COVER_WKS * s1.FWD_COGS4                                              AS TGT,
         LAG(c.COVER_WKS * s1.FWD_COGS4) OVER (PARTITION BY s1.VERSION, s1.DEPARTMENT_NUM ORDER BY s1.WEEK_END_DATE) AS TGT_PRIOR,
         FIRST_VALUE(c.COVER_WKS * s1.FWD_COGS4) OVER (PARTITION BY s1.VERSION, s1.DEPARTMENT_NUM ORDER BY s1.WEEK_END_DATE) AS TGT_FIRST,
         ROW_NUMBER() OVER (PARTITION BY s1.VERSION, s1.DEPARTMENT_NUM ORDER BY s1.WEEK_END_DATE) AS RN
  FROM s1 JOIN cover c ON c.DEPARTMENT_NUM = s1.DEPARTMENT_NUM
), s3 AS (
  -- Receipts top stock back up to target. Never negative: when the target falls
  -- faster than sales deplete it, stock simply runs above target for a week.
  SELECT s2.*, IFF(TGT_PRIOR IS NULL, COGS, GREATEST(0, TGT - TGT_PRIOR + COGS)) AS REC_C
  FROM s2
), s4 AS (
  -- Closing stock is the opening target plus every receipt less every week's
  -- cost of sales, so the roll-forward identity holds exactly, week on week.
  SELECT s3.*,
         TGT_FIRST + SUM(IFF(RN = 1, 0, REC_C - COGS)) OVER (
           PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)                     AS C_CLS_INV
  FROM s3
), s5 AS (
  SELECT s4.*, u.UCOST,
         IFF(s4.VERSION IN ('TY', 'LY'), m.FM26, m.FM27)                         AS FM,
         0.85 * COALESCE(SUM(s4.REC_C) OVER (PARTITION BY s4.VERSION, s4.DEPARTMENT_NUM ORDER BY s4.WEEK_END_DATE
                                             ROWS BETWEEN 1 FOLLOWING AND 6 FOLLOWING), 0) AS COMMIT_C,
         LAG(0.72 * s4.C_CLS_INV / u.UCOST) OVER (PARTITION BY s4.VERSION, s4.DEPARTMENT_NUM ORDER BY s4.WEEK_END_DATE) AS U_STORE_PRIOR
  FROM s4
  JOIN ucost u ON u.DEPARTMENT_NUM = s4.DEPARTMENT_NUM
  JOIN mfp m   ON m.DEPARTMENT_NUM = s4.DEPARTMENT_NUM
), feed AS (
  -- The real store SOH feed, at cost, on each week-ending date it covers.
  SELECT h.DEPARTMENT_NUM, d.CALENDAR_DATE AS WEEK_END_DATE, SUM(i.STOCK_ON_HAND * p.UNIT_COST) AS SOH_C
  FROM BABY_MART_DEMO.CURATED.FACT_INVENTORY i
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = i.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = i.PRODUCT_KEY
  JOIN dept h ON h.DEPARTMENT_NAME_BARE = UPPER(p.CATEGORY)
  WHERE d.CALENDAR_DATE IN (SELECT WEEK_END_DATE FROM DIM_CALENDAR_WEEK)
  GROUP BY h.DEPARTMENT_NUM, d.CALENDAR_DATE
)
SELECT
  'AU'                                                       AS MARKET_CODE,
  h.RBU_CODE, h.RBU_DESCRIPTION, h.DEPARTMENT_NUM,
  h.DEPARTMENT_NAME_BARE                                     AS DEPARTMENT_NAME,
  h.DEPARTMENT_LABEL,
  'DEPARTMENT'                                               AS PLAN_LEVEL,
  s.VERSION,
  s.WEEK_END_DATE,
  c.WEEK_START_DATE, c.FY_YEAR, c.FY_LABEL, c.FY_HALF, c.FY_PERIOD_NO, c.MONTH_NAME, c.PERIOD_KEY,
  c.CAL_YEAR, c.CAL_MONTH_NO,
  -- The budget is rounded CUMULATIVELY: each row rounds the running total for the
  -- half and takes the difference, so the half ties to the approved plan to the
  -- cent instead of drifting by the sum of 130 separate roundings.
  IFF(s.VERSION = 'BUD',
      ROUND(ROUND(SUM(s.SLS) OVER (PARTITION BY s.VERSION, c.FY_YEAR, c.FY_HALF ORDER BY s.WEEK_END_DATE, s.DEPARTMENT_NUM
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
            - NVL(ROUND(SUM(s.SLS) OVER (PARTITION BY s.VERSION, c.FY_YEAR, c.FY_HALF ORDER BY s.WEEK_END_DATE, s.DEPARTMENT_NUM
                                         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 2), 0), 2),
      ROUND(s.SLS, 2))                                       AS SLS_AUD,
  ROUND(s.U, 0)                                              AS SLS_U,
  ROUND(s.U_FP, 0)                                           AS SLS_FP_U,
  ROUND(s.U_CL, 0)                                           AS SLS_CL_U,
  ROUND(s.SLS_FP, 2)                                         AS SLS_FP_AUD,
  ROUND(s.SLS_CL, 2)                                         AS SLS_CL_AUD,
  IFF(s.VERSION = 'BUD',
      ROUND(ROUND(SUM(s.GP) OVER (PARTITION BY s.VERSION, c.FY_YEAR, c.FY_HALF ORDER BY s.WEEK_END_DATE, s.DEPARTMENT_NUM
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
            - NVL(ROUND(SUM(s.GP) OVER (PARTITION BY s.VERSION, c.FY_YEAR, c.FY_HALF ORDER BY s.WEEK_END_DATE, s.DEPARTMENT_NUM
                                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 2), 0), 2),
      ROUND(s.GP, 2))                                        AS POS_GP_AUD,
  ROUND(s.GP_FP, 2)                                          AS FP_GP_AUD,
  ROUND(s.GP_CL, 2)                                          AS CL_GP_AUD,
  ROUND(s.C_CLS_INV, 2)                                      AS C_CLS_INV_AUD,
  ROUND(0.72 * s.C_CLS_INV / s.UCOST, 0)                     AS U_CLS_INV_STORE,
  ROUND(0.28 * s.C_CLS_INV / s.UCOST, 0)                     AS U_CLS_INV_DC,
  ROUND(s.C_CLS_INV / s.UCOST, 0)                            AS U_CLS_INV,
  ROUND(s.REC_C / s.UCOST, 0)                                AS U_REC,
  ROUND(s.REC_C, 2)                                          AS C_REC_AUD,
  ROUND(s.REC_C / NULLIF(1 - s.FM, 0), 2)                    AS R_REC_AUD,
  ROUND(s.U + NVL(0.72 * s.C_CLS_INV / s.UCOST - s.U_STORE_PRIOR, 0), 0) AS STORE_REC_UNIT,
  ROUND(s.COMMIT_C / s.UCOST, 0)                             AS U_COMMIT,
  ROUND(s.COMMIT_C / NULLIF(1 - s.FM, 0), 2)                 AS COMMIT_R_AUD,
  ROUND(s.COMMIT_C, 2)                                       AS COMMIT_C_AUD,
  'MODELLED'                                                 AS STOCK_BASIS,
  IFF(s.VERSION = 'TY', ROUND(fd.SOH_C, 2), NULL)            AS C_SOH_FEED_AUD
FROM s5 s
JOIN dept h ON h.DEPARTMENT_NUM = s.DEPARTMENT_NUM
JOIN DIM_CALENDAR_WEEK c ON c.WEEK_END_DATE = s.WEEK_END_DATE
LEFT JOIN feed fd ON fd.DEPARTMENT_NUM = s.DEPARTMENT_NUM AND fd.WEEK_END_DATE = s.WEEK_END_DATE;
