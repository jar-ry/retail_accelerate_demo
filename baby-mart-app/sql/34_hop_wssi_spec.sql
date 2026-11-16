-- ============================================================
-- Head of Planning — the 140-row WSSI layout
--
-- The layout: six groups in the planner's reading order -- TOTAL, FP, CL,
-- MARKDOWN, PURCHASES, STOCK -- each row stating what it reads and how. It is a
-- specification, not a description of one, so the grid renders from it and cannot
-- drift from it.
--
-- Every row lands in exactly one of six kinds, and the kind reaches the cell so
-- three things that look identical on screen are never confused: a measured zero,
-- a figure resting on an assumption, and a feed that has never been supplied.
--
--   FACT         reads a column of the weekly fact at the row's version
--   CALC         derived from other measures -- rates rebuilt, never averaged
--   VARIANCE     a ratio of two versions of the block above it
--   PLANNED      a planning input the business intends to type; seeded default
--   PLACEHOLDER  INVENTED so the layout can be exercised before a feed exists,
--                flagged on every cell it touches -- and on every cell DERIVED
--                from it, because a margin struck on an invented denominator is
--                also invented
--   AWAITING     no feed supplied; the row says why instead of rendering blank
--
-- MEASURE_BASIS separates the two kinds of FACT: MEASURED (real POS) and MODELLED
-- (stock, receipts and commitments -- see 33_hop_wssi_fact.sql for why). The grid
-- propagates the weaker basis through every calculation that uses it.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

CREATE OR REPLACE TABLE WSSI_ROW_MEASURE_MAP (
  DISPLAY_ORDER    NUMBER,
  METRIC_GROUP     VARCHAR,
  ROW_LABEL        VARCHAR,
  VERSION_HINT     VARCHAR COMMENT 'TY | FC | BUD | LY, or NULL for a position read at this year''s actuals.',
  IS_VARIANCE_ROW  BOOLEAN,
  MEASURE_CODE     VARCHAR,
  ROW_KIND         VARCHAR COMMENT 'FACT | CALC | VARIANCE | PLANNED | PLACEHOLDER | AWAITING',
  MEASURE_BASIS    VARCHAR COMMENT 'For FACT rows: MEASURED | MODELLED | PLAN. CALC rows inherit from their inputs.',
  SOURCE_KIND      VARCHAR,
  FORMULA_TEXT     VARCHAR,
  AWAITING_REASON  VARCHAR COMMENT 'Why a row has no measure behind it, shown on the row so an absent feed reads as absent, not zero.'
) COMMENT = 'The 140-row WSSI layout: which measure each display row resolves to, and how.';

INSERT INTO WSSI_ROW_MEASURE_MAP
SELECT DISPLAY_ORDER, METRIC_GROUP, ROW_LABEL,
       NULLIF(VERSION_HINT, ''), IS_VARIANCE_ROW, NULLIF(MEASURE_CODE, ''), ROW_KIND,
       NULLIF(MEASURE_BASIS, ''), SOURCE_KIND, NULLIF(FORMULA_TEXT, ''), NULLIF(AWAITING_REASON, '')
FROM VALUES
  -- ---- TOTAL ----
  (  1,'TOTAL','TY SLS AUD','TY',FALSE,'SLS_AUD','FACT','MEASURED','POS','Net sales through the till',''),
  (  2,'TOTAL','FC SLS AUD','FC',FALSE,'SLS_AUD','FACT','PLAN','UPLOAD','Merch forecast, re-uploaded monthly',''),
  (  3,'TOTAL','BUD SLS AUD','BUD',FALSE,'SLS_AUD','FACT','PLAN','UPLOAD','Budget, locked each half: the store plan by department',''),
  (  4,'TOTAL','LY SLS AUD','LY',FALSE,'SLS_AUD','FACT','MEASURED','POS','Same week last year, 364 days earlier',''),
  (  5,'TOTAL','TY SLS AUD vs FC %','',TRUE,'','VARIANCE','','DERIVED','TY SLS AUD / FC SLS AUD - 1',''),
  (  6,'TOTAL','TY SLS AUD vs BUD %','',TRUE,'','VARIANCE','','DERIVED','TY SLS AUD / BUD SLS AUD - 1',''),
  (  7,'TOTAL','TY SLS AUD vs LY %','',TRUE,'','VARIANCE','','DERIVED','TY SLS AUD / LY SLS AUD - 1',''),
  (  8,'TOTAL','TY SLS U','TY',FALSE,'SLS_U','FACT','MEASURED','POS','Units through the till',''),
  (  9,'TOTAL','FC SLS U','FC',FALSE,'SLS_U','FACT','PLAN','UPLOAD','',''),
  ( 10,'TOTAL','BUD SLS U','BUD',FALSE,'SLS_U','FACT','PLAN','UPLOAD','',''),
  ( 11,'TOTAL','LY SLS U','LY',FALSE,'SLS_U','FACT','MEASURED','POS','',''),
  ( 12,'TOTAL','TY ASP','TY',FALSE,'ASP','CALC','','DERIVED','TY SLS AUD / TY SLS U',''),
  ( 13,'TOTAL','LY ASP','LY',FALSE,'ASP','CALC','','DERIVED','LY SLS AUD / LY SLS U',''),
  ( 14,'TOTAL','TY POS GP %','TY',FALSE,'POS_GP_PCT','CALC','','DERIVED','TY POS GP AUD / TY SLS AUD',''),
  ( 15,'TOTAL','FC POS GP %','FC',FALSE,'POS_GP_PCT','CALC','','DERIVED','FC POS GP AUD / FC SLS AUD',''),
  ( 16,'TOTAL','BUD POS GP %','BUD',FALSE,'POS_GP_PCT','CALC','','DERIVED','BUD POS GP AUD / BUD SLS AUD',''),
  ( 17,'TOTAL','LY POS GP %','LY',FALSE,'POS_GP_PCT','CALC','','DERIVED','LY POS GP AUD / LY SLS AUD',''),
  ( 18,'TOTAL','TY POS GP AUD','TY',FALSE,'POS_GP_AUD','FACT','MEASURED','POS','Exit margin: sales less landed cost, after discount',''),
  ( 19,'TOTAL','FC POS GP AUD','FC',FALSE,'POS_GP_AUD','FACT','PLAN','UPLOAD','',''),
  ( 20,'TOTAL','BUD POS GP AUD','BUD',FALSE,'POS_GP_AUD','FACT','PLAN','UPLOAD','',''),
  ( 21,'TOTAL','LY POS GP AUD','LY',FALSE,'POS_GP_AUD','FACT','MEASURED','POS','',''),
  ( 22,'TOTAL','TY POS GP vs FC %','',TRUE,'','VARIANCE','','DERIVED','TY POS GP AUD / FC POS GP AUD - 1',''),
  ( 23,'TOTAL','TY POS GP vs BUD %','',TRUE,'','VARIANCE','','DERIVED','TY POS GP AUD / BUD POS GP AUD - 1',''),
  ( 24,'TOTAL','TY POS GP vs LY %','',TRUE,'','VARIANCE','','DERIVED','TY POS GP AUD / LY POS GP AUD - 1',''),
  -- ---- FP (full price) ----
  ( 25,'FP','TY FP SLS AUD','TY',FALSE,'SLS_FP_AUD','FACT','MEASURED','POS','POS lines with no discount and no promotion',''),
  ( 26,'FP','FC FP SLS AUD','FC',FALSE,'SLS_FP_AUD','FACT','PLAN','UPLOAD','',''),
  ( 27,'FP','BUD FP SLS AUD','BUD',FALSE,'BUD_SLS_FP_AUD','PLACEHOLDER','','ASSUMPTION','BUD SLS AUD x last year''s full-price mix',''),
  ( 28,'FP','LY FP SLS AUD','LY',FALSE,'SLS_FP_AUD','FACT','MEASURED','POS','',''),
  ( 29,'FP','TY FP SLS vs FC %','',TRUE,'','VARIANCE','','DERIVED','TY FP SLS AUD / FC FP SLS AUD - 1',''),
  ( 30,'FP','TY FP SLS vs LY %','',TRUE,'','VARIANCE','','DERIVED','TY FP SLS AUD / LY FP SLS AUD - 1',''),
  ( 31,'FP','TY FP MIX %','TY',FALSE,'FP_MIX_PCT','CALC','','DERIVED','TY FP SLS AUD / TY SLS AUD',''),
  ( 32,'FP','LY FP MIX %','LY',FALSE,'FP_MIX_PCT','CALC','','DERIVED','LY FP SLS AUD / LY SLS AUD',''),
  ( 33,'FP','TY FP SLS U','TY',FALSE,'SLS_FP_U','FACT','MEASURED','POS','',''),
  ( 34,'FP','FC FP SLS U','FC',FALSE,'SLS_FP_U','FACT','PLAN','UPLOAD','',''),
  ( 35,'FP','LY FP SLS U','LY',FALSE,'SLS_FP_U','FACT','MEASURED','POS','',''),
  ( 36,'FP','FP CSOH U','',FALSE,'FP_CSOH_U','PLACEHOLDER','','ASSUMPTION','TTL CSOH UNITS x full-price share of stock',''),
  ( 37,'FP','FP CSOH C AUD','',FALSE,'FP_CSOH_C_AUD','PLACEHOLDER','','ASSUMPTION','TTL CSOH C AUD x full-price share of stock',''),
  ( 38,'FP','FP COGS AUD','TY',FALSE,'FP_COGS_AUD','CALC','','DERIVED','TY FP SLS AUD - TY FP POS GP AUD',''),
  ( 39,'FP','FP FWD WKS CVR','',FALSE,'FP_FWD_WKS_CVR','CALC','','DERIVED','FP CSOH C AUD / next four weeks'' FP COGS per week',''),
  ( 40,'FP','FP SPOT WKS CVR','',FALSE,'FP_SPOT_WKS_CVR','CALC','','DERIVED','FP CSOH C AUD / this period''s FP COGS per week',''),
  ( 41,'FP','TY FP ASP','TY',FALSE,'FP_ASP','CALC','','DERIVED','TY FP SLS AUD / TY FP SLS U',''),
  ( 42,'FP','LY FP ASP','LY',FALSE,'FP_ASP','CALC','','DERIVED','LY FP SLS AUD / LY FP SLS U',''),
  ( 43,'FP','TY FP POS GP %','TY',FALSE,'FP_GP_PCT','CALC','','DERIVED','TY FP POS GP AUD / TY FP SLS AUD',''),
  ( 44,'FP','FC FP POS GP %','FC',FALSE,'FP_GP_PCT','CALC','','DERIVED','FC FP POS GP AUD / FC FP SLS AUD',''),
  ( 45,'FP','LY FP POS GP %','LY',FALSE,'FP_GP_PCT','CALC','','DERIVED','LY FP POS GP AUD / LY FP SLS AUD',''),
  ( 46,'FP','TY FP POS GP AUD','TY',FALSE,'FP_GP_AUD','FACT','MEASURED','POS','',''),
  ( 47,'FP','FC FP POS GP AUD','FC',FALSE,'FP_GP_AUD','FACT','PLAN','UPLOAD','',''),
  ( 48,'FP','LY FP POS GP AUD','LY',FALSE,'FP_GP_AUD','FACT','MEASURED','POS','',''),
  ( 49,'FP','TY FP POS GP vs FC %','',TRUE,'','VARIANCE','','DERIVED','TY FP POS GP AUD / FC FP POS GP AUD - 1',''),
  ( 50,'FP','TY FP POS GP vs LY %','',TRUE,'','VARIANCE','','DERIVED','TY FP POS GP AUD / LY FP POS GP AUD - 1',''),
  -- ---- CL (clearance: discounted or promoted) ----
  ( 51,'CL','TY CL SLS AUD','TY',FALSE,'SLS_CL_AUD','FACT','MEASURED','POS','POS lines carrying a discount or a promotion',''),
  ( 52,'CL','FC CL SLS AUD','FC',FALSE,'SLS_CL_AUD','FACT','PLAN','UPLOAD','',''),
  ( 53,'CL','LY CL SLS AUD','LY',FALSE,'SLS_CL_AUD','FACT','MEASURED','POS','',''),
  ( 54,'CL','TY CL SLS vs FC %','',TRUE,'','VARIANCE','','DERIVED','TY CL SLS AUD / FC CL SLS AUD - 1',''),
  ( 55,'CL','TY CL SLS vs LY %','',TRUE,'','VARIANCE','','DERIVED','TY CL SLS AUD / LY CL SLS AUD - 1',''),
  ( 56,'CL','TY MD MIX %','TY',FALSE,'CL_MIX_PCT','CALC','','DERIVED','TY CL SLS AUD / TY SLS AUD',''),
  ( 57,'CL','LY MD MIX %','LY',FALSE,'CL_MIX_PCT','CALC','','DERIVED','LY CL SLS AUD / LY SLS AUD',''),
  ( 58,'CL','TY CL SLS U','TY',FALSE,'SLS_CL_U','FACT','MEASURED','POS','',''),
  ( 59,'CL','FC CL SLS U','FC',FALSE,'SLS_CL_U','FACT','PLAN','UPLOAD','',''),
  ( 60,'CL','LY CL SLS U','LY',FALSE,'SLS_CL_U','FACT','MEASURED','POS','',''),
  ( 61,'CL','CL CSOH U','',FALSE,'CL_CSOH_U','PLACEHOLDER','','ASSUMPTION','TTL CSOH UNITS x clearance share of stock',''),
  ( 62,'CL','CL CSOH C AUD','',FALSE,'CL_CSOH_C_AUD','PLACEHOLDER','','ASSUMPTION','TTL CSOH C AUD x clearance share of stock',''),
  ( 63,'CL','CL COGS AUD','TY',FALSE,'CL_COGS_AUD','CALC','','DERIVED','TY CL SLS AUD - TY CL POS GP AUD',''),
  ( 64,'CL','CL FWD WKS CVR','',FALSE,'CL_FWD_WKS_CVR','CALC','','DERIVED','CL CSOH C AUD / next four weeks'' CL COGS per week',''),
  ( 65,'CL','CL SPOT WKS CVR','',FALSE,'CL_SPOT_WKS_CVR','CALC','','DERIVED','CL CSOH C AUD / this period''s CL COGS per week',''),
  ( 66,'CL','TY CL ASP','TY',FALSE,'CL_ASP','CALC','','DERIVED','TY CL SLS AUD / TY CL SLS U',''),
  ( 67,'CL','LY CL ASP','LY',FALSE,'CL_ASP','CALC','','DERIVED','LY CL SLS AUD / LY CL SLS U',''),
  ( 68,'CL','TY CL POS GP %','TY',FALSE,'CL_GP_PCT','CALC','','DERIVED','TY CL POS GP AUD / TY CL SLS AUD',''),
  ( 69,'CL','FC CL POS GP %','FC',FALSE,'CL_GP_PCT','CALC','','DERIVED','FC CL POS GP AUD / FC CL SLS AUD',''),
  ( 70,'CL','LY CL POS GP %','LY',FALSE,'CL_GP_PCT','CALC','','DERIVED','LY CL POS GP AUD / LY CL SLS AUD',''),
  ( 71,'CL','TY CL POS GP AUD','TY',FALSE,'CL_GP_AUD','FACT','MEASURED','POS','',''),
  ( 72,'CL','FC CL POS GP AUD','FC',FALSE,'CL_GP_AUD','FACT','PLAN','UPLOAD','',''),
  ( 73,'CL','LY CL POS GP AUD','LY',FALSE,'CL_GP_AUD','FACT','MEASURED','POS','',''),
  ( 74,'CL','TY CL POS GP vs FC %','',TRUE,'','VARIANCE','','DERIVED','TY CL POS GP AUD / FC CL POS GP AUD - 1',''),
  ( 75,'CL','TY CL POS GP vs LY %','',TRUE,'','VARIANCE','','DERIVED','TY CL POS GP AUD / LY CL POS GP AUD - 1',''),
  -- ---- MARKDOWN (planning inputs) ----
  ( 76,'MARKDOWN','EXIT TO MARKDOWN AUD','',FALSE,'MD_EXIT_AUD','PLANNED','','PLANNER','Full-price stock moved to clearance this period',''),
  ( 77,'MARKDOWN','EXIT TO MARKDOWN FP POS GP %','',FALSE,'MD_EXIT_FP_GP_PCT','PLANNED','','PLANNER','Margin the exited stock carried at full price',''),
  ( 78,'MARKDOWN','MARKDOWN DEPTH %','',FALSE,'MD_DEPTH_PCT','PLANNED','','PLANNER','Average discount on a clearance line',''),
  ( 79,'MARKDOWN','MARKDOWN SPEND AUD','',FALSE,'MD_SPEND_AUD','PLANNED','','PLANNER','Value given away in discount',''),
  ( 80,'MARKDOWN','MARKDOWN UNITS','',FALSE,'MD_UNITS','PLANNED','','PLANNER','Units sold on a discount',''),
  -- ---- PURCHASES ----
  ( 81,'PURCHASES','TY ON ORDER C AUD','',FALSE,'ON_ORDER_C_AUD','PLACEHOLDER','','ASSUMPTION','Share of this period''s purchases already on order, at cost',''),
  ( 82,'PURCHASES','TY ON ORDER R AUD','',FALSE,'ON_ORDER_R_AUD','PLACEHOLDER','','ASSUMPTION','The same, at retail',''),
  ( 83,'PURCHASES','TY ON ORDER UNITS','',FALSE,'ON_ORDER_UNITS','PLACEHOLDER','','ASSUMPTION','The same, in units',''),
  ( 84,'PURCHASES','TY ON ORDER FM %','',FALSE,'ON_ORDER_FM_PCT','CALC','','DERIVED','(ON ORDER R - ON ORDER C) / ON ORDER R',''),
  ( 85,'PURCHASES','COMMITTED R AUD','',FALSE,'COMMIT_R_AUD','FACT','MODELLED','MODEL','Receipts due in the next six weeks already committed, at retail',''),
  ( 86,'PURCHASES','COMMITTED C AUD','',FALSE,'COMMIT_C_AUD','FACT','MODELLED','MODEL','The same, at landed cost',''),
  ( 87,'PURCHASES','COMMITTED UNITS','',FALSE,'U_COMMIT','FACT','MODELLED','MODEL','The same, in units',''),
  ( 88,'PURCHASES','COMMITTED FM %','',FALSE,'COMMITTED_FM_PCT','CALC','','DERIVED','(COMMITTED R - COMMITTED C) / COMMITTED R',''),
  ( 89,'PURCHASES','COMMITTED ASP','',FALSE,'COMMITTED_ASP','CALC','','DERIVED','COMMITTED R AUD / COMMITTED UNITS',''),
  ( 90,'PURCHASES','UNCOMMITTED C AUD','',FALSE,'UNCOMMITTED_C_AUD','PLACEHOLDER','','ASSUMPTION','Share of this period''s purchases not yet ordered, at cost',''),
  ( 91,'PURCHASES','UNCOMMITTED R AUD','',FALSE,'UNCOMMITTED_R_AUD','PLACEHOLDER','','ASSUMPTION','The same, at retail',''),
  ( 92,'PURCHASES','UNCOMMITTED UNITS','',FALSE,'UNCOMMITTED_UNITS','PLACEHOLDER','','ASSUMPTION','The same, in units',''),
  ( 93,'PURCHASES','UNCOMMITTED FM %','',FALSE,'UNCOMMITTED_FM_PCT','CALC','','DERIVED','(UNCOMMITTED R - UNCOMMITTED C) / UNCOMMITTED R',''),
  ( 94,'PURCHASES','UNCOMMITTED ASP','',FALSE,'UNCOMMITTED_ASP','CALC','','DERIVED','UNCOMMITTED R AUD / UNCOMMITTED UNITS',''),
  ( 95,'PURCHASES','OTB C AUD','',FALSE,'OTB_C_AUD','CALC','','DERIVED','TY PURCHASES C AUD - TY ON ORDER C AUD',''),
  ( 96,'PURCHASES','OTB R AUD','',FALSE,'OTB_R_AUD','CALC','','DERIVED','TY PURCHASES R AUD - TY ON ORDER R AUD',''),
  ( 97,'PURCHASES','OTB UNITS','',FALSE,'OTB_UNITS','CALC','','DERIVED','TY PURCHASES UNITS - TY ON ORDER UNITS',''),
  ( 98,'PURCHASES','OTB FM %','',FALSE,'OTB_FM_PCT','CALC','','DERIVED','(OTB R AUD - OTB C AUD) / OTB R AUD',''),
  ( 99,'PURCHASES','OTB ASP','',FALSE,'OTB_ASP','CALC','','DERIVED','OTB R AUD / OTB UNITS',''),
  (100,'PURCHASES','TY PURCHASES C AUD','',FALSE,'C_REC_AUD','FACT','MODELLED','MODEL','Receipts at landed cost: what tops stock back up to plan cover',''),
  (101,'PURCHASES','TY PURCHASES R AUD','',FALSE,'R_REC_AUD','FACT','MODELLED','MODEL','Receipts at retail, at the planned intake margin',''),
  (102,'PURCHASES','TY PURCHASES UNITS','',FALSE,'U_REC','FACT','MODELLED','MODEL','Receipts in units',''),
  (103,'PURCHASES','TY PURCHASES FM %','',FALSE,'PURCHASES_FM_PCT','CALC','','DERIVED','(TY PURCHASES R - TY PURCHASES C) / TY PURCHASES R',''),
  (104,'PURCHASES','FC PURCHASES C AUD','FC',FALSE,'','AWAITING','','NONE','To be uploaded with the monthly forecast','No purchase forecast feed is held. Receipts are modelled for this year only, to roll stock forward.'),
  (105,'PURCHASES','FC PURCHASES R AUD','FC',FALSE,'','AWAITING','','NONE','','No purchase forecast feed is held.'),
  (106,'PURCHASES','FC PURCHASES UNITS','FC',FALSE,'','AWAITING','','NONE','','No purchase forecast feed is held.'),
  (107,'PURCHASES','FC PURCHASES FM %','FC',FALSE,'','AWAITING','','NONE','','No purchase forecast feed is held.'),
  (108,'PURCHASES','BUD PURCHASES C AUD','BUD',FALSE,'','AWAITING','','NONE','To be uploaded with the half''s budget','No purchase budget is held: CURATED.FACT_BUDGET is empty.'),
  (109,'PURCHASES','BUD PURCHASES R AUD','BUD',FALSE,'','AWAITING','','NONE','','No purchase budget is held: CURATED.FACT_BUDGET is empty.'),
  (110,'PURCHASES','BUD PURCHASES UNITS','BUD',FALSE,'','AWAITING','','NONE','','No purchase budget is held: CURATED.FACT_BUDGET is empty.'),
  (111,'PURCHASES','BUD PURCHASES FM %','BUD',FALSE,'','AWAITING','','NONE','','No purchase budget is held: CURATED.FACT_BUDGET is empty.'),
  (112,'PURCHASES','LY PURCHASES C AUD','LY',FALSE,'','AWAITING','','NONE','Units x landed cost from purchase history','No purchase history is held: CURATED.FACT_PURCHASE_ORDERS is empty.'),
  (113,'PURCHASES','LY PURCHASES R AUD','LY',FALSE,'','AWAITING','','NONE','','No purchase history is held: CURATED.FACT_PURCHASE_ORDERS is empty.'),
  (114,'PURCHASES','LY PURCHASES UNITS','LY',FALSE,'','AWAITING','','NONE','','No purchase history is held: CURATED.FACT_PURCHASE_ORDERS is empty.'),
  (115,'PURCHASES','LY PURCHASES FM %','LY',FALSE,'','AWAITING','','NONE','','No purchase history is held: CURATED.FACT_PURCHASE_ORDERS is empty.'),
  (116,'PURCHASES','FP STOCK ADJUSTMENTS R AUD','',FALSE,'FP_STOCK_ADJ_R_AUD','PLANNED','','PLANNER','Stocktake and write-off adjustments, full price, at retail',''),
  (117,'PURCHASES','CL STOCK ADJUSTMENTS R AUD','',FALSE,'CL_STOCK_ADJ_R_AUD','PLANNED','','PLANNER','The same, clearance',''),
  -- ---- STOCK ----
  (118,'STOCK','TOTAL STOCK ADJUSTMENTS R AUD','',FALSE,'TTL_STOCK_ADJ_R_AUD','CALC','','DERIVED','FP + CL STOCK ADJUSTMENTS R AUD',''),
  (119,'STOCK','FP STOCK ADJUSTMENTS C AUD','',FALSE,'FP_STOCK_ADJ_C_AUD','PLANNED','','PLANNER','',''),
  (120,'STOCK','CL STOCK ADJUSTMENTS C AUD','',FALSE,'CL_STOCK_ADJ_C_AUD','PLANNED','','PLANNER','',''),
  (121,'STOCK','TOTAL STOCK ADJUSTMENTS C AUD','',FALSE,'TTL_STOCK_ADJ_C_AUD','CALC','','DERIVED','FP + CL STOCK ADJUSTMENTS C AUD',''),
  (122,'STOCK','FP STOCK ADJUSTMENTS UNITS','',FALSE,'FP_STOCK_ADJ_UNITS','PLANNED','','PLANNER','',''),
  (123,'STOCK','CL STOCK ADJUSTMENTS UNITS','',FALSE,'CL_STOCK_ADJ_UNITS','PLANNED','','PLANNER','',''),
  (124,'STOCK','TOTAL STOCK ADJUSTMENTS UNITS','',FALSE,'TTL_STOCK_ADJ_UNITS','CALC','','DERIVED','FP + CL STOCK ADJUSTMENTS UNITS',''),
  (125,'STOCK','SHRINK %','',FALSE,'SHRINK_PCT','PLANNED','','PLANNER','Stock lost to theft and damage, as a share of stock',''),
  (126,'STOCK','SHRINK C AUD','',FALSE,'SHRINK_C_AUD','CALC','','DERIVED','SHRINK % x TTL CSOH C AUD',''),
  (127,'STOCK','TTL CSOH C AUD','',FALSE,'C_CLS_INV_AUD','FACT','MODELLED','MODEL','Closing stock at landed cost',''),
  (128,'STOCK','TTL CSOH R AUD','',FALSE,'TTL_CSOH_R_AUD','PLACEHOLDER','','ASSUMPTION','Closing stock at retail: cost grossed up at last year''s intake margin',''),
  (129,'STOCK','TTL CSOH MARGIN %','',FALSE,'TTL_CSOH_MARGIN_PCT','CALC','','DERIVED','(TTL CSOH R AUD - TTL CSOH C AUD) / TTL CSOH R AUD',''),
  (130,'STOCK','TTL CSOH UNITS','',FALSE,'U_CLS_INV','FACT','MODELLED','MODEL','Store plus DC closing units',''),
  (131,'STOCK','TTL CSOH ASP','',FALSE,'TTL_CSOH_ASP','CALC','','DERIVED','TTL CSOH R AUD / TTL CSOH UNITS',''),
  (132,'STOCK','TTL SPOT CVR R','',FALSE,'TTL_SPOT_CVR_R','CALC','','DERIVED','TTL CSOH R AUD / this period''s sales per week',''),
  (133,'STOCK','TTL FWD CVR C','',FALSE,'TTL_FWD_CVR_C','CALC','','DERIVED','TTL CSOH C AUD / next four weeks'' COGS per week',''),
  (134,'STOCK','TTL FWD CVR R','',FALSE,'TTL_FWD_CVR_R','CALC','','DERIVED','TTL CSOH R AUD / next four weeks'' sales per week',''),
  (135,'STOCK','STORE INTAKE','',FALSE,'STORE_REC_UNIT','FACT','MODELLED','MODEL','Units sent from DC to store',''),
  (136,'STOCK','STORE CSOH U','',FALSE,'U_CLS_INV_STORE','FACT','MODELLED','MODEL','Closing units in store',''),
  (137,'STOCK','STORE FWD WKS CVR','',FALSE,'STORE_FWD_WKS_CVR','CALC','','DERIVED','STORE CSOH U / next four weeks'' units per week',''),
  (138,'STOCK','DC CSOH U','',FALSE,'U_CLS_INV_DC','FACT','MODELLED','MODEL','Closing units in the DC',''),
  (139,'STOCK','DC FWD WKS CVR','',FALSE,'DC_FWD_WKS_CVR','CALC','','DERIVED','DC CSOH U / next four weeks'' units per week',''),
  (140,'STOCK','TTL COGS AUD','',FALSE,'TTL_COGS_AUD','CALC','','DERIVED','TY SLS AUD - TY POS GP AUD','')
AS t(DISPLAY_ORDER, METRIC_GROUP, ROW_LABEL, VERSION_HINT, IS_VARIANCE_ROW, MEASURE_CODE, ROW_KIND,
     MEASURE_BASIS, SOURCE_KIND, FORMULA_TEXT, AWAITING_REASON);

-- ---------- The assumptions behind measures the data cannot supply ----------
-- A basis measure and a factor per measure, NOT fabricated week rows: each one is a
-- single reviewable assumption. Where Baby Mart's own POS can anchor a factor it
-- does -- the markdown defaults, the full-price share of stock, the retail gross-up
-- of stock -- but a data-anchored assumption is still an assumption, and
-- IS_PLACEHOLDER survives to the grid.
CREATE OR REPLACE TABLE MISSING_WSSI_MEASURES (
  MEASURE_CODE    VARCHAR,
  MEASURE_LABEL   VARCHAR,
  METRIC_GROUP    VARCHAR,
  VALUE_KIND      VARCHAR COMMENT 'PLANNER_INPUT | PLACEHOLDER',
  IS_PLACEHOLDER  BOOLEAN,
  BASIS_MEASURE   VARCHAR COMMENT 'Column the value is a factor of. NULL when the measure is itself a rate.',
  FACTOR          FLOAT,
  BASIS_NOTE      VARCHAR,
  PROVENANCE      VARCHAR,
  SET_BY          VARCHAR,
  SET_AT          TIMESTAMP_NTZ
) COMMENT = 'One row per WSSI measure the source cannot supply, and the assumption standing in for it.';

INSERT INTO MISSING_WSSI_MEASURES
WITH ly AS (
  SELECT SUM(tl.DISCOUNT_AMOUNT) / NULLIF(SUM(tl.NET_REVENUE), 0)                                   AS DISC_TO_SALES,
         SUM(IFF(tl.DISCOUNT_AMOUNT > 0, tl.DISCOUNT_AMOUNT, 0))
           / NULLIF(SUM(IFF(tl.DISCOUNT_AMOUNT > 0, tl.NET_REVENUE + tl.DISCOUNT_AMOUNT, 0)), 0)   AS DEPTH,
         SUM(IFF(tl.DISCOUNT_AMOUNT > 0 OR tl.PROMOTION_KEY IS NOT NULL, tl.QUANTITY, 0))
           / NULLIF(SUM(tl.QUANTITY), 0)                                                            AS CL_UNIT_SHARE,
         1 - SUM(IFF(tl.DISCOUNT_AMOUNT > 0 OR tl.PROMOTION_KEY IS NOT NULL, tl.NET_REVENUE, 0))
           / NULLIF(SUM(tl.NET_REVENUE), 0)                                                         AS FP_MIX,
         SUM(tl.QUANTITY * (p.UNIT_RETAIL - p.UNIT_COST)) / NULLIF(SUM(tl.QUANTITY * p.UNIT_RETAIL), 0) AS INTAKE_MARGIN
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = tl.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  WHERE d.CALENDAR_DATE BETWEEN '2025-06-30' AND '2025-12-28'
)
SELECT c.MEASURE_CODE, c.MEASURE_LABEL, c.METRIC_GROUP, c.VALUE_KIND, c.IS_PLACEHOLDER,
       NULLIF(c.BASIS_MEASURE, ''),
       ROUND(CASE c.FACTOR_SOURCE
         WHEN 'DISC_TO_SALES' THEN ly.DISC_TO_SALES
         WHEN 'DEPTH'         THEN ly.DEPTH
         WHEN 'CL_UNIT_SHARE' THEN ly.CL_UNIT_SHARE
         WHEN 'FP_MIX'        THEN ly.FP_MIX
         WHEN 'CL_MIX'        THEN 1 - ly.FP_MIX
         WHEN 'GROSS_UP'      THEN 1 / (1 - ly.INTAKE_MARGIN)
         ELSE c.FIXED_FACTOR
       END, 4),
       c.BASIS_NOTE, c.PROVENANCE, 'seed', '2026-05-22 10:00:00'::TIMESTAMP_NTZ
FROM ly,
(SELECT * FROM VALUES
  ('MD_EXIT_AUD',        'Exit to markdown',            'MARKDOWN',  'PLANNER_INPUT', FALSE, 'SLS_CL_AUD',    '', 0.25,
   'A quarter of clearance sales assumed to come from stock exited from full price this period.', 'Planning default'),
  ('MD_EXIT_FP_GP_PCT',  'Exit to markdown FP GP %',    'MARKDOWN',  'PLANNER_INPUT', FALSE, '',              '', 0.20,
   'Margin the exited stock carried at full price.', 'Planning default'),
  ('MD_DEPTH_PCT',       'Markdown depth %',            'MARKDOWN',  'PLANNER_INPUT', FALSE, '',              'DEPTH', NULL,
   'Seeded from FY26 H1 POS: the average discount on a discounted line.', 'Data-anchored default'),
  ('MD_SPEND_AUD',       'Markdown spend',              'MARKDOWN',  'PLANNER_INPUT', FALSE, 'SLS_AUD',       'DISC_TO_SALES', NULL,
   'Seeded from FY26 H1 POS: discount given away as a share of net sales.', 'Data-anchored default'),
  ('MD_UNITS',           'Markdown units',              'MARKDOWN',  'PLANNER_INPUT', FALSE, 'SLS_U',         'CL_UNIT_SHARE', NULL,
   'Seeded from FY26 H1 POS: the share of units sold on a discount or promotion.', 'Data-anchored default'),
  ('SHRINK_PCT',         'Shrink %',                    'STOCK',     'PLANNER_INPUT', FALSE, '',              '', 0.0015,
   'No shrink feed is held. 0.15% of stock a week -- about 1.3% of sales a year -- is a planning default.', 'Planning default'),
  ('FP_STOCK_ADJ_R_AUD', 'FP stock adjustments R',      'PURCHASES', 'PLANNER_INPUT', FALSE, 'C_CLS_INV_AUD', '', -0.0010, 'Stocktake write-down default.', 'Planning default'),
  ('CL_STOCK_ADJ_R_AUD', 'CL stock adjustments R',      'PURCHASES', 'PLANNER_INPUT', FALSE, 'C_CLS_INV_AUD', '', -0.0005, 'Stocktake write-down default.', 'Planning default'),
  ('FP_STOCK_ADJ_C_AUD', 'FP stock adjustments C',      'STOCK',     'PLANNER_INPUT', FALSE, 'C_CLS_INV_AUD', '', -0.0007, 'Stocktake write-down default.', 'Planning default'),
  ('CL_STOCK_ADJ_C_AUD', 'CL stock adjustments C',      'STOCK',     'PLANNER_INPUT', FALSE, 'C_CLS_INV_AUD', '', -0.00035,'Stocktake write-down default.', 'Planning default'),
  ('FP_STOCK_ADJ_UNITS', 'FP stock adjustments units',  'STOCK',     'PLANNER_INPUT', FALSE, 'U_CLS_INV',     '', -0.0010, 'Stocktake write-down default.', 'Planning default'),
  ('CL_STOCK_ADJ_UNITS', 'CL stock adjustments units',  'STOCK',     'PLANNER_INPUT', FALSE, 'U_CLS_INV',     '', -0.0005, 'Stocktake write-down default.', 'Planning default'),
  ('TTL_CSOH_R_AUD',     'Closing stock at retail',     'STOCK',     'PLACEHOLDER',   TRUE,  'C_CLS_INV_AUD', 'GROSS_UP', NULL,
   'INVENTED. No retail-valued stock is held. Cost stock grossed up at FY26 H1 intake margin. Three STOCK rows depend on it.', 'ASSUMPTION'),
  ('FP_CSOH_C_AUD',      'FP closing stock at cost',    'FP',        'PLACEHOLDER',   TRUE,  'C_CLS_INV_AUD', 'FP_MIX', NULL,
   'INVENTED. Stock is not split by full price and clearance; assumed to split like FY26 H1 sales.', 'ASSUMPTION'),
  ('FP_CSOH_U',          'FP closing units',            'FP',        'PLACEHOLDER',   TRUE,  'U_CLS_INV',     'FP_MIX', NULL,
   'INVENTED. Assumed to split like FY26 H1 sales.', 'ASSUMPTION'),
  ('CL_CSOH_C_AUD',      'CL closing stock at cost',    'CL',        'PLACEHOLDER',   TRUE,  'C_CLS_INV_AUD', 'CL_MIX', NULL,
   'INVENTED. Assumed to split like FY26 H1 sales.', 'ASSUMPTION'),
  ('CL_CSOH_U',          'CL closing units',            'CL',        'PLACEHOLDER',   TRUE,  'U_CLS_INV',     'CL_MIX', NULL,
   'INVENTED. Assumed to split like FY26 H1 sales.', 'ASSUMPTION'),
  ('ON_ORDER_C_AUD',     'On order at cost',            'PURCHASES', 'PLACEHOLDER',   TRUE,  'C_REC_AUD',     '', 0.60,
   'INVENTED. No open-order feed: 60% of each period''s purchases assumed already on order.', 'ASSUMPTION'),
  ('ON_ORDER_R_AUD',     'On order at retail',          'PURCHASES', 'PLACEHOLDER',   TRUE,  'R_REC_AUD',     '', 0.60, 'INVENTED. As above.', 'ASSUMPTION'),
  ('ON_ORDER_UNITS',     'On order units',              'PURCHASES', 'PLACEHOLDER',   TRUE,  'U_REC',         '', 0.60, 'INVENTED. As above.', 'ASSUMPTION'),
  ('UNCOMMITTED_C_AUD',  'Uncommitted at cost',         'PURCHASES', 'PLACEHOLDER',   TRUE,  'C_REC_AUD',     '', 0.40,
   'INVENTED. The remaining 40% of each period''s purchases, not yet ordered.', 'ASSUMPTION'),
  ('UNCOMMITTED_R_AUD',  'Uncommitted at retail',       'PURCHASES', 'PLACEHOLDER',   TRUE,  'R_REC_AUD',     '', 0.40, 'INVENTED. As above.', 'ASSUMPTION'),
  ('UNCOMMITTED_UNITS',  'Uncommitted units',           'PURCHASES', 'PLACEHOLDER',   TRUE,  'U_REC',         '', 0.40, 'INVENTED. As above.', 'ASSUMPTION'),
  ('BUD_SLS_FP_AUD',     'Budget full-price sales',     'FP',        'PLACEHOLDER',   TRUE,  'SLS_AUD',       'FP_MIX', NULL,
   'INVENTED. The budget carries total sales only; split at FY26 H1''s full-price mix.', 'ASSUMPTION')
 AS t(MEASURE_CODE, MEASURE_LABEL, METRIC_GROUP, VALUE_KIND, IS_PLACEHOLDER, BASIS_MEASURE, FACTOR_SOURCE, FIXED_FACTOR, BASIS_NOTE, PROVENANCE)
) c;

-- ---------- Planner inputs and display overrides ----------
-- A planner input is stored per WEEK in the same form as the seeded default it
-- replaces: a RATE for a rate (shrink %, markdown depth %), a FACTOR on the basis
-- measure for an amount (markdown spend = sales x factor). An amount typed for a
-- month across an RBU is therefore spread over its weeks and departments in
-- proportion to the basis, and adds back to exactly what was typed. The typed
-- figure is kept beside it, so the trail records what the planner actually entered.
--
-- Inputs apply only to the CURRENT trading position, and only to weeks that have
-- not traded: they never restate last year, a traded week, or the locked budget.
CREATE OR REPLACE TABLE WSSI_PLANNED_INPUT (
  INPUT_ID          NUMBER IDENTITY(1,1),
  BATCH_ID          VARCHAR COMMENT 'One edit writes one row per week; they share a batch.',
  MARKET_CODE       VARCHAR,
  RBU_CODE          VARCHAR COMMENT 'NULL applies the value to every RBU. Where scopes overlap, the latest input wins.',
  WEEK_END_DATE     DATE,
  MEASURE_CODE      VARCHAR,
  VALUE_FORM        VARCHAR COMMENT 'RATE | FACTOR (a multiplier on MISSING_WSSI_MEASURES.BASIS_MEASURE).',
  OLD_VALUE         FLOAT COMMENT 'The displayed value before the edit, at the typed grain.',
  NEW_VALUE         FLOAT COMMENT 'The stored rate or factor for this week.',
  TYPED_GRAIN       VARCHAR,
  TYPED_PERIOD_KEY  VARCHAR,
  TYPED_VALUE       FLOAT COMMENT 'What the planner typed, at the typed grain and scope.',
  REASON_CODE       VARCHAR,
  RATIONALE         VARCHAR,
  CHANGED_BY        VARCHAR,
  CHANGED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Append-only planner inputs for PLANNED rows (markdown, shrink, stock adjustments), per week. Latest row wins over the seeded default.';

CREATE OR REPLACE TABLE WSSI_CELL_OVERRIDE (
  OVERRIDE_ID    NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  MARKET_CODE    VARCHAR,
  TIME_GRAIN     VARCHAR,
  PERIOD_KEY     VARCHAR,
  RBU_SCOPE      VARCHAR COMMENT 'ALL, or an RBU code.',
  DISPLAY_ORDER  NUMBER,
  ROW_LABEL      VARCHAR,
  OLD_VALUE      FLOAT,
  NEW_VALUE      FLOAT,
  REASON_CODE    VARCHAR,
  RATIONALE      VARCHAR,
  CHANGED_BY     VARCHAR,
  CHANGED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Append-only overrides of a DISPLAYED WSSI result. Source facts, components and lower-grain periods are unchanged.';
