-- ============================================================
-- AI Assessment — SOP / insight template settings
--
-- Backs the /settings page: named SOP + insight templates with full version
-- history, and a saved record of every assessment run.
--
--   ASSESSMENT_TEMPLATE          current named templates
--   ASSESSMENT_TEMPLATE_HISTORY  append-only audit of every edit
--   ASSESSMENT_RUN               every completed assessment
--   SAVE_ASSESSMENT_TEMPLATE     atomic version bump + upsert + history write
--
-- WHY "IF NOT EXISTS" AND NOT "OR REPLACE"
-- Every other script in this directory uses CREATE OR REPLACE, because they
-- build generated demo data that is meant to be rebuilt. These three tables are
-- different: they hold content a USER authored in the app. Re-running the deploy
-- script must not silently delete someone's standard operating procedure, so the
-- tables are created only when absent and the seed rows are MERGEd
-- WHEN NOT MATCHED, never updated. A rerun is therefore a no-op over existing
-- content while still provisioning a fresh account.
--
-- To deliberately reset them, DROP the three tables first and re-run.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Current templates ----------
-- SCOPE controls which dashboards an assessment reads:
--   PLANNING   = merchandise financial plan + open-to-buy
--   COMMERCIAL = category / brand / vendor performance
--   BOTH       = everything
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE (
    TEMPLATE_NAME   VARCHAR(120)  NOT NULL,
    DESCRIPTION     VARCHAR(500),
    SOP_TEXT        VARCHAR(16777216),   -- standard of practice: HOW to assess
    TEMPLATE_TEXT   VARCHAR(16777216),   -- markdown headings: the OUTPUT shape
    SCOPE           VARCHAR(12)   NOT NULL,
    IS_DEFAULT      BOOLEAN       DEFAULT FALSE,
    VERSION         INT           NOT NULL,
    UPDATED_AT      TIMESTAMP_LTZ NOT NULL,
    UPDATED_BY      VARCHAR(200)
);

-- ---------- 2. Version history ----------
-- Append-only. One row per save, including the very first, so a template's
-- entire authoring history is reconstructable and any prior version can be
-- restored from here without a separate backup.
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE_HISTORY (
    TEMPLATE_NAME   VARCHAR(120)  NOT NULL,
    VERSION         INT           NOT NULL,
    DESCRIPTION     VARCHAR(500),
    SOP_TEXT        VARCHAR(16777216),
    TEMPLATE_TEXT   VARCHAR(16777216),
    SCOPE           VARCHAR(12),
    CHANGED_AT      TIMESTAMP_LTZ NOT NULL,
    CHANGED_BY      VARCHAR(200),
    CHANGE_NOTE     VARCHAR(1000)
);

-- ---------- 3. Saved assessments ----------
-- SOP_SNAPSHOT and TEMPLATE_SNAPSHOT copy the text that ACTUALLY RAN rather
-- than referencing ASSESSMENT_TEMPLATE. If they were a reference, editing a
-- template would silently re-point every historical assessment at wording that
-- never produced it, and the saved output would stop being explicable.
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.ASSESSMENT_RUN (
    ASSESSMENT_ID     VARCHAR(64)   NOT NULL,
    CREATED_AT        TIMESTAMP_LTZ NOT NULL,
    CREATED_BY        VARCHAR(200),
    TEMPLATE_NAME     VARCHAR(120),
    TEMPLATE_VERSION  INT,
    SCOPE             VARCHAR(12),
    SOP_SNAPSHOT      VARCHAR(16777216),
    TEMPLATE_SNAPSHOT VARCHAR(16777216),
    OUTPUT_MARKDOWN   VARCHAR(16777216),
    SOURCE_METRICS    VARIANT,
    MODEL             VARCHAR(100),
    ELAPSED_MS        INT
);

-- ---------- 4. Save procedure ----------
-- The version bump, the upsert and the history write happen together here
-- rather than as three statements from the API route. Done from the app, a
-- failure between them leaves the audit trail missing an entry or the version
-- number out of step with history -- and the whole point of the history table
-- is that it can be trusted.
--
-- Clearing IS_DEFAULT on the other rows is also included, because as two
-- separate app statements it races and can briefly leave two defaults.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.SAVE_ASSESSMENT_TEMPLATE(
  P_TEMPLATE_NAME STRING,
  P_DESCRIPTION STRING,
  P_SOP_TEXT STRING,
  P_TEMPLATE_TEXT STRING,
  P_SCOPE STRING,
  P_IS_DEFAULT BOOLEAN,
  P_UPDATED_BY STRING,
  P_CHANGE_NOTE STRING DEFAULT NULL
)
RETURNS STRING
LANGUAGE SQL
COMMENT = 'Upserts an assessment SOP/insight template, bumping its version and appending a history row atomically.'
AS
$$
DECLARE
  v_name    STRING;
  v_scope   STRING;
  v_version INT;
  v_now     TIMESTAMP_LTZ;
BEGIN
  v_name  := TRIM(COALESCE(:P_TEMPLATE_NAME, ''));
  v_scope := UPPER(TRIM(COALESCE(:P_SCOPE, 'BOTH')));
  v_now   := CURRENT_TIMESTAMP();

  -- Validate before writing anything: a half-valid template that the assessment
  -- procedure later refuses to run is worse than a clear rejection here.
  IF (v_name = '') THEN
    RETURN OBJECT_CONSTRUCT('error', 'Template name is required.')::STRING;
  END IF;
  IF (v_scope NOT IN ('PLANNING', 'COMMERCIAL', 'BOTH')) THEN
    RETURN OBJECT_CONSTRUCT(
      'error', 'Scope must be PLANNING, COMMERCIAL or BOTH, got "' || :v_scope || '".'
    )::STRING;
  END IF;
  IF (TRIM(COALESCE(:P_TEMPLATE_TEXT, '')) = '') THEN
    RETURN OBJECT_CONSTRUCT(
      'error', 'Template text is required: it defines the sections of the assessment.'
    )::STRING;
  END IF;

  -- Version comes from HISTORY, not from the current row. History is
  -- append-only, so it remains correct even if the current row was deleted and
  -- the template later recreated under the same name -- versions keep counting
  -- up instead of silently restarting at 1 and colliding.
  SELECT COALESCE(MAX(VERSION), 0) + 1
    INTO :v_version
    FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE_HISTORY
   WHERE TEMPLATE_NAME = :v_name;

  MERGE INTO BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE t
  USING (SELECT :v_name AS TEMPLATE_NAME) s
     ON t.TEMPLATE_NAME = s.TEMPLATE_NAME
  WHEN MATCHED THEN UPDATE SET
        t.DESCRIPTION   = :P_DESCRIPTION,
        t.SOP_TEXT      = :P_SOP_TEXT,
        t.TEMPLATE_TEXT = :P_TEMPLATE_TEXT,
        t.SCOPE         = :v_scope,
        t.IS_DEFAULT    = COALESCE(:P_IS_DEFAULT, FALSE),
        t.VERSION       = :v_version,
        t.UPDATED_AT    = :v_now,
        t.UPDATED_BY    = :P_UPDATED_BY
  WHEN NOT MATCHED THEN INSERT
        (TEMPLATE_NAME, DESCRIPTION, SOP_TEXT, TEMPLATE_TEXT, SCOPE,
         IS_DEFAULT, VERSION, UPDATED_AT, UPDATED_BY)
        VALUES
        (:v_name, :P_DESCRIPTION, :P_SOP_TEXT, :P_TEMPLATE_TEXT, :v_scope,
         COALESCE(:P_IS_DEFAULT, FALSE), :v_version, :v_now, :P_UPDATED_BY);

  INSERT INTO BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE_HISTORY
        (TEMPLATE_NAME, VERSION, DESCRIPTION, SOP_TEXT, TEMPLATE_TEXT, SCOPE,
         CHANGED_AT, CHANGED_BY, CHANGE_NOTE)
  SELECT :v_name, :v_version, :P_DESCRIPTION, :P_SOP_TEXT, :P_TEMPLATE_TEXT,
         :v_scope, :v_now, :P_UPDATED_BY, :P_CHANGE_NOTE;

  -- Exactly one default at a time.
  IF (COALESCE(:P_IS_DEFAULT, FALSE)) THEN
    UPDATE BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE
       SET IS_DEFAULT = FALSE
     WHERE TEMPLATE_NAME <> :v_name;
  END IF;

  RETURN OBJECT_CONSTRUCT(
    'template_name', :v_name,
    'version',       :v_version,
    'scope',         :v_scope,
    'updated_at',    :v_now::STRING
  )::STRING;
END;
$$;

-- ---------- 5. Seed templates ----------
-- Three starting points so the feature demos immediately instead of opening on
-- an empty state. MERGE ... WHEN NOT MATCHED only: a rerun will not overwrite
-- edits a user has made to these.
--
-- The distinction that matters, and that the /settings page explains:
--   SOP_TEXT      = how to assess. Thresholds, what counts as material, tone.
--   TEMPLATE_TEXT = the output shape. Its markdown headings become the
--                   assessment's sections, in order.
MERGE INTO BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE t
USING (
  SELECT * FROM VALUES
  (
    'Monthly trade review',
    'Standing monthly review across the merchandise plan and category performance.',
    'BOTH',
    TRUE,
    -- SOP
    'You are preparing the standing monthly trade review for Baby Mart Global Planning, read by the Head of Central Planning & Inventory alongside Category Managers.

MATERIALITY THRESHOLDS
- A sales variance to budget is material at +/- 5%, and urgent at +/- 10%.
- A POS margin gap is material at 1.5pp, and urgent at 3pp.
- Forward cover is material above 1.6x target (overbought) or below 0.5x target (underbought).
- Ignore variances smaller than these. Do not pad the review with immaterial movements.

HOW TO JUDGE
- A class or department with an lfl_strategy of D is in a DELIBERATE planned decline. Judge it against budget only; never report its negative growth as a risk in itself.
- Where sales hold but margin falls, lead with the margin problem. A sales-only read makes these look healthy and they are the ones that get missed.
- Always name the specific department or class to act on. A finding that names no node is not actionable.
- Connect the plan to the buy: if a department is behind budget and its classes are overbought, say so as one problem, not two.

TONE
- Direct and quantified. Every claim carries its number.
- No filler, no restating the data back without interpretation.
- Amounts in PHP for planning figures and AUD for category and vendor figures. Do not convert between them.',
    -- TEMPLATE
    '## Headline
One paragraph: the single most important thing the reader must know this month.

## Trading position
How the merchandise plan is tracking to budget and to last year. Cover the RBU first, then name the departments driving the variance.

## Margin watch
Where rate is being lost or gained, and what is causing it.

## Inventory and open-to-buy
Buy position, forward cover and remaining buying capacity. Call out overbought and underbought classes.

## Category and vendor performance
Brand and supplier performance, including any supplier reliability issues affecting the plan.

## Points requiring a decision
The open questions this assessment surfaces, each naming the node and the metric behind it. State what needs deciding, not what to decide.'
  ),
  (
    -- PLANNING-ONLY TWIN OF THE ABOVE.
    -- The merchandise-planning persona reports on the FORWARD plan: the F27 MFP
    -- and buy position, at RBU / DEPARTMENT / CLASS grain, denominated in PHP.
    -- The category persona reports on HISTORIC sell-through by category and
    -- brand, in AUD. Both are Baby Mart, but they are different grains in
    -- different currencies over different time horizons. Running the BOTH-scope
    -- template from the planning side produced a "Category and vendor
    -- performance" section quoting AUD brand sales in the middle of a PHP plan
    -- review, which reads as two reports stapled together -- so the planning
    -- persona defaults to this template instead. Same SOP and thresholds; the
    -- commercial section is replaced by supplier exposure, which IS part of the
    -- merchandise plan.
    --
    -- NOTE: seeding here is MERGE ... WHEN NOT MATCHED only, deliberately, so a
    -- redeploy never overwrites a template the user has edited in the app. The
    -- consequence is that edits made HERE do not reach an already-deployed row:
    -- push those with SAVE_ASSESSMENT_TEMPLATE instead.
    'Monthly merchandise review',
    'Standing monthly review of the Baby Mart merchandise plan and buy position.',
    'PLANNING',
    FALSE,
    'You are preparing the standing monthly trade review for Baby Mart Global Planning, read by the Head of Central Planning & Inventory alongside Category Managers.

MATERIALITY THRESHOLDS
- A sales variance to budget is material at +/- 5%, and urgent at +/- 10%.
- A POS margin gap is material at 1.5pp, and urgent at 3pp.
- Forward cover is material above 1.6x target (overbought) or below 0.5x target (underbought).
- Ignore variances smaller than these. Do not pad the review with immaterial movements.

HOW TO JUDGE
- A class or department with an lfl_strategy of D is in a DELIBERATE planned decline. Judge it against budget only; never report its negative growth as a risk in itself.
- Where sales hold but margin falls, lead with the margin problem. A sales-only read makes these look healthy and they are the ones that get missed.
- Always name the specific department or class to act on. A finding that names no node is not actionable.
- Connect the plan to the buy: if a department is behind budget and its classes are overbought, say so as one problem, not two.

TONE
- Direct and quantified. Every claim carries its number.
- No filler, no restating the data back without interpretation.',
    '## Headline
One paragraph: the single most important thing the reader must know this month.

## Trading position
How the merchandise plan is tracking to budget and to last year. Cover the whole business first, then name the departments driving the variance.

## Margin watch
Where rate is being lost or gained, and what is causing it.

## Inventory and open-to-buy
Buy position, forward cover and remaining buying capacity. Call out overbought and underbought classes.

## Supplier exposure
Committed spend by supplier and any reliability issues affecting the plan.

## Points requiring a decision
The open questions this assessment surfaces, each naming the node and the metric behind it. State what needs deciding, not what to decide.'
  ),
  (
    'Pre-buy sign-off',
    'Focused open-to-buy and commitment review before releasing a buy.',
    'PLANNING',
    FALSE,
    'You are reviewing the open-to-buy position immediately before a buy is released, for the Planning Manager who must sign it off.

Your job is to answer one question: is it safe to commit this spend?

WHAT TO EXAMINE
- Remaining open-to-buy headroom, and whether it is negative anywhere.
- Forward cover against target, at class level. Overbought classes must not receive more stock.
- Supplier commitments already in flight, and any ETA slippage that changes when stock actually lands.
- Whether the sales forecast supporting the buy is itself tracking to budget. Buying to a forecast that is already missing is the most expensive mistake available here.

RULES
- Be conservative. If the data does not support releasing the buy, say so plainly.
- Quantify the exposure in PHP, not in adjectives.
- A delayed purchase order does not reduce committed spend; it moves when the stock arrives. Do not treat slippage as freed-up capacity.',
    '## Recommendation
Release, release with amendments, or hold. State it in the first sentence.

## Open-to-buy position
Headroom by department, and where it is negative.

## Cover risk
Classes that are overbought or underbought against target.

## Supplier exposure
Committed spend, delayed orders and the effect of slippage on landed stock.

## Conditions of sign-off
What must change before this buy is released.'
  ),
  (
    'Supplier negotiation prep',
    'Category and vendor performance framed for an upcoming supplier conversation.',
    'COMMERCIAL',
    FALSE,
    'You are preparing a Category Manager for a supplier negotiation.

WHAT MATTERS
- Margin performance against the category, in both rate and cash.
- Revenue growth and category share, and the direction of travel.
- Delivered-in-full-on-time performance, since service failure is leverage.
- Promotional efficiency: which mechanics return margin and which buy volume at a loss.
- Customer value, where a brand recruits or retains customers worth more than its revenue share suggests.

RULES
- Every argument must be backed by a figure the supplier could verify against their own data.
- Distinguish rate gaps in percentage points from cash gaps in AUD. Confusing the two loses credibility in the room.
- Lead with the strongest lever, not the first one you find.
- Do not speculate about the supplier''s cost base, shelf productivity per linear metre, or their margins. There is no data for any of it.',
    '## Negotiation position
Where we stand with this category and the direction of travel.

## Strongest levers
The two or three arguments that carry the most weight, each with its figure.

## Service and reliability
Delivery performance, and how it can be used.

## Promotional efficiency
What is working, what is buying volume at the expense of margin.

## The ask
What to request, and the value of it if granted.'
  )
  AS v(TEMPLATE_NAME, DESCRIPTION, SCOPE, IS_DEFAULT, SOP_TEXT, TEMPLATE_TEXT)
) s
   ON t.TEMPLATE_NAME = s.TEMPLATE_NAME
WHEN NOT MATCHED THEN INSERT
     (TEMPLATE_NAME, DESCRIPTION, SOP_TEXT, TEMPLATE_TEXT, SCOPE,
      IS_DEFAULT, VERSION, UPDATED_AT, UPDATED_BY)
     VALUES
     (s.TEMPLATE_NAME, s.DESCRIPTION, s.SOP_TEXT, s.TEMPLATE_TEXT, s.SCOPE,
      s.IS_DEFAULT, 1, CURRENT_TIMESTAMP(), 'seed');

-- History for the seeds, so version 1 is present and the history panel is never
-- empty for a template that has not yet been edited.
INSERT INTO BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE_HISTORY
      (TEMPLATE_NAME, VERSION, DESCRIPTION, SOP_TEXT, TEMPLATE_TEXT, SCOPE,
       CHANGED_AT, CHANGED_BY, CHANGE_NOTE)
SELECT t.TEMPLATE_NAME, t.VERSION, t.DESCRIPTION, t.SOP_TEXT, t.TEMPLATE_TEXT,
       t.SCOPE, t.UPDATED_AT, t.UPDATED_BY, 'Seeded default template'
  FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE t
 WHERE t.UPDATED_BY = 'seed'
   AND NOT EXISTS (
     SELECT 1 FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE_HISTORY h
      WHERE h.TEMPLATE_NAME = t.TEMPLATE_NAME AND h.VERSION = t.VERSION
   );
