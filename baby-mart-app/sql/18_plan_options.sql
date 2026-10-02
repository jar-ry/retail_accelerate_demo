-- ============================================================
-- Anko Global Planning — option (SKU) level range and productivity
--
-- Why this exists: the range rationalisation scenario is prompted as "rationalise
-- the bottom 25% of TRAVEL SYSTEM SKUs", and the
-- system is expected to IDENTIFY the lowest productivity options rather than
-- apply a blanket percentage. The planning hierarchy stops at CLASS, so without
-- this script the scenario could only ever say "assume sales fall 3.5%", which
-- is an assertion a planner cannot check and therefore will not trust.
--
--   DIM_PLAN_OPTION           one row per option, count ties to OPTION_COUNT_TOTAL
--   FACT_OPTION_PERFORMANCE   option x period, ties to FACT_MFP_PLAN and to OTB
--   VW_OPTION_PRODUCTIVITY    the ranking the scenario builder reads
--
-- TWO RECONCILIATION GUARANTEES
--
-- 1. Option sales, units and GP sum EXACTLY to the class figures in
--    FACT_MFP_PLAN, using the same cumulative-rounding allocation as
--    17_planning_weekly.sql. This is what makes a rationalisation arithmetic
--    rather than rhetorical: remove twelve named options and the class delta the
--    scenario reports is the literal sum of what those twelve were carrying.
--
-- 2. Option stock ties to the class closing stock in FACT_OTB_POSITION, so the
--    "stock impact" column of the scenario comparison is the same stock the OTB
--    pages and the exception engine already quote. Generating option stock
--    freely would let the sandbox claim a reduction the OTB page disagreed with.
--
-- PRODUCTIVITY IS GP PER OPTION PER WEEK, NOT SALES
--
-- Ranking on sales alone would nominate high-turn low-margin lines for deletion,
-- which is the wrong answer -- and a merchandise planner in the room will say so
-- within about four seconds. The productivity measure is therefore realised gross
-- profit per option per trading week, with sell-through and stock turn shown
-- alongside so the recommendation can be argued with.
--
-- THE TAIL IS DELIBERATELY SHAPED, three correlated effects
--
--   a. Sales follow a decay curve, so the bottom decile carries roughly 3-5% of
--      class sales -- small, which is what makes rationalisation plausible.
--   b. Margin RATE falls with productivity, because slow sellers are what gets
--      marked down. So the bottom decile is a worse-than-average margin mix.
--   c. Stock cover RISES as productivity falls, because unsold stock is exactly
--      what a slow seller accumulates.
--
-- Together those give the honest and genuinely interesting headline: deleting
-- the bottom decile costs a little sales, costs proportionally less gross
-- profit (so margin RATE improves), and releases disproportionately more stock.
-- If all three moved by the same percentage the scenario would tell a planner
-- nothing they could not have done on the back of an envelope.
--
-- DETERMINISM: ABS(HASH(...)) only. See 10_planning_dimensions.sql.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Option dimension ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION (
    OPTION_ID        VARCHAR(20),
    OPTION_CODE      VARCHAR(20),
    OPTION_DESC      VARCHAR(120),
    RBU              VARCHAR(50),
    DEPARTMENT       VARCHAR(50),
    DEPARTMENT_CODE  VARCHAR(10),
    CLASS            VARCHAR(50),
    CLASS_CODE       VARCHAR(10),
    OPTION_STATUS    VARCHAR(12),   -- ONGOING | NEW | DESELECTED
    SUPPLIER_NAME    VARCHAR(100),
    COUNTRY_OF_ORIGIN VARCHAR(50),
    OPTION_SEQ       INT,           -- 1..n within the class
    PRODUCTIVITY_SEQ INT            -- 1 = best, n = worst. Independent of OPTION_SEQ.
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION
WITH
-- Option count per class, taken from the plan's own OPTION_COUNT_TOTAL so the
-- range we materialise is the range the MFP already says exists. A point-in-time
-- count, so MAX not SUM across periods.
class_opts AS (
    SELECT
        h.RBU, h.DEPARTMENT, h.DEPARTMENT_CODE, h.CLASS, h.CLASS_CODE,
        MAX(f.VALUE_PHP)::INT AS OPTION_COUNT,
        -- Share of the range that is newly ranged / being exited this year.
        MAX(IFF(f.METRIC = 'OPTION_COUNT_NEW',        f.VALUE_PHP, NULL))::INT AS N_NEW,
        MAX(IFF(f.METRIC = 'OPTION_COUNT_DESELECTED', f.VALUE_PHP, NULL))::INT AS N_DESEL
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
    JOIN BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN f
      ON f.CLASS_CODE = h.CLASS_CODE
     AND f.PLAN_LEVEL = 'CLASS'
     AND f.VERSION    = 'FC'
     AND f.FISCAL_YEAR = 'F27'
    WHERE f.METRIC IN ('OPTION_COUNT_TOTAL', 'OPTION_COUNT_NEW', 'OPTION_COUNT_DESELECTED')
    GROUP BY h.RBU, h.DEPARTMENT, h.DEPARTMENT_CODE, h.CLASS, h.CLASS_CODE
),
-- Widest class is 137 options, so 200 gives headroom without a second pass.
seqs AS (
    SELECT SEQ4() + 1 AS OPTION_SEQ FROM TABLE(GENERATOR(ROWCOUNT => 200))
),
-- Name pools. Assembled from three independent hash streams so descriptions
-- read like a range list rather than "OPTION 47", which matters because the
-- rationalisation UI shows these to the user by name.
range_names AS (
    SELECT * FROM VALUES
        (0,'Astrid'),(1,'Bondi'),(2,'Carlton'),(3,'Darling'),(4,'Elwood'),
        (5,'Fitzroy'),(6,'Glenelg'),(7,'Hawthorn'),(8,'Ivanhoe'),(9,'Jindalee'),
        (10,'Kirra'),(11,'Lorne'),(12,'Manly'),(13,'Noosa'),(14,'Otway'),(15,'Portsea')
    AS t(IX, NM)
),
colours AS (
    SELECT * FROM VALUES
        (0,'Charcoal'),(1,'Oatmeal'),(2,'Sage'),(3,'Terracotta'),(4,'Ink'),
        (5,'Bone'),(6,'Rust'),(7,'Slate'),(8,'Ochre'),(9,'Natural')
    AS t(IX, NM)
),
sizes AS (
    SELECT * FROM VALUES
        (0,'S'),(1,'M'),(2,'L'),(3,'XL'),(4,'Std')
    AS t(IX, NM)
),
suppliers AS (
    SELECT SUPPLIER_NAME,
           ROW_NUMBER() OVER (ORDER BY SUPPLIER_NAME) - 1 AS IX,
           COUNT(*) OVER ()                               AS N
    FROM (SELECT DISTINCT SUPPLIER_NAME
          FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT)
),
origins AS (
    SELECT * FROM VALUES
        (0,'China'),(1,'Vietnam'),(2,'India'),(3,'Bangladesh'),(4,'Indonesia')
    AS t(IX, NM)
),
expanded AS (
    SELECT
        c.RBU, c.DEPARTMENT, c.DEPARTMENT_CODE, c.CLASS, c.CLASS_CODE,
        c.OPTION_COUNT, c.N_NEW, c.N_DESEL,
        s.OPTION_SEQ
    FROM class_opts c
    JOIN seqs s ON s.OPTION_SEQ <= c.OPTION_COUNT
),
-- PRODUCTIVITY_SEQ is a per-class permutation of OPTION_SEQ driven by its own
-- hash stream. Without it the worst performers would always be the highest
-- option codes, and the "bottom 10%" the AI nominates would look suspiciously
-- like a contiguous block on any screen that lists options in code order.
ranked AS (
    SELECT
        e.*,
        ROW_NUMBER() OVER (
            PARTITION BY e.CLASS_CODE
            ORDER BY ABS(HASH(e.CLASS_CODE, e.OPTION_SEQ, 'prodperm'))
        ) AS PRODUCTIVITY_SEQ
    FROM expanded e
)
SELECT
    r.CLASS_CODE || '-' || LPAD(r.OPTION_SEQ::STRING, 3, '0') AS OPTION_ID,
    r.CLASS_CODE || '-' || LPAD(r.OPTION_SEQ::STRING, 3, '0') AS OPTION_CODE,
    rn.NM || ' ' || INITCAP(r.CLASS) || ' - ' || co.NM || ' ' || sz.NM AS OPTION_DESC,
    r.RBU, r.DEPARTMENT, r.DEPARTMENT_CODE, r.CLASS, r.CLASS_CODE,
    -- Status assigned off PRODUCTIVITY_SEQ, not at random: the options already
    -- flagged for exit are the least productive ones, which is what the plan's
    -- own OPTION_COUNT_DESELECTED is describing. A DESELECTED option showing up
    -- in the top productivity decile would be an obvious contradiction.
    CASE
        WHEN r.PRODUCTIVITY_SEQ > r.OPTION_COUNT - r.N_DESEL THEN 'DESELECTED'
        WHEN ABS(HASH(r.CLASS_CODE, r.OPTION_SEQ, 'newopt')) % r.OPTION_COUNT < r.N_NEW THEN 'NEW'
        ELSE 'ONGOING'
    END AS OPTION_STATUS,
    sp.SUPPLIER_NAME,
    og.NM AS COUNTRY_OF_ORIGIN,
    r.OPTION_SEQ,
    r.PRODUCTIVITY_SEQ
FROM ranked r
JOIN range_names rn ON rn.IX = ABS(HASH(r.CLASS_CODE, r.OPTION_SEQ, 'rname'))  % 16
JOIN colours     co ON co.IX = ABS(HASH(r.CLASS_CODE, r.OPTION_SEQ, 'colour')) % 10
JOIN sizes       sz ON sz.IX = ABS(HASH(r.CLASS_CODE, r.OPTION_SEQ, 'size'))   % 5
JOIN origins     og ON og.IX = ABS(HASH(r.CLASS_CODE, r.OPTION_SEQ, 'origin')) % 5
JOIN suppliers   sp ON sp.IX = ABS(HASH(r.CLASS_CODE, r.OPTION_SEQ, 'supp')) % sp.N;


-- ---------- 2. Option performance ----------
-- Option x period, forecast version only. The scenario engine needs a
-- productivity ranking and a set of per-option quantities to remove; it does not
-- need every version at option level, and generating six would multiply the row
-- count without adding a single thing the demo can show.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FACT_OPTION_PERFORMANCE (
    OPTION_ID     VARCHAR(20),
    CLASS_CODE    VARCHAR(10),
    CLASS         VARCHAR(50),
    DEPARTMENT    VARCHAR(50),
    RBU           VARCHAR(50),
    FISCAL_YEAR   VARCHAR(4),
    PERIOD_CODE   VARCHAR(10),
    PERIOD_NO     INT,
    HALF          VARCHAR(2),
    VERSION       VARCHAR(8),      -- FC
    SLS_PHP       NUMBER(18,2),
    SLS_UNITS     NUMBER(18,0),
    POS_GP_AMT    NUMBER(18,2),
    STOCK_PHP     NUMBER(18,2),
    STOCK_UNITS   NUMBER(18,0)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FACT_OPTION_PERFORMANCE
WITH
-- ---------- 2a. Class control totals ----------
class_totals AS (
    SELECT
        CLASS_CODE, CLASS, DEPARTMENT, RBU, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF,
        MAX(IFF(METRIC = 'SLS_PHP',    VALUE_PHP, NULL)) AS SLS_PHP,
        MAX(IFF(METRIC = 'SLS_UNITS',  VALUE_PHP, NULL)) AS SLS_UNITS,
        MAX(IFF(METRIC = 'POS_GP_AMT', VALUE_PHP, NULL)) AS POS_GP_AMT
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
    WHERE PLAN_LEVEL  = 'CLASS'
      AND VERSION     = 'FC'
      AND FISCAL_YEAR = 'F27'
      AND METRIC IN ('SLS_PHP', 'SLS_UNITS', 'POS_GP_AMT')
    GROUP BY 1,2,3,4,5,6,7,8
),
-- Class stock control total, from the SAME weekly OTB fact the OTB pages read.
-- Average of the four weekly closing positions, because stock is a
-- point-in-time balance: summing four weeks of closing stock would report four
-- times the stock that exists. This is the AVG(IFF(...)) rather than SUM(...)
-- rule that 13_planning_views.sql already documents for cover.
class_stock AS (
    SELECT CLASS_CODE, PERIOD_CODE,
           AVG(CLOSING_STOCK_PHP)   AS STOCK_PHP,
           AVG(CLOSING_STOCK_UNITS) AS STOCK_UNITS
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION
    WHERE FISCAL_YEAR = 'F27'
    GROUP BY 1, 2
),

-- ---------- 2b. Per-option weights ----------
-- SALES weight decays with productivity rank. 0.985^(rank-1) over a 40-137 wide
-- range gives a top-to-bottom spread of roughly 1.8x to 7.6x, so the bottom
-- decile lands at 3-5% of class sales: small enough that deleting it is a
-- credible planning action, large enough that the impact is worth quantifying.
--
-- MARGIN weight is the sales weight scaled by a rate factor that FALLS with
-- rank, so the tail is a worse margin mix and removing it lifts the class
-- margin RATE even though it lowers margin dollars.
--
-- STOCK weight is the sales weight scaled by a cover factor that RISES with
-- rank, so the tail holds disproportionate stock and the release is material.
weighted AS (
    SELECT
        o.OPTION_ID, o.CLASS_CODE, o.CLASS, o.DEPARTMENT, o.RBU,
        o.OPTION_SEQ, o.PRODUCTIVITY_SEQ, o.OPTION_STATUS,
        n.OPTION_COUNT,
        -- Position in the tail, 0.0 = best, 1.0 = worst.
        (o.PRODUCTIVITY_SEQ - 1) / NULLIF(n.OPTION_COUNT - 1, 0)::FLOAT AS TAIL_POS,
        POWER(0.985, o.PRODUCTIVITY_SEQ - 1)
          -- Small per-option jitter so the curve is not visibly smooth. Kept
          -- well inside the decay so it cannot reorder the ranking.
          * (1 + (ABS(HASH(o.OPTION_ID, 'slsjit')) % 121 - 60) / 1000.0)
          AS W_SLS
    FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION o
    JOIN (SELECT CLASS_CODE, COUNT(*) AS OPTION_COUNT
          FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION GROUP BY 1) n
      ON n.CLASS_CODE = o.CLASS_CODE
),
factored AS (
    SELECT
        w.*,
        -- Realised margin rate factor: 1.18 at the head down to 0.62 at the
        -- tail. Slow sellers are what gets marked down.
        (1.18 - 0.56 * TAIL_POS) AS F_MARGIN,
        -- Cover factor: 0.78 at the head up to 2.35 at the tail. Unsold stock
        -- is what a slow seller accumulates.
        (0.78 + 1.57 * TAIL_POS) AS F_COVER,
        -- Unit factor drives ASP away from the class average, so the ASP impact
        -- the scenario reports is a real mix effect rather than always zero.
        (1 + (ABS(HASH(OPTION_ID, 'aspmix')) % 241 - 120) / 1000.0) AS F_UNITS
    FROM weighted w
),
-- ---------- 2c. Cross to periods and normalise ----------
expanded AS (
    SELECT
        f.OPTION_ID, f.CLASS_CODE, f.CLASS, f.DEPARTMENT, f.RBU, f.OPTION_SEQ,
        ct.FISCAL_YEAR, ct.PERIOD_CODE, ct.PERIOD_NO, ct.HALF,
        ct.SLS_PHP AS C_SLS, ct.SLS_UNITS AS C_UNITS, ct.POS_GP_AMT AS C_GP,
        cs.STOCK_PHP AS C_STK_PHP, cs.STOCK_UNITS AS C_STK_UNITS,
        f.W_SLS                                  AS W_SLS,
        f.W_SLS * f.F_UNITS                      AS W_UNITS,
        f.W_SLS * f.F_MARGIN                     AS W_GP,
        f.W_SLS * f.F_COVER                      AS W_STK
    FROM factored f
    JOIN class_totals ct ON ct.CLASS_CODE = f.CLASS_CODE
    LEFT JOIN class_stock cs
           ON cs.CLASS_CODE = f.CLASS_CODE AND cs.PERIOD_CODE = ct.PERIOD_CODE
),
-- Cumulative-share allocation, exactly as 17_planning_weekly.sql. The last
-- option's cumulative share is 1.0, so the differenced series sums to the class
-- control total with no residual. Rounding each option independently would leak
-- pesos and the option list would stop tying to the MFP page.
cum AS (
    SELECT
        e.*,
        SUM(W_SLS)   OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CW_SLS,
        SUM(W_UNITS) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CW_UNITS,
        SUM(W_GP)    OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CW_GP,
        SUM(W_STK)   OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CW_STK,
        SUM(W_SLS)   OVER (PARTITION BY CLASS_CODE, PERIOD_CODE) AS TW_SLS,
        SUM(W_UNITS) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE) AS TW_UNITS,
        SUM(W_GP)    OVER (PARTITION BY CLASS_CODE, PERIOD_CODE) AS TW_GP,
        SUM(W_STK)   OVER (PARTITION BY CLASS_CODE, PERIOD_CODE) AS TW_STK
    FROM expanded e
),
alloc AS (
    SELECT
        c.*,
        ROUND(C_SLS       * CW_SLS   / NULLIF(TW_SLS, 0),   2) AS CA_SLS,
        ROUND(C_UNITS     * CW_UNITS / NULLIF(TW_UNITS, 0),  0) AS CA_UNITS,
        ROUND(C_GP        * CW_GP    / NULLIF(TW_GP, 0),    2) AS CA_GP,
        ROUND(C_STK_PHP   * CW_STK   / NULLIF(TW_STK, 0),   2) AS CA_STK_PHP,
        ROUND(C_STK_UNITS * CW_STK   / NULLIF(TW_STK, 0),   0) AS CA_STK_UNITS
    FROM cum c
)
SELECT
    OPTION_ID, CLASS_CODE, CLASS, DEPARTMENT, RBU,
    FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF,
    'FC' AS VERSION,
    CA_SLS       - LAG(CA_SLS,       1, 0) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ) AS SLS_PHP,
    CA_UNITS     - LAG(CA_UNITS,     1, 0) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ) AS SLS_UNITS,
    CA_GP        - LAG(CA_GP,        1, 0) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ) AS POS_GP_AMT,
    CA_STK_PHP   - LAG(CA_STK_PHP,   1, 0) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ) AS STOCK_PHP,
    CA_STK_UNITS - LAG(CA_STK_UNITS, 1, 0) OVER (PARTITION BY CLASS_CODE, PERIOD_CODE ORDER BY OPTION_SEQ) AS STOCK_UNITS
FROM alloc;


-- ---------- 3. Productivity ranking ----------
-- One row per option per half. HALF is carried rather than collapsed because the
-- goal-seek prompt is explicitly scoped ("another 500k of GP in H2"), so the
-- ranking has to be answerable for one half at a time. A whole-year ranking
-- would nominate options for deletion on the strength of trading that has
-- already happened.
--
-- Every ratio here is rebuilt from SUM(numerator)/SUM(denominator). None is an
-- average of per-period ratios.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY AS
WITH agg AS (
    SELECT
        p.OPTION_ID, p.CLASS_CODE, p.CLASS, p.DEPARTMENT, p.RBU, p.HALF,
        o.OPTION_CODE, o.OPTION_DESC, o.OPTION_STATUS, o.SUPPLIER_NAME,
        o.COUNTRY_OF_ORIGIN,
        SUM(p.SLS_PHP)      AS SLS_PHP,
        SUM(p.SLS_UNITS)    AS SLS_UNITS,
        SUM(p.POS_GP_AMT)   AS POS_GP_AMT,
        -- Stock is a balance, so AVERAGE across periods, never SUM.
        AVG(p.STOCK_PHP)    AS STOCK_PHP,
        AVG(p.STOCK_UNITS)  AS STOCK_UNITS,
        COUNT(DISTINCT p.PERIOD_CODE) * 4 AS TRADING_WEEKS
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OPTION_PERFORMANCE p
    JOIN BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION o ON o.OPTION_ID = p.OPTION_ID
    GROUP BY 1,2,3,4,5,6,7,8,9,10,11
),
metrics AS (
    SELECT
        a.*,
        ROUND(a.SLS_PHP    / NULLIF(a.SLS_UNITS, 0), 2)                        AS ASP_PHP,
        ROUND(100.0 * a.POS_GP_AMT / NULLIF(a.SLS_PHP, 0), 2)                  AS GP_PCT,
        -- Rate of sale: units per trading week. The standard range-review unit.
        ROUND(a.SLS_UNITS  / NULLIF(a.TRADING_WEEKS, 0), 1)                    AS RATE_OF_SALE,
        -- THE productivity measure. Gross profit earned per week of range space.
        ROUND(a.POS_GP_AMT / NULLIF(a.TRADING_WEEKS, 0), 2)                    AS GP_PER_OPTION_WEEK,
        -- Sell-through against the stock held to support it.
        ROUND(100.0 * a.SLS_UNITS / NULLIF(a.SLS_UNITS + a.STOCK_UNITS, 0), 2) AS SELL_THROUGH_PCT,
        ROUND(a.SLS_PHP    / NULLIF(a.STOCK_PHP, 0), 2)                        AS STOCK_TURN,
        -- Weeks of cover this option is carrying.
        ROUND(a.STOCK_UNITS / NULLIF(a.SLS_UNITS / NULLIF(a.TRADING_WEEKS, 0), 0), 1) AS COVER_WEEKS
    FROM agg a
)
SELECT
    m.*,
    -- Ranked WITHIN class and half. A cross-class rank would put every option
    -- of a small class in the bottom decile, and "rationalise the bottom 10%"
    -- would silently mean "delete this entire class".
    ROW_NUMBER() OVER (PARTITION BY m.CLASS_CODE, m.HALF ORDER BY m.GP_PER_OPTION_WEEK DESC)
        AS PRODUCTIVITY_RANK,
    COUNT(*) OVER (PARTITION BY m.CLASS_CODE, m.HALF)
        AS CLASS_OPTION_COUNT,
    -- NTILE over ascending productivity: decile 1 is the WORST 10%, which is
    -- the set "bottom 10%" refers to.
    NTILE(10) OVER (PARTITION BY m.CLASS_CODE, m.HALF ORDER BY m.GP_PER_OPTION_WEEK ASC)
        AS PRODUCTIVITY_DECILE,
    ROUND(100.0 * m.POS_GP_AMT
          / NULLIF(SUM(m.POS_GP_AMT) OVER (PARTITION BY m.CLASS_CODE, m.HALF), 0), 3)
        AS SHARE_OF_CLASS_GP_PCT,
    ROUND(100.0 * m.SLS_PHP
          / NULLIF(SUM(m.SLS_PHP) OVER (PARTITION BY m.CLASS_CODE, m.HALF), 0), 3)
        AS SHARE_OF_CLASS_SLS_PCT
FROM metrics m;


-- ---------- 4. Reconciliation guard ----------
-- Must return zero rows. Sales, units and GP at option level have to sum to the
-- class figures the MFP pages already quote, or a rationalisation scenario is
-- reporting a delta against a total nobody else in the app agrees with.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_OPTION_RECONCILIATION AS
WITH opt AS (
    SELECT CLASS_CODE, PERIOD_CODE,
           SUM(SLS_PHP)    AS SLS_PHP,
           SUM(SLS_UNITS)  AS SLS_UNITS,
           SUM(POS_GP_AMT) AS POS_GP_AMT
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OPTION_PERFORMANCE
    GROUP BY 1, 2
),
cls AS (
    SELECT CLASS_CODE, PERIOD_CODE,
           MAX(IFF(METRIC = 'SLS_PHP',    VALUE_PHP, NULL)) AS SLS_PHP,
           MAX(IFF(METRIC = 'SLS_UNITS',  VALUE_PHP, NULL)) AS SLS_UNITS,
           MAX(IFF(METRIC = 'POS_GP_AMT', VALUE_PHP, NULL)) AS POS_GP_AMT
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
    WHERE PLAN_LEVEL = 'CLASS' AND VERSION = 'FC' AND FISCAL_YEAR = 'F27'
      AND METRIC IN ('SLS_PHP', 'SLS_UNITS', 'POS_GP_AMT')
    GROUP BY 1, 2
)
SELECT
    o.CLASS_CODE, o.PERIOD_CODE,
    o.SLS_PHP    - c.SLS_PHP    AS SLS_DIFF,
    o.SLS_UNITS  - c.SLS_UNITS  AS UNITS_DIFF,
    o.POS_GP_AMT - c.POS_GP_AMT AS GP_DIFF
FROM opt o
JOIN cls c ON c.CLASS_CODE = o.CLASS_CODE AND c.PERIOD_CODE = o.PERIOD_CODE
WHERE o.SLS_PHP    <> c.SLS_PHP
   OR o.SLS_UNITS  <> c.SLS_UNITS
   OR o.POS_GP_AMT <> c.POS_GP_AMT;
