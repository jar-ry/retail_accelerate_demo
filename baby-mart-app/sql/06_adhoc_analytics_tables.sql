-- ============================================================
-- Baby Mart Demo - Ad-hoc ANALYTICS tables
--
-- These 7 tables were originally created interactively and were never captured
-- in the numbered scripts. This file is now their authoritative definition --
-- DDL plus data -- so a clean-slate run reproduces them. Every one is read by
-- an app route, so none can be dropped.
--
-- Target schema is controlled by the USE SCHEMA below.
-- ============================================================

USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ----------------------------------------------------------
-- BRAND_INVENTORY_WEEKLY (120 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE BRAND_INVENTORY_WEEKLY (
	BRAND_NAME VARCHAR(16777216),
	CATEGORY VARCHAR(16777216),
	WEEK_DATE DATE,
	WEEK_LABEL VARCHAR(16777216),
	IS_FORECAST BOOLEAN,
	OPENING_STOCK NUMBER(38,0),
	DEMAND_UNITS NUMBER(38,0),
	DELIVERY_UNITS NUMBER(38,0),
	CLOSING_STOCK NUMBER(38,0),
	SHELF_STOCK_PCT NUMBER(5,1),
	REORDER_POINT NUMBER(38,0),
	SAFETY_STOCK NUMBER(38,0)
);

INSERT INTO BRAND_INVENTORY_WEEKLY (BRAND_NAME, CATEGORY, WEEK_DATE, WEEK_LABEL, IS_FORECAST, OPENING_STOCK, DEMAND_UNITS, DELIVERY_UNITS, CLOSING_STOCK, SHELF_STOCK_PCT, REORDER_POINT, SAFETY_STOCK)
SELECT * FROM VALUES
    ('Huggies', 'Nappies & Wipes', '2026-03-31', 'W-8', FALSE, 1420, 128, 0, 1292, '98.2', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-04-07', 'W-7', FALSE, 1292, 131, 0, 1161, '98.0', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-04-14', 'W-6', FALSE, 1161, 126, 0, 1035, '97.8', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-04-21', 'W-5', FALSE, 1035, 134, 768, 1669, '98.5', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-04-28', 'W-4', FALSE, 1669, 130, 0, 1539, '98.4', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-05-05', 'W-3', FALSE, 1539, 127, 0, 1412, '98.2', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-05-12', 'W-2', FALSE, 1412, 133, 0, 1279, '98.0', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-05-19', 'W-1', FALSE, 1279, 129, 0, 1150, '97.6', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-05-26', 'F+1', TRUE, 1150, 131, 0, 1019, '97.2', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-06-02', 'F+2', TRUE, 1019, 128, 768, 1659, '98.4', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-06-09', 'F+3', TRUE, 1659, 132, 0, 1527, '98.3', 512, 256),
    ('Huggies', 'Nappies & Wipes', '2026-06-16', 'F+4', TRUE, 1527, 130, 0, 1397, '98.1', 512, 256),
    ('Bugaboo', 'Prams & Strollers', '2026-03-31', 'W-8', FALSE, 68, 4, 0, 64, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-04-07', 'W-7', FALSE, 64, 3, 0, 61, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-04-14', 'W-6', FALSE, 61, 5, 36, 92, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-04-21', 'W-5', FALSE, 92, 4, 0, 88, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-04-28', 'W-4', FALSE, 88, 3, 0, 85, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-05-05', 'W-3', FALSE, 85, 5, 0, 80, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-05-12', 'W-2', FALSE, 80, 4, 0, 76, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-05-19', 'W-1', FALSE, 76, 3, 0, 73, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-05-26', 'F+1', TRUE, 73, 4, 0, 69, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-06-02', 'F+2', TRUE, 69, 4, 0, 65, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-06-09', 'F+3', TRUE, 65, 5, 36, 96, '99.0', 18, 9),
    ('Bugaboo', 'Prams & Strollers', '2026-06-16', 'F+4', TRUE, 96, 4, 0, 92, '99.0', 18, 9),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-03-31', 'W-8', FALSE, 680, 82, 0, 598, '97.5', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-04-07', 'W-7', FALSE, 598, 88, 0, 510, '96.8', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-04-14', 'W-6', FALSE, 510, 94, 0, 416, '95.2', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-04-21', 'W-5', FALSE, 416, 97, 480, 799, '98.1', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-04-28', 'W-4', FALSE, 799, 102, 0, 697, '97.8', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-05-05', 'W-3', FALSE, 697, 108, 0, 589, '97.0', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-05-12', 'W-2', FALSE, 589, 112, 0, 477, '95.8', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-05-19', 'W-1', FALSE, 477, 118, 0, 359, '93.4', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-05-26', 'F+1', TRUE, 359, 122, 0, 237, '86.2', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-06-02', 'F+2', TRUE, 237, 126, 0, 111, '72.8', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-06-09', 'F+3', TRUE, 111, 128, 480, 463, '95.1', 328, 164),
    ('Rascal + Friends', 'Nappies & Wipes', '2026-06-16', 'F+4', TRUE, 463, 132, 0, 331, '93.2', 328, 164),
    ('Uppababy', 'Prams & Strollers', '2026-03-31', 'W-8', FALSE, 42, 5, 0, 37, '98.5', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-04-07', 'W-7', FALSE, 37, 6, 0, 31, '97.2', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-04-14', 'W-6', FALSE, 31, 7, 24, 48, '98.8', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-04-21', 'W-5', FALSE, 48, 8, 0, 40, '98.4', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-04-28', 'W-4', FALSE, 40, 9, 0, 31, '97.0', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-05-05', 'W-3', FALSE, 31, 10, 0, 21, '94.8', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-05-12', 'W-2', FALSE, 21, 11, 0, 10, '78.5', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-05-19', 'W-1', FALSE, 10, 12, 24, 22, '92.3', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-05-26', 'F+1', TRUE, 22, 12, 0, 10, '76.2', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-06-02', 'F+2', TRUE, 10, 11, 24, 23, '91.8', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-06-09', 'F+3', TRUE, 23, 10, 0, 13, '82.4', 20, 10),
    ('Uppababy', 'Prams & Strollers', '2026-06-16', 'F+4', TRUE, 13, 9, 24, 28, '96.5', 20, 10),
    ('Maxi-Cosi', 'Car Seats', '2026-03-31', 'W-8', FALSE, 156, 14, 0, 142, '98.8', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-04-07', 'W-7', FALSE, 142, 13, 0, 129, '98.6', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-04-14', 'W-6', FALSE, 129, 15, 84, 198, '99.0', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-04-21', 'W-5', FALSE, 198, 14, 0, 184, '99.0', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-04-28', 'W-4', FALSE, 184, 16, 0, 168, '99.0', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-05-05', 'W-3', FALSE, 168, 15, 0, 153, '98.8', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-05-12', 'W-2', FALSE, 153, 14, 0, 139, '98.5', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-05-19', 'W-1', FALSE, 139, 16, 0, 123, '98.2', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-05-26', 'F+1', TRUE, 123, 15, 0, 108, '97.8', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-06-02', 'F+2', TRUE, 108, 14, 0, 94, '97.1', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-06-09', 'F+3', TRUE, 94, 15, 0, 79, '95.6', 56, 28),
    ('Maxi-Cosi', 'Car Seats', '2026-06-16', 'F+4', TRUE, 79, 16, 84, 147, '98.6', 56, 28),
    ('Pampers', 'Nappies & Wipes', '2026-03-31', 'W-8', FALSE, 1180, 108, 0, 1072, '98.4', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-04-07', 'W-7', FALSE, 1072, 112, 0, 960, '98.2', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-04-14', 'W-6', FALSE, 960, 106, 648, 1502, '98.8', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-04-21', 'W-5', FALSE, 1502, 110, 0, 1392, '98.6', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-04-28', 'W-4', FALSE, 1392, 114, 0, 1278, '98.4', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-05-05', 'W-3', FALSE, 1278, 108, 0, 1170, '98.2', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-05-12', 'W-2', FALSE, 1170, 112, 0, 1058, '97.9', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-05-19', 'W-1', FALSE, 1058, 110, 0, 948, '97.6', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-05-26', 'F+1', TRUE, 948, 111, 0, 837, '97.2', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-06-02', 'F+2', TRUE, 837, 109, 648, 1376, '98.5', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-06-09', 'F+3', TRUE, 1376, 113, 0, 1263, '98.3', 432, 216),
    ('Pampers', 'Nappies & Wipes', '2026-06-16', 'F+4', TRUE, 1263, 110, 0, 1153, '98.0', 432, 216),
    ('Cybex', 'Car Seats', '2026-03-31', 'W-8', FALSE, 84, 7, 0, 77, '98.5', 28, 14),
    ('Cybex', 'Car Seats', '2026-04-07', 'W-7', FALSE, 77, 6, 0, 71, '98.2', 28, 14),
    ('Cybex', 'Car Seats', '2026-04-14', 'W-6', FALSE, 71, 8, 0, 63, '97.8', 28, 14),
    ('Cybex', 'Car Seats', '2026-04-21', 'W-5', FALSE, 63, 7, 42, 98, '98.8', 28, 14),
    ('Cybex', 'Car Seats', '2026-04-28', 'W-4', FALSE, 98, 6, 0, 92, '98.6', 28, 14),
    ('Cybex', 'Car Seats', '2026-05-05', 'W-3', FALSE, 92, 8, 0, 84, '98.4', 28, 14),
    ('Cybex', 'Car Seats', '2026-05-12', 'W-2', FALSE, 84, 7, 0, 77, '98.2', 28, 14),
    ('Cybex', 'Car Seats', '2026-05-19', 'W-1', FALSE, 77, 7, 0, 70, '97.9', 28, 14),
    ('Cybex', 'Car Seats', '2026-05-26', 'F+1', TRUE, 70, 7, 0, 63, '97.6', 28, 14),
    ('Cybex', 'Car Seats', '2026-06-02', 'F+2', TRUE, 63, 8, 0, 55, '96.8', 28, 14),
    ('Cybex', 'Car Seats', '2026-06-09', 'F+3', TRUE, 55, 7, 42, 90, '98.4', 28, 14),
    ('Cybex', 'Car Seats', '2026-06-16', 'F+4', TRUE, 90, 7, 0, 83, '98.2', 28, 14),
    ('Bonds Baby', 'Clothing', '2026-03-31', 'W-8', FALSE, 420, 58, 0, 362, '98.0', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-04-07', 'W-7', FALSE, 362, 62, 0, 300, '96.8', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-04-14', 'W-6', FALSE, 300, 55, 348, 593, '98.6', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-04-21', 'W-5', FALSE, 593, 68, 0, 525, '98.4', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-04-28', 'W-4', FALSE, 525, 72, 0, 453, '98.1', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-05-05', 'W-3', FALSE, 453, 64, 0, 389, '97.6', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-05-12', 'W-2', FALSE, 389, 70, 0, 319, '96.4', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-05-19', 'W-1', FALSE, 319, 66, 0, 253, '94.8', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-05-26', 'F+1', TRUE, 253, 68, 0, 185, '91.2', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-06-02', 'F+2', TRUE, 185, 72, 348, 461, '97.8', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-06-09', 'F+3', TRUE, 461, 65, 0, 396, '97.4', 232, 116),
    ('Bonds Baby', 'Clothing', '2026-06-16', 'F+4', TRUE, 396, 70, 0, 326, '96.2', 232, 116),
    ('Dr Browns', 'Feeding', '2026-03-31', 'W-8', FALSE, 245, 27, 0, 218, '98.2', 108, 54),
    ('Dr Browns', 'Feeding', '2026-04-07', 'W-7', FALSE, 218, 29, 0, 189, '97.6', 108, 54),
    ('Dr Browns', 'Feeding', '2026-04-14', 'W-6', FALSE, 189, 26, 162, 325, '98.8', 108, 54),
    ('Dr Browns', 'Feeding', '2026-04-21', 'W-5', FALSE, 325, 31, 0, 294, '98.5', 108, 54),
    ('Dr Browns', 'Feeding', '2026-04-28', 'W-4', FALSE, 294, 28, 0, 266, '98.2', 108, 54),
    ('Dr Browns', 'Feeding', '2026-05-05', 'W-3', FALSE, 266, 34, 0, 232, '97.8', 108, 54),
    ('Dr Browns', 'Feeding', '2026-05-12', 'W-2', FALSE, 232, 32, 0, 200, '97.2', 108, 54),
    ('Dr Browns', 'Feeding', '2026-05-19', 'W-1', FALSE, 200, 38, 0, 162, '95.6', 108, 54),
    ('Dr Browns', 'Feeding', '2026-05-26', 'F+1', TRUE, 162, 36, 0, 126, '93.8', 108, 54),
    ('Dr Browns', 'Feeding', '2026-06-02', 'F+2', TRUE, 126, 34, 0, 92, '88.4', 108, 54),
    ('Dr Browns', 'Feeding', '2026-06-09', 'F+3', TRUE, 92, 32, 162, 222, '97.6', 108, 54),
    ('Dr Browns', 'Feeding', '2026-06-16', 'F+4', TRUE, 222, 35, 0, 187, '96.8', 108, 54),
    ('Infasecure', 'Car Seats', '2026-03-31', 'W-8', FALSE, 112, 9, 0, 103, '98.6', 36, 18),
    ('Infasecure', 'Car Seats', '2026-04-07', 'W-7', FALSE, 103, 8, 0, 95, '98.4', 36, 18),
    ('Infasecure', 'Car Seats', '2026-04-14', 'W-6', FALSE, 95, 10, 0, 85, '98.0', 36, 18),
    ('Infasecure', 'Car Seats', '2026-04-21', 'W-5', FALSE, 85, 9, 54, 130, '98.8', 36, 18),
    ('Infasecure', 'Car Seats', '2026-04-28', 'W-4', FALSE, 130, 8, 0, 122, '98.6', 36, 18),
    ('Infasecure', 'Car Seats', '2026-05-05', 'W-3', FALSE, 122, 10, 0, 112, '98.4', 36, 18),
    ('Infasecure', 'Car Seats', '2026-05-12', 'W-2', FALSE, 112, 9, 0, 103, '98.2', 36, 18),
    ('Infasecure', 'Car Seats', '2026-05-19', 'W-1', FALSE, 103, 8, 0, 95, '97.9', 36, 18),
    ('Infasecure', 'Car Seats', '2026-05-26', 'F+1', TRUE, 95, 9, 0, 86, '97.6', 36, 18),
    ('Infasecure', 'Car Seats', '2026-06-02', 'F+2', TRUE, 86, 10, 0, 76, '97.0', 36, 18),
    ('Infasecure', 'Car Seats', '2026-06-09', 'F+3', TRUE, 76, 9, 54, 121, '98.5', 36, 18),
    ('Infasecure', 'Car Seats', '2026-06-16', 'F+4', TRUE, 121, 9, 0, 112, '98.3', 36, 18)
AS t(BRAND_NAME, CATEGORY, WEEK_DATE, WEEK_LABEL, IS_FORECAST, OPENING_STOCK, DEMAND_UNITS, DELIVERY_UNITS, CLOSING_STOCK, SHELF_STOCK_PCT, REORDER_POINT, SAFETY_STOCK);

-- ----------------------------------------------------------
-- BRAND_SUPPLY_PROFILE (10 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE BRAND_SUPPLY_PROFILE (
	BRAND_NAME VARCHAR(16777216),
	CATEGORY VARCHAR(16777216),
	CURRENT_STOCK_UNITS NUMBER(38,0),
	DAILY_DEMAND NUMBER(8,1),
	WEEKLY_DEMAND NUMBER(38,0),
	REORDER_POINT NUMBER(38,0),
	SAFETY_STOCK NUMBER(38,0),
	LEAD_TIME_DAYS NUMBER(38,0),
	AVG_DELIVERY_QTY NUMBER(38,0),
	NEXT_DELIVERY_DATE DATE,
	NEXT_DELIVERY_QTY NUMBER(38,0),
	STOCKOUT_COST_PER_DAY NUMBER(38,0),
	SUPPLIER_NAME VARCHAR(16777216),
	ORDER_FREQUENCY_DAYS NUMBER(38,0),
	MIN_ORDER_QTY NUMBER(38,0),
	TARGET_WOC NUMBER(4,1)
);

INSERT INTO BRAND_SUPPLY_PROFILE (BRAND_NAME, CATEGORY, CURRENT_STOCK_UNITS, DAILY_DEMAND, WEEKLY_DEMAND, REORDER_POINT, SAFETY_STOCK, LEAD_TIME_DAYS, AVG_DELIVERY_QTY, NEXT_DELIVERY_DATE, NEXT_DELIVERY_QTY, STOCKOUT_COST_PER_DAY, SUPPLIER_NAME, ORDER_FREQUENCY_DAYS, MIN_ORDER_QTY, TARGET_WOC)
SELECT * FROM VALUES
    ('Huggies', 'Nappies & Wipes', 900, '50.0', 350, 700, 1844, 10, 768, '2026-06-02', 768, 1840, 'Kimberly-Clark', 21, 384, '8.0'),
    ('Bugaboo', 'Prams & Strollers', 73, '0.6', 4, 18, 9, 21, 36, '2026-06-09', 36, 4200, 'Bugaboo International', 42, 12, '8.0'),
    ('Uppababy', 'Prams & Strollers', 22, '1.6', 11, 20, 10, 18, 24, '2026-06-02', 24, 3680, 'UPPAbaby Inc', 28, 8, '8.0'),
    ('Rascal + Friends', 'Nappies & Wipes', 359, '16.9', 118, 328, 164, 12, 480, '2026-06-09', 480, 890, 'Rascal + Friends NZ', 18, 240, '8.0'),
    ('Maxi-Cosi', 'Car Seats', 123, '2.1', 15, 56, 28, 18, 84, '2026-06-16', 84, 2450, 'Dorel Industries', 28, 28, '8.0'),
    ('Pampers', 'Nappies & Wipes', 948, '15.4', 108, 432, 216, 10, 648, '2026-06-02', 648, 1620, 'Procter & Gamble', 21, 324, '8.0'),
    ('Cybex', 'Car Seats', 70, '1.0', 7, 28, 14, 24, 42, '2026-06-09', 42, 3100, 'Cybex GmbH (Germany)', 35, 14, '8.0'),
    ('Bonds Baby', 'Clothing', 253, '9.4', 66, 232, 116, 7, 348, '2026-06-02', 348, 560, 'Hanes Brands Pacific', 14, 174, '8.0'),
    ('Dr Browns', 'Feeding', 162, '4.9', 34, 108, 54, 12, 162, '2026-06-09', 162, 720, 'Handi-Craft Company', 21, 80, '8.0'),
    ('Infasecure', 'Car Seats', 95, '1.3', 9, 36, 18, 16, 54, '2026-06-09', 54, 1280, 'Infa Group Pty Ltd', 28, 18, '8.0')
AS t(BRAND_NAME, CATEGORY, CURRENT_STOCK_UNITS, DAILY_DEMAND, WEEKLY_DEMAND, REORDER_POINT, SAFETY_STOCK, LEAD_TIME_DAYS, AVG_DELIVERY_QTY, NEXT_DELIVERY_DATE, NEXT_DELIVERY_QTY, STOCKOUT_COST_PER_DAY, SUPPLIER_NAME, ORDER_FREQUENCY_DAYS, MIN_ORDER_QTY, TARGET_WOC);

-- ----------------------------------------------------------
-- CAMPAIGNS (4 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE CAMPAIGNS (
	CAMPAIGN_ID VARCHAR(20) NOT NULL,
	NAME VARCHAR(200) NOT NULL,
	STATUS VARCHAR(20) DEFAULT 'Draft',
	CHANNEL VARCHAR(50),
	AUDIENCE VARCHAR(200),
	AUDIENCE_SIZE NUMBER(38,0) DEFAULT 0,
	SENT NUMBER(38,0) DEFAULT 0,
	OPENED NUMBER(38,0) DEFAULT 0,
	CLICKED NUMBER(38,0) DEFAULT 0,
	CONVERTED NUMBER(38,0) DEFAULT 0,
	START_DATE DATE,
	END_DATE DATE,
	BUDGET NUMBER(38,0) DEFAULT 0,
	SPENT NUMBER(38,0) DEFAULT 0,
	DESTINATION VARCHAR(50) DEFAULT 'Braze',
	CREATED_AT TIMESTAMP_NTZ(9) DEFAULT CURRENT_TIMESTAMP(),
	primary key (CAMPAIGN_ID)
);

INSERT INTO CAMPAIGNS (CAMPAIGN_ID, NAME, STATUS, CHANNEL, AUDIENCE, AUDIENCE_SIZE, SENT, OPENED, CLICKED, CONVERTED, START_DATE, END_DATE, BUDGET, SPENT, DESTINATION, CREATED_AT)
SELECT * FROM VALUES
    ('camp-001', 'Crawler Nappies Surge — Loyalty Push', 'Active', 'Email + SMS', 'First-time Parents, NSW & QLD', 18400, 18400, 7360, 2944, 1178, '2026-04-28', '2026-05-26', 12000, 8450, 'Braze', '2026-04-25T09:00:00'),
    ('camp-002', 'Registry Completion — Expecting Mums', 'Draft', 'Email', 'Expecting, Registry Shoppers', 24600, 0, 0, 0, 0, '2026-06-01', '2026-06-30', 8000, 0, 'Hightouch', '2026-05-20T14:30:00'),
    ('camp-003', 'Back to Childcare — Toddler Essentials', 'Completed', 'Email + SMS', 'Second-time Parents, 25-44', 31200, 31200, 14040, 5616, 2493, '2026-01-15', '2026-02-15', 15000, 14200, 'Braze', '2026-01-10T10:00:00'),
    ('camp-004', 'Gold Member Early Access — Winter Sale', 'Paused', 'App Push', 'Gold & Platinum members', 12800, 12800, 8960, 3840, 1536, '2026-05-01', '2026-05-31', 5000, 3200, 'Braze', '2026-04-28T16:00:00')
AS t(CAMPAIGN_ID, NAME, STATUS, CHANNEL, AUDIENCE, AUDIENCE_SIZE, SENT, OPENED, CLICKED, CONVERTED, START_DATE, END_DATE, BUDGET, SPENT, DESTINATION, CREATED_AT);

-- ----------------------------------------------------------
-- ML_PRODUCT_RECOMMENDATIONS (41 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE ML_PRODUCT_RECOMMENDATIONS (
	RECOMMENDATION_ID NUMBER(38,0) autoincrement start 1 increment 1 noorder,
	SEGMENT_NAME VARCHAR(50),
	PRODUCT_KEY NUMBER(38,0),
	PRODUCT_NAME VARCHAR(200),
	BRAND_NAME VARCHAR(100),
	CATEGORY VARCHAR(50),
	CLASS VARCHAR(50),
	RECOMMENDATION_SCORE FLOAT,
	RECOMMENDATION_REASON VARCHAR(500),
	MODEL_VERSION VARCHAR(20),
	SCORED_AT TIMESTAMP_NTZ(9),
	IMPRESSIONS NUMBER(38,0) DEFAULT 0,
	CLICKS NUMBER(38,0) DEFAULT 0,
	CONVERSIONS NUMBER(38,0) DEFAULT 0,
	REVENUE_ATTRIBUTED NUMBER(38,0) DEFAULT 0,
	CTR FLOAT DEFAULT 0,
	CONVERSION_RATE FLOAT DEFAULT 0,
	REVENUE_PER_IMPRESSION FLOAT DEFAULT 0,
	RECOMMENDATION_TYPE VARCHAR(20),
	SOURCE_CATEGORY VARCHAR(50)
);

INSERT INTO ML_PRODUCT_RECOMMENDATIONS (RECOMMENDATION_ID, SEGMENT_NAME, PRODUCT_KEY, PRODUCT_NAME, BRAND_NAME, CATEGORY, CLASS, RECOMMENDATION_SCORE, RECOMMENDATION_REASON, MODEL_VERSION, SCORED_AT, IMPRESSIONS, CLICKS, CONVERSIONS, REVENUE_ATTRIBUTED, CTR, CONVERSION_RATE, REVENUE_PER_IMPRESSION, RECOMMENDATION_TYPE, SOURCE_CATEGORY)
SELECT * FROM VALUES
    (1, 'First-time Parents', 1, 'Bugaboo Single Stroller 1', 'Bugaboo', 'Prams & Strollers', 'Single Stroller', 0.96, 'Top purchased first item by new parents; 68% of segment buy within first 3 months', 'v2.3', '2026-06-08T04:00:00', 12400, 744, 89, 7420, 0.06, 0.12, 0.598, 'upsell', 'Prams & Strollers'),
    (2, 'First-time Parents', 45, 'Maxi-Cosi Infant Carrier 3', 'Maxi-Cosi', 'Car Seats', 'Infant Carrier', 0.94, 'Cross-category affinity: 72% of stroller buyers also purchase car seat within 2 weeks', 'v2.3', '2026-06-08T04:00:00', 11800, 649, 78, 5460, 0.055, 0.12, 0.463, 'cross_sell', 'Prams & Strollers'),
    (3, 'First-time Parents', 120, 'Huggies Newborn Nappies 1', 'Huggies', 'Nappies & Wipes', 'Newborn Nappies', 0.93, 'Category entry point: 70% of first-time parents start with Huggies Newborn', 'v2.3', '2026-06-08T04:00:00', 14200, 994, 142, 5680, 0.07, 0.143, 0.4, 'cross_sell', 'Prams & Strollers'),
    (4, 'First-time Parents', 200, 'Avent Bottle Set 2', 'Avent', 'Feeding', 'Bottles', 0.91, 'Collaborative filtering: similar parents bought this alongside nappies 64% of time', 'v2.3', '2026-06-08T04:00:00', 9800, 588, 65, 2340, 0.06, 0.111, 0.239, 'cross_sell', 'Prams & Strollers'),
    (5, 'First-time Parents', 15, 'Uppababy Travel System 1', 'Uppababy', 'Prams & Strollers', 'Travel System', 0.89, 'Premium alternative to Bugaboo; strong conversion in Gold loyalty tier', 'v2.3', '2026-06-08T04:00:00', 8400, 420, 38, 4560, 0.05, 0.09, 0.543, 'upsell', 'Prams & Strollers'),
    (6, 'First-time Parents', 300, 'Bonds Baby Starter Pack 1', 'Bonds Baby', 'Clothing', 'Basics', 0.87, 'High basket affinity with strollers and car seats; 58% cross-purchase rate', 'v2.3', '2026-06-08T04:00:00', 10200, 510, 56, 1680, 0.05, 0.11, 0.165, 'cross_sell', 'Prams & Strollers'),
    (7, 'First-time Parents', 55, 'Cybex Cloud T Capsule 1', 'Cybex', 'Car Seats', 'Capsule', 0.85, 'Content-based: matches premium price tier preference of segment', 'v2.3', '2026-06-08T04:00:00', 7600, 380, 34, 3060, 0.05, 0.089, 0.403, 'cross_sell', 'Prams & Strollers'),
    (8, 'Second-time Parents', 130, 'Rascal + Friends Crawler 5', 'Rascal + Friends', 'Nappies & Wipes', 'Crawler Nappies', 0.95, 'Switching signal: 28% of Huggies second-time parents switch for value', 'v2.3', '2026-06-08T04:00:00', 11200, 784, 102, 3570, 0.07, 0.13, 0.319, 'upsell', 'Nappies & Wipes'),
    (9, 'Second-time Parents', 125, 'Huggies Crawler Nappies 7', 'Huggies', 'Nappies & Wipes', 'Crawler Nappies', 0.92, 'Repeat purchase pattern: avg 3.2 orders/quarter from this segment', 'v2.3', '2026-06-08T04:00:00', 13500, 810, 97, 4365, 0.06, 0.12, 0.323, 'replenishment', 'Nappies & Wipes'),
    (10, 'Second-time Parents', 210, 'Tommee Tippee Sippy Cup 3', 'Tommee Tippee', 'Feeding', 'Cups', 0.9, 'Age-progression model: children of segment entering sippy cup stage', 'v2.3', '2026-06-08T04:00:00', 8900, 534, 59, 1652, 0.06, 0.11, 0.186, 'cross_sell', 'Nappies & Wipes'),
    (11, 'Second-time Parents', 25, 'Mountain Buggy Double 2', 'Mountain Buggy', 'Prams & Strollers', 'Double Stroller', 0.88, 'Life-stage signal: second child = double stroller demand spike', 'v2.3', '2026-06-08T04:00:00', 6400, 320, 26, 3380, 0.05, 0.081, 0.528, 'cross_sell', 'Nappies & Wipes'),
    (12, 'Second-time Parents', 310, 'Cotton On Baby Bundle 4', 'Cotton On Baby', 'Clothing', 'Basics', 0.86, 'Value-oriented alternative; high conversion in Silver loyalty tier', 'v2.3', '2026-06-08T04:00:00', 9200, 460, 51, 1275, 0.05, 0.111, 0.139, 'cross_sell', 'Nappies & Wipes'),
    (13, 'Second-time Parents', 140, 'Huggies Pull-Ups 10', 'Huggies', 'Nappies & Wipes', 'Pull-Ups', 0.84, 'Age progression: first child transitioning to training pants', 'v2.3', '2026-06-08T04:00:00', 7800, 468, 52, 1560, 0.06, 0.111, 0.2, 'upsell', 'Nappies & Wipes'),
    (14, 'Gift Buyers', 3, 'Bugaboo Single Stroller 3', 'Bugaboo', 'Prams & Strollers', 'Single Stroller', 0.93, 'Gift registry data: most-wished item in premium strollers', 'v2.3', '2026-06-08T04:00:00', 5400, 324, 29, 6380, 0.06, 0.09, 1.181, 'cross_sell', 'Clothing'),
    (15, 'Gift Buyers', 50, 'Nuna Infant Carrier 1', 'Nuna', 'Car Seats', 'Infant Carrier', 0.91, 'Premium price point matches gift buyer avg spend of $180+', 'v2.3', '2026-06-08T04:00:00', 4800, 288, 23, 4140, 0.06, 0.08, 0.863, 'cross_sell', 'Clothing'),
    (16, 'Gift Buyers', 320, 'Purebaby Gift Set 2', 'Purebaby', 'Clothing', 'Gift Sets', 0.9, 'Explicitly gift-positioned SKU; 82% purchased as gifts based on wrapping flag', 'v2.3', '2026-06-08T04:00:00', 6200, 434, 48, 2160, 0.07, 0.111, 0.348, 'cross_sell', 'Clothing'),
    (17, 'Gift Buyers', 205, 'Avent Premium Bottle Gift Set', 'Avent', 'Feeding', 'Gift Sets', 0.87, 'Cross-category gift bundle; high conversion during sale events', 'v2.3', '2026-06-08T04:00:00', 5800, 348, 35, 1575, 0.06, 0.101, 0.272, 'cross_sell', 'Clothing'),
    (18, 'Grandparents', 60, 'Britax Safe-n-Sound Toddler 2', 'Britax', 'Car Seats', 'Toddler Seat', 0.92, 'Safety-rated #1; grandparents over-index on safety features by 3.2x', 'v2.3', '2026-06-08T04:00:00', 4200, 252, 25, 2250, 0.06, 0.099, 0.536, 'cross_sell', 'Car Seats'),
    (19, 'Grandparents', 330, 'Marquise Heritage Outfit 1', 'Marquise', 'Clothing', 'Formal', 0.88, 'Premium gifting pattern: grandparents spend 2.4x avg on clothing', 'v2.3', '2026-06-08T04:00:00', 3800, 228, 21, 1260, 0.06, 0.092, 0.332, 'cross_sell', 'Car Seats'),
    (20, 'Grandparents', 215, 'Pigeon Wide-Neck Bottle 1', 'Pigeon', 'Feeding', 'Bottles', 0.85, 'Convenience purchase for grandparent homes; repeat every 4 months', 'v2.3', '2026-06-08T04:00:00', 3400, 204, 20, 540, 0.06, 0.098, 0.159, 'cross_sell', 'Car Seats'),
    (21, 'Expecting', 10, 'Uppababy Vista V2 1', 'Uppababy', 'Prams & Strollers', 'Single Stroller', 0.97, 'Highest research-to-purchase intent in expecting segment; 45% convert within 4 weeks', 'v2.3', '2026-06-08T04:00:00', 8200, 574, 52, 6240, 0.07, 0.091, 0.761, 'upsell', 'Prams & Strollers'),
    (22, 'Expecting', 46, 'Maxi-Cosi Pebble 360 1', 'Maxi-Cosi', 'Car Seats', 'Capsule', 0.95, 'Bundle affinity: 78% of expecting parents buy capsule + stroller together', 'v2.3', '2026-06-08T04:00:00', 7600, 532, 48, 4320, 0.07, 0.09, 0.568, 'cross_sell', 'Prams & Strollers'),
    (23, 'Expecting', 118, 'Huggies Newborn Nappies 3', 'Huggies', 'Nappies & Wipes', 'Newborn Nappies', 0.92, 'Pre-birth stocking: expecting parents buy 3-4 weeks before due date', 'v2.3', '2026-06-08T04:00:00', 9400, 658, 79, 3160, 0.07, 0.12, 0.336, 'cross_sell', 'Prams & Strollers'),
    (24, 'Expecting', 315, 'Bonds Baby Newborn Pack 1', 'Bonds Baby', 'Clothing', 'Newborn', 0.89, 'Content-based: newborn-sized clothing matches pre-birth shopping intent', 'v2.3', '2026-06-08T04:00:00', 7200, 432, 47, 1410, 0.06, 0.109, 0.196, 'cross_sell', 'Prams & Strollers'),
    (25, 'Registry Shoppers', 2, 'Bugaboo Single Stroller 2', 'Bugaboo', 'Prams & Strollers', 'Single Stroller', 0.94, 'Most-registered item across all registries; 3.2x higher conversion than browse', 'v2.3', '2026-06-08T04:00:00', 4600, 322, 35, 4200, 0.07, 0.109, 0.913, 'cross_sell', 'Feeding'),
    (26, 'Registry Shoppers', 48, 'Maxi-Cosi Mico Plus 1', 'Maxi-Cosi', 'Car Seats', 'Infant Carrier', 0.91, 'Registry completion pattern: 65% of registries include a car seat', 'v2.3', '2026-06-08T04:00:00', 4200, 294, 29, 2610, 0.07, 0.099, 0.621, 'cross_sell', 'Feeding'),
    (27, 'Registry Shoppers', 202, 'Avent Natural Bottle Set 1', 'Avent', 'Feeding', 'Bottles', 0.88, 'Registry staple: appears in 48% of all registries', 'v2.3', '2026-06-08T04:00:00', 5400, 378, 38, 1368, 0.07, 0.1, 0.253, 'cross_sell', 'Feeding'),
    (28, 'Registry Shoppers', 322, 'Purebaby Organic Set 1', 'Purebaby', 'Clothing', 'Organic', 0.86, 'Premium positioning aligns with registry gift price points ($50-$100)', 'v2.3', '2026-06-08T04:00:00', 3800, 228, 21, 1050, 0.06, 0.092, 0.276, 'cross_sell', 'Feeding'),
    (101, 'First-time Parents', 65, 'Britax Infant Carrier 1', 'Britax', 'Car Seats', 'Infant Carrier', 0.88, 'Cross-sell: 65% of stroller buyers add a car seat within 30 days', 'v2.3', '2026-06-08T04:00:00', 9200, 552, 55, 4950, 0.06, 0.1, 0.538, 'cross_sell', 'Prams & Strollers'),
    (102, 'Second-time Parents', 30, 'Silver Cross Double 1', 'Silver Cross', 'Prams & Strollers', 'Double Stroller', 0.86, 'Cross-sell: second child triggers double stroller demand from nappy buyers', 'v2.3', '2026-06-08T04:00:00', 5800, 290, 23, 3220, 0.05, 0.079, 0.555, 'cross_sell', 'Nappies & Wipes'),
    (103, 'Expecting', 220, 'Dr Browns Bottle Set 1', 'Dr Browns', 'Feeding', 'Bottles', 0.84, 'Cross-sell: expecting parents researching strollers also start feeding prep', 'v2.3', '2026-06-08T04:00:00', 6400, 384, 38, 1368, 0.06, 0.099, 0.214, 'cross_sell', 'Prams & Strollers'),
    (104, 'Grandparents', 135, 'Huggies Toddler Nappies 5', 'Huggies', 'Nappies & Wipes', 'Toddler Nappies', 0.83, 'Cross-sell: grandparents buying car seats also stock nappies for visits', 'v2.3', '2026-06-08T04:00:00', 4100, 246, 27, 810, 0.06, 0.11, 0.198, 'cross_sell', 'Car Seats'),
    (105, 'Registry Shoppers', 340, 'Bebe Formal Set 1', 'Bebe', 'Clothing', 'Formal', 0.82, 'Cross-sell: registry completers often add premium clothing gifts', 'v2.3', '2026-06-08T04:00:00', 3200, 192, 17, 850, 0.06, 0.089, 0.266, 'cross_sell', 'Feeding'),
    (106, 'First-time Parents', 8, 'Cybex Priam Stroller 1', 'Cybex', 'Prams & Strollers', 'Single Stroller', 0.9, 'Upsell: customers viewing Bugaboo also respond to Cybex premium at 15% higher AOV', 'v2.3', '2026-06-08T04:00:00', 7800, 390, 31, 5580, 0.05, 0.079, 0.715, 'upsell', 'Prams & Strollers'),
    (107, 'Second-time Parents', 128, 'Huggies Ultra Dry Crawler 3', 'Huggies', 'Nappies & Wipes', 'Crawler Nappies', 0.91, 'Upsell: move from value to premium tier with 22% margin uplift', 'v2.3', '2026-06-08T04:00:00', 10400, 624, 75, 3375, 0.06, 0.12, 0.325, 'upsell', 'Nappies & Wipes'),
    (108, 'Expecting', 52, 'Nuna PIPA Next 1', 'Nuna', 'Car Seats', 'Capsule', 0.87, 'Upsell: from Maxi-Cosi Pebble to premium Nuna at $120 higher price point', 'v2.3', '2026-06-08T04:00:00', 5600, 336, 27, 3240, 0.06, 0.08, 0.579, 'upsell', 'Car Seats'),
    (109, 'Gift Buyers', 5, 'Bugaboo Fox 5', 'Bugaboo', 'Prams & Strollers', 'Single Stroller', 0.89, 'Upsell: gift buyers respond to latest model positioning; 28% upgrade rate', 'v2.3', '2026-06-08T04:00:00', 4200, 252, 18, 4320, 0.06, 0.071, 1.029, 'upsell', 'Prams & Strollers'),
    (110, 'Second-time Parents', 122, 'Huggies Crawler Nappies 4', 'Huggies', 'Nappies & Wipes', 'Crawler Nappies', 0.93, 'Replenishment: avg reorder cycle 18 days; customer is due in 3 days', 'v2.3', '2026-06-08T04:00:00', 12800, 896, 134, 4690, 0.07, 0.15, 0.366, 'replenishment', 'Nappies & Wipes'),
    (111, 'First-time Parents', 119, 'Huggies Newborn Nappies 2', 'Huggies', 'Nappies & Wipes', 'Newborn Nappies', 0.94, 'Replenishment: high-frequency item; 85% reorder rate within 21 days', 'v2.3', '2026-06-08T04:00:00', 11600, 812, 122, 4880, 0.07, 0.15, 0.421, 'replenishment', 'Nappies & Wipes'),
    (112, 'Second-time Parents', 141, 'Huggies Pull-Ups 11', 'Huggies', 'Nappies & Wipes', 'Pull-Ups', 0.88, 'Replenishment: toilet training phase; consistent 3-week reorder pattern', 'v2.3', '2026-06-08T04:00:00', 8200, 574, 69, 2070, 0.07, 0.12, 0.252, 'replenishment', 'Nappies & Wipes'),
    (113, 'Grandparents', 216, 'Pigeon Wide-Neck Bottle 3', 'Pigeon', 'Feeding', 'Bottles', 0.81, 'Replenishment: grandparent home stock refresh; avg 4-month cycle', 'v2.3', '2026-06-08T04:00:00', 2800, 168, 17, 459, 0.06, 0.101, 0.164, 'replenishment', 'Feeding')
AS t(RECOMMENDATION_ID, SEGMENT_NAME, PRODUCT_KEY, PRODUCT_NAME, BRAND_NAME, CATEGORY, CLASS, RECOMMENDATION_SCORE, RECOMMENDATION_REASON, MODEL_VERSION, SCORED_AT, IMPRESSIONS, CLICKS, CONVERSIONS, REVENUE_ATTRIBUTED, CTR, CONVERSION_RATE, REVENUE_PER_IMPRESSION, RECOMMENDATION_TYPE, SOURCE_CATEGORY);

-- ----------------------------------------------------------
-- SKU_INVENTORY_WEEKLY (120 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE SKU_INVENTORY_WEEKLY (
	BRAND_NAME VARCHAR(16777216),
	SKU_CLASS VARCHAR(16777216),
	CATEGORY VARCHAR(16777216),
	DC_STATE VARCHAR(16777216),
	WEEK_DATE DATE,
	WEEK_LABEL VARCHAR(16777216),
	IS_FORECAST BOOLEAN,
	OPENING_STOCK NUMBER(38,0),
	DEMAND_UNITS NUMBER(38,0),
	DELIVERY_UNITS NUMBER(38,0),
	CLOSING_STOCK NUMBER(38,0),
	SHELF_STOCK_PCT NUMBER(5,1),
	REORDER_POINT NUMBER(38,0)
);

INSERT INTO SKU_INVENTORY_WEEKLY (BRAND_NAME, SKU_CLASS, CATEGORY, DC_STATE, WEEK_DATE, WEEK_LABEL, IS_FORECAST, OPENING_STOCK, DEMAND_UNITS, DELIVERY_UNITS, CLOSING_STOCK, SHELF_STOCK_PCT, REORDER_POINT)
SELECT * FROM VALUES
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-03-31', 'W-8', FALSE, 620, 196, 0, 1080, '98.4', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-07', 'W-7', FALSE, 572, 211, 0, 1060, '98.2', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-14', 'W-6', FALSE, 522, 222, 0, 1075, '97.8', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-21', 'W-5', FALSE, 476, 255, 400, 1040, '98.6', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-28', 'W-4', FALSE, 712, 290, 0, 985, '98.5', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-05', 'W-3', FALSE, 663, 325, 0, 920, '98.3', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-12', 'W-2', FALSE, 616, 340, 320, 900, '98.1', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-19', 'W-1', FALSE, 565, 350, 0, 900, '97.8', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-26', 'F+1', TRUE, 517, 360, 200, 740, '97.4', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-02', 'F+2', TRUE, 467, 370, 400, 770, '98.5', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-09', 'F+3', TRUE, 707, 380, 200, 590, '98.4', 192),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-16', 'F+4', TRUE, 655, 385, 200, 405, '98.2', 192),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-03-31', 'W-8', FALSE, 380, 34, 0, 346, '97.8', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-04-07', 'W-7', FALSE, 346, 36, 0, 310, '97.4', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-04-14', 'W-6', FALSE, 310, 38, 0, 272, '96.8', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-04-21', 'W-5', FALSE, 272, 37, 216, 451, '98.4', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-04-28', 'W-4', FALSE, 451, 39, 0, 412, '98.2', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-05-05', 'W-3', FALSE, 412, 41, 0, 371, '97.8', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-05-12', 'W-2', FALSE, 371, 40, 0, 331, '97.2', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-05-19', 'W-1', FALSE, 331, 42, 0, 289, '96.4', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-05-26', 'F+1', TRUE, 289, 43, 0, 246, '94.8', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-06-02', 'F+2', TRUE, 246, 44, 216, 418, '98.0', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-06-09', 'F+3', TRUE, 418, 45, 0, 373, '97.6', 144),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', 'NATIONAL', '2026-06-16', 'F+4', TRUE, 373, 46, 0, 327, '97.0', 144),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-03-31', 'W-8', FALSE, 280, 26, 0, 254, '98.2', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-07', 'W-7', FALSE, 254, 27, 0, 227, '97.8', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-14', 'W-6', FALSE, 227, 25, 0, 202, '97.2', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-21', 'W-5', FALSE, 202, 28, 162, 336, '98.6', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-28', 'W-4', FALSE, 336, 27, 0, 309, '98.4', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-05', 'W-3', FALSE, 309, 26, 0, 283, '98.2', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-12', 'W-2', FALSE, 283, 28, 0, 255, '97.8', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-19', 'W-1', FALSE, 255, 27, 0, 228, '97.4', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-26', 'F+1', TRUE, 228, 27, 0, 201, '96.8', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-02', 'F+2', TRUE, 201, 26, 0, 175, '95.6', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-09', 'F+3', TRUE, 175, 28, 162, 309, '98.2', 108),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-16', 'F+4', TRUE, 309, 27, 0, 282, '98.0', 108),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-03-31', 'W-8', FALSE, 210, 16, 0, 194, '98.4', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-07', 'W-7', FALSE, 194, 17, 0, 177, '98.0', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-14', 'W-6', FALSE, 177, 15, 0, 162, '97.6', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-21', 'W-5', FALSE, 162, 18, 102, 246, '98.8', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-04-28', 'W-4', FALSE, 246, 16, 0, 230, '98.6', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-05', 'W-3', FALSE, 230, 17, 0, 213, '98.4', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-12', 'W-2', FALSE, 213, 16, 0, 197, '98.0', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-19', 'W-1', FALSE, 197, 18, 0, 179, '97.6', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-05-26', 'F+1', TRUE, 179, 17, 0, 162, '97.0', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-02', 'F+2', TRUE, 162, 16, 0, 146, '96.2', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-09', 'F+3', TRUE, 146, 18, 102, 230, '98.4', 68),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', 'NATIONAL', '2026-06-16', 'F+4', TRUE, 230, 17, 0, 213, '98.0', 68),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-03-31', 'W-8', FALSE, 310, 28, 0, 282, '98.6', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-04-07', 'W-7', FALSE, 282, 30, 0, 252, '98.2', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-04-14', 'W-6', FALSE, 252, 27, 0, 225, '97.8', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-04-21', 'W-5', FALSE, 225, 31, 174, 368, '98.8', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-04-28', 'W-4', FALSE, 368, 29, 0, 339, '98.6', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-05-05', 'W-3', FALSE, 339, 28, 0, 311, '98.4', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-05-12', 'W-2', FALSE, 311, 30, 0, 281, '98.0', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-05-19', 'W-1', FALSE, 281, 29, 0, 252, '97.6', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-05-26', 'F+1', TRUE, 252, 30, 174, 396, '98.6', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-06-02', 'F+2', TRUE, 396, 28, 0, 368, '98.4', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-06-09', 'F+3', TRUE, 368, 31, 0, 337, '98.2', 116),
    ('Huggies', 'Wipes', 'Nappies & Wipes', 'NATIONAL', '2026-06-16', 'F+4', TRUE, 337, 29, 0, 308, '97.8', 116),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-03-31', 'W-8', FALSE, 210, 55, 0, 280, '98.4', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-04-07', 'W-7', FALSE, 193, 56, 0, 275, '98.0', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-04-14', 'W-6', FALSE, 175, 58, 0, 282, '97.6', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-04-21', 'W-5', FALSE, 158, 62, 101, 270, '98.6', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-04-28', 'W-4', FALSE, 240, 72, 0, 258, '98.4', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-05-05', 'W-3', FALSE, 220, 83, 0, 225, '97.8', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-05-12', 'W-2', FALSE, 198, 92, 0, 180, '96.8', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-05-26', 'F+1', TRUE, 144, 30, 0, 114, '89.6', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-06-02', 'F+2', TRUE, 114, 31, 101, 184, '96.8', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-06-09', 'F+3', TRUE, 184, 32, 0, 152, '95.2', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-06-16', 'F+4', TRUE, 152, 33, 0, 119, '88.4', 67),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-03-31', 'W-8', FALSE, 168, 58, 0, 310, '98.6', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-04-07', 'W-7', FALSE, 156, 60, 0, 305, '98.4', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-04-14', 'W-6', FALSE, 143, 62, 0, 312, '98.2', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-04-21', 'W-5', FALSE, 131, 68, 81, 298, '98.8', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-04-28', 'W-4', FALSE, 199, 78, 0, 285, '98.6', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-05-05', 'W-3', FALSE, 186, 88, 0, 268, '98.4', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-05-12', 'W-2', FALSE, 174, 98, 0, 250, '98.2', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-05-26', 'F+1', TRUE, 148, 14, 0, 134, '97.6', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-06-02', 'F+2', TRUE, 134, 14, 81, 201, '98.6', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-06-09', 'F+3', TRUE, 201, 14, 0, 187, '98.4', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-06-16', 'F+4', TRUE, 187, 15, 0, 172, '98.0', 54),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-03-31', 'W-8', FALSE, 118, 48, 0, 220, '98.2', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-04-07', 'W-7', FALSE, 109, 49, 0, 215, '97.8', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-04-14', 'W-6', FALSE, 99, 50, 0, 222, '97.2', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-04-21', 'W-5', FALSE, 89, 55, 58, 210, '98.4', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-04-28', 'W-4', FALSE, 136, 64, 0, 192, '98.0', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-05-05', 'W-3', FALSE, 125, 72, 0, 155, '97.4', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-05-12', 'W-2', FALSE, 113, 78, 0, 115, '95.8', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-05-26', 'F+1', TRUE, 84, 16, 0, 68, '86.4', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-06-02', 'F+2', TRUE, 68, 17, 58, 109, '96.2', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-06-09', 'F+3', TRUE, 109, 17, 0, 92, '94.8', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-06-16', 'F+4', TRUE, 92, 18, 0, 74, '88.2', 38),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-03-31', 'W-8', FALSE, 58, 32, 0, 310, '98.4', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-04-07', 'W-7', FALSE, 54, 33, 0, 305, '98.0', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-04-14', 'W-6', FALSE, 49, 34, 0, 300, '97.6', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-04-21', 'W-5', FALSE, 45, 36, 29, 298, '98.6', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-04-28', 'W-4', FALSE, 69, 38, 0, 296, '98.4', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-05-05', 'W-3', FALSE, 64, 40, 0, 295, '98.2', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-05-12', 'W-2', FALSE, 59, 42, 0, 294, '97.8', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-05-26', 'F+1', TRUE, 49, 6, 0, 43, '96.4', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-06-02', 'F+2', TRUE, 43, 6, 29, 66, '98.2', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-06-09', 'F+3', TRUE, 66, 6, 0, 60, '97.8', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-06-16', 'F+4', TRUE, 60, 6, 0, 54, '97.4', 19),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-03-31', 'W-8', FALSE, 38, 12, 0, 155, '98.0', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-04-07', 'W-7', FALSE, 35, 13, 0, 152, '97.4', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-04-14', 'W-6', FALSE, 31, 13, 0, 150, '96.8', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-04-21', 'W-5', FALSE, 28, 14, 20, 148, '98.4', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-04-28', 'W-4', FALSE, 44, 15, 0, 147, '98.0', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-05-05', 'W-3', FALSE, 40, 16, 0, 146, '97.4', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-05-12', 'W-2', FALSE, 36, 17, 0, 145, '96.2', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'NSW', '2026-05-19', 'W-1', FALSE, 172, 98, 0, 144, '94.2', 316),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'VIC', '2026-05-19', 'W-1', FALSE, 161, 106, 0, 234, '98.0', 312),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'QLD', '2026-05-19', 'W-1', FALSE, 99, 82, 0, 84, '92.6', 292),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'WA', '2026-05-19', 'W-1', FALSE, 54, 45, 0, 294, '97.4', 168),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-05-19', 'W-1', FALSE, 31, 19, 0, 144, '92.8', 72),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-05-26', 'F+1', TRUE, 26, 6, 0, 20, '82.4', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-06-02', 'F+2', TRUE, 20, 6, 20, 34, '96.8', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-06-09', 'F+3', TRUE, 34, 6, 0, 28, '94.2', 13),
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', 'SA', '2026-06-16', 'F+4', TRUE, 28, 7, 0, 21, '84.6', 13)
AS t(BRAND_NAME, SKU_CLASS, CATEGORY, DC_STATE, WEEK_DATE, WEEK_LABEL, IS_FORECAST, OPENING_STOCK, DEMAND_UNITS, DELIVERY_UNITS, CLOSING_STOCK, SHELF_STOCK_PCT, REORDER_POINT);

-- ----------------------------------------------------------
-- SKU_SUPPLY_PROFILE (5 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE SKU_SUPPLY_PROFILE (
	BRAND_NAME VARCHAR(16777216),
	SKU_CLASS VARCHAR(16777216),
	CATEGORY VARCHAR(16777216),
	DAILY_DEMAND NUMBER(8,1),
	WEEKLY_DEMAND NUMBER(38,0),
	CURRENT_STOCK_NATIONAL NUMBER(38,0),
	REORDER_POINT NUMBER(38,0),
	SAFETY_STOCK NUMBER(38,0),
	LEAD_TIME_DAYS NUMBER(38,0),
	AVG_DELIVERY_QTY NUMBER(38,0),
	NEXT_DELIVERY_DATE DATE,
	STOCKOUT_COST_PER_DAY NUMBER(38,0),
	SUPPLIER_NAME VARCHAR(16777216),
	DC_SPLIT VARIANT
);

INSERT INTO SKU_SUPPLY_PROFILE (BRAND_NAME, SKU_CLASS, CATEGORY, DAILY_DEMAND, WEEKLY_DEMAND, CURRENT_STOCK_NATIONAL, REORDER_POINT, SAFETY_STOCK, LEAD_TIME_DAYS, AVG_DELIVERY_QTY, NEXT_DELIVERY_DATE, STOCKOUT_COST_PER_DAY, SUPPLIER_NAME, DC_SPLIT)
SELECT BRAND_NAME, SKU_CLASS, CATEGORY, DAILY_DEMAND, WEEKLY_DEMAND, CURRENT_STOCK_NATIONAL, REORDER_POINT, SAFETY_STOCK, LEAD_TIME_DAYS, AVG_DELIVERY_QTY, NEXT_DELIVERY_DATE, STOCKOUT_COST_PER_DAY, SUPPLIER_NAME, PARSE_JSON(DC_SPLIT) FROM VALUES
    ('Huggies', 'Crawler Nappies', 'Nappies & Wipes', '50.0', 350, 900, 700, 350, 10, 400, '2026-06-02', 1340, 'Kimberly-Clark', '{
  "NSW": 35,
  "QLD": 20,
  "SA": 7,
  "VIC": 28,
  "WA": 10
}'),
    ('Huggies', 'Pull-Ups', 'Nappies & Wipes', '27.4', 192, 320, 768, 384, 10, 216, '2026-06-02', 980, 'Kimberly-Clark', '{
  "NSW": 32,
  "QLD": 18,
  "SA": 8,
  "VIC": 30,
  "WA": 12
}'),
    ('Huggies', 'Toddler Nappies', 'Nappies & Wipes', '22.7', 159, 240, 636, 318, 10, 162, '2026-06-04', 760, 'Kimberly-Clark', '{
  "NSW": 34,
  "QLD": 22,
  "SA": 7,
  "VIC": 26,
  "WA": 11
}'),
    ('Huggies', 'Newborn Nappies', 'Nappies & Wipes', '20.3', 142, 180, 568, 284, 10, 102, '2026-06-04', 620, 'Kimberly-Clark', '{
  "NSW": 36,
  "QLD": 19,
  "SA": 8,
  "VIC": 27,
  "WA": 10
}'),
    ('Huggies', 'Wipes', 'Nappies & Wipes', '15.2', 106, 260, 424, 212, 7, 174, '2026-05-30', 460, 'Kimberly-Clark', '{
  "NSW": 33,
  "QLD": 21,
  "SA": 7,
  "VIC": 29,
  "WA": 10
}')
AS t(BRAND_NAME, SKU_CLASS, CATEGORY, DAILY_DEMAND, WEEKLY_DEMAND, CURRENT_STOCK_NATIONAL, REORDER_POINT, SAFETY_STOCK, LEAD_TIME_DAYS, AVG_DELIVERY_QTY, NEXT_DELIVERY_DATE, STOCKOUT_COST_PER_DAY, SUPPLIER_NAME, DC_SPLIT);

-- ----------------------------------------------------------
-- STOCK_ALERTS (8 rows)
-- ----------------------------------------------------------
CREATE OR REPLACE TABLE STOCK_ALERTS (
	ALERT_ID VARCHAR(16777216),
	BRAND_NAME VARCHAR(16777216),
	CATEGORY VARCHAR(16777216),
	ALERT_TYPE VARCHAR(16777216),
	TITLE VARCHAR(16777216),
	DESCRIPTION VARCHAR(16777216),
	CREATED_AT TIMESTAMP_NTZ(9),
	WOC_AT_TIME NUMBER(4,1),
	RECOMMENDED_ACTION VARCHAR(16777216),
	IS_RESOLVED BOOLEAN DEFAULT FALSE
);

INSERT INTO STOCK_ALERTS (ALERT_ID, BRAND_NAME, CATEGORY, ALERT_TYPE, TITLE, DESCRIPTION, CREATED_AT, WOC_AT_TIME, RECOMMENDED_ACTION, IS_RESOLVED)
SELECT * FROM VALUES
    ('ALT-001', 'Rascal + Friends', 'Nappies & Wipes', 'critical', 'Stock Approaching Stockout', 'Demand growth +28% QoQ is outpacing supply. At current burn rate, stockout in 18 days without emergency order.', '2026-05-25T14:22:00', '3.0', 'Place emergency order — 480 units. Expedite with supplier (12-day lead time).', FALSE),
    ('ALT-002', 'Uppababy', 'Prams & Strollers', 'critical', 'Below Minimum Stock Level', 'WOC at 2.0 weeks — well below 4-week minimum. Seasonal demand spike depleting inventory faster than forecasted.', '2026-05-25T09:15:00', '2.0', 'Rush order 24 units. Contact UPPAbaby Inc for express shipping (48hr).', FALSE),
    ('ALT-003', 'Dr Browns', 'Feeding', 'warning', 'Supply Disruption — Delayed Shipment', 'Scheduled delivery of 162 units delayed by 7 days due to port congestion. New ETA: 9 Jun.', '2026-05-24T16:45:00', '4.4', 'Monitor daily. Increase safety stock threshold to 72 units. Prepare backup supplier.', FALSE),
    ('ALT-004', 'Bonds Baby', 'Clothing', 'warning', 'Stock Declining Faster Than Forecast', 'Demand up 14% vs forecast driven by winter collection launch. Current trajectory hits reorder point in 8 days.', '2026-05-24T11:30:00', '3.8', 'Bring forward scheduled order by 5 days. Increase order qty from 348 to 400 units.', FALSE),
    ('ALT-005', 'Bugaboo', 'Prams & Strollers', 'info', 'Overstock Risk — Capital Tied Up', 'WOC at 18.3 weeks — significantly above 8-week target. $61K capital tied up in excess inventory.', '2026-05-23T08:00:00', '18.3', 'Reduce next order quantity. Consider markdown on Fox5 model to clear stock.', FALSE),
    ('ALT-006', 'Maxi-Cosi', 'Car Seats', 'warning', 'Supplier DIFOT Deteriorating', 'DIFOT dropped from 96.2% to 91.8% over last 4 weeks. 2 partial deliveries received.', '2026-05-24T14:10:00', '8.2', 'Schedule supplier review meeting. Request root cause analysis and corrective action plan.', FALSE),
    ('ALT-007', 'Huggies', 'Nappies & Wipes', 'info', 'Delivery Confirmed — On Schedule', 'Next delivery of 768 units confirmed for 2 Jun. Supplier DIFOT stable at 94.2%.', '2026-05-25T07:30:00', '8.9', 'No action required. Continue monitoring.', FALSE),
    ('ALT-008', 'Cybex', 'Car Seats', 'info', 'Long Lead Time Notice', '24-day lead time from Germany. Plan orders 5+ weeks ahead to maintain buffer.', '2026-05-22T10:00:00', '10.0', 'Pre-order for Jul delivery placed. Confirm allocation with Cybex GmbH.', FALSE)
AS t(ALERT_ID, BRAND_NAME, CATEGORY, ALERT_TYPE, TITLE, DESCRIPTION, CREATED_AT, WOC_AT_TIME, RECOMMENDED_ACTION, IS_RESOLVED);

