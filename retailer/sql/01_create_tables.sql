-- ============================================================
-- Baby Mart Supplier Collaboration Platform
-- 01_create_tables.sql
-- Creates all dimension and fact tables in CURATED schema
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA CURATED;
USE WAREHOUSE DEMO_LOAD_WH;

CREATE OR REPLACE TABLE DIM_DATE (
    date_key            INT PRIMARY KEY,
    calendar_date       DATE NOT NULL,
    day_of_week         VARCHAR(10),
    week_number         INT,
    fiscal_week         INT,
    fiscal_month        INT,
    fiscal_quarter      INT,
    fiscal_year         INT,
    is_weekend          BOOLEAN,
    is_public_holiday   BOOLEAN
);

CREATE OR REPLACE TABLE DIM_STORE (
    store_key           INT PRIMARY KEY,
    store_code          VARCHAR(10) NOT NULL,
    store_name          VARCHAR(100) NOT NULL,
    state               VARCHAR(3) NOT NULL,
    region              VARCHAR(50),
    city                VARCHAR(50),
    latitude            FLOAT,
    longitude           FLOAT,
    store_format        VARCHAR(20),
    open_date           DATE
);

CREATE OR REPLACE TABLE DIM_SUPPLIER (
    supplier_key        INT PRIMARY KEY,
    supplier_name       VARCHAR(100) NOT NULL,
    supplier_code       VARCHAR(20) NOT NULL,
    contact_name        VARCHAR(100),
    contact_email       VARCHAR(100),
    payment_terms       VARCHAR(20),
    lead_time_days      INT
);

CREATE OR REPLACE TABLE DIM_BRAND (
    brand_key           INT PRIMARY KEY,
    brand_name          VARCHAR(100) NOT NULL,
    supplier_key        INT NOT NULL REFERENCES DIM_SUPPLIER(supplier_key),
    price_tier          VARCHAR(20),
    brand_origin        VARCHAR(50)
);

CREATE OR REPLACE TABLE DIM_PRODUCT (
    product_key         INT PRIMARY KEY,
    sku_code            VARCHAR(20) NOT NULL,
    product_name        VARCHAR(200) NOT NULL,
    brand_key           INT NOT NULL REFERENCES DIM_BRAND(brand_key),
    supplier_key        INT NOT NULL REFERENCES DIM_SUPPLIER(supplier_key),
    category            VARCHAR(50) NOT NULL,
    class               VARCHAR(50),
    subclass            VARCHAR(50),
    unit_cost           DECIMAL(10,2),
    unit_retail         DECIMAL(10,2),
    margin_pct          DECIMAL(5,2),
    season              VARCHAR(20),
    lifecycle_stage     VARCHAR(20)
);

CREATE OR REPLACE TABLE DIM_CUSTOMER_SEGMENT (
    segment_key         INT PRIMARY KEY,
    segment_name        VARCHAR(50) NOT NULL,
    segment_description VARCHAR(200)
);

CREATE OR REPLACE TABLE DIM_CUSTOMER (
    customer_key        INT PRIMARY KEY,
    customer_id         VARCHAR(20) NOT NULL,
    segment_key         INT NOT NULL REFERENCES DIM_CUSTOMER_SEGMENT(segment_key),
    first_purchase_date DATE,
    state               VARCHAR(3),
    age_band            VARCHAR(20),
    gender              VARCHAR(10),
    loyalty_tier        VARCHAR(20),
    lifetime_spend      DECIMAL(12,2),
    total_transactions  INT,
    last_purchase_date  DATE
);

CREATE OR REPLACE TABLE DIM_PROMOTION (
    promotion_key       INT PRIMARY KEY,
    promotion_name      VARCHAR(100) NOT NULL,
    mechanic            VARCHAR(30),
    discount_pct        DECIMAL(5,2),
    start_date          DATE,
    end_date            DATE,
    channel             VARCHAR(20)
);

CREATE OR REPLACE TABLE FACT_TRANSACTION_LINES (
    transaction_line_key  BIGINT PRIMARY KEY,
    transaction_id        VARCHAR(30) NOT NULL,
    date_key              INT NOT NULL REFERENCES DIM_DATE(date_key),
    store_key             INT NOT NULL REFERENCES DIM_STORE(store_key),
    product_key           INT NOT NULL REFERENCES DIM_PRODUCT(product_key),
    customer_key          INT REFERENCES DIM_CUSTOMER(customer_key),
    promotion_key         INT REFERENCES DIM_PROMOTION(promotion_key),
    quantity              INT NOT NULL,
    unit_price            DECIMAL(10,2) NOT NULL,
    discount_amount       DECIMAL(10,2) DEFAULT 0,
    net_revenue           DECIMAL(10,2) NOT NULL,
    cost_amount           DECIMAL(10,2),
    margin_amount         DECIMAL(10,2)
);

CREATE OR REPLACE TABLE FACT_INVENTORY (
    inventory_key         BIGINT PRIMARY KEY,
    date_key              INT NOT NULL REFERENCES DIM_DATE(date_key),
    store_key             INT NOT NULL REFERENCES DIM_STORE(store_key),
    product_key           INT NOT NULL REFERENCES DIM_PRODUCT(product_key),
    stock_on_hand         INT NOT NULL,
    stock_on_order        INT DEFAULT 0,
    receipts_qty          INT DEFAULT 0,
    days_since_last_sale  INT
);

CREATE OR REPLACE TABLE FACT_PURCHASE_ORDERS (
    po_key                BIGINT PRIMARY KEY,
    po_number             VARCHAR(20) NOT NULL,
    supplier_key          INT NOT NULL REFERENCES DIM_SUPPLIER(supplier_key),
    product_key           INT NOT NULL REFERENCES DIM_PRODUCT(product_key),
    store_key             INT REFERENCES DIM_STORE(store_key),
    order_date            DATE NOT NULL,
    expected_delivery     DATE,
    actual_delivery       DATE,
    order_qty             INT NOT NULL,
    received_qty          INT,
    unit_cost             DECIMAL(10,2),
    po_status             VARCHAR(20)
);

CREATE OR REPLACE TABLE FACT_COMPETITOR_PRICING (
    competitor_price_key  BIGINT PRIMARY KEY,
    date_key              INT NOT NULL REFERENCES DIM_DATE(date_key),
    product_key           INT NOT NULL REFERENCES DIM_PRODUCT(product_key),
    competitor_name       VARCHAR(50) NOT NULL,
    competitor_price      DECIMAL(10,2) NOT NULL,
    our_price             DECIMAL(10,2) NOT NULL,
    price_gap_pct         DECIMAL(5,2),
    scrape_timestamp      TIMESTAMP_NTZ
);

CREATE OR REPLACE TABLE FACT_BUDGET (
    budget_key            BIGINT PRIMARY KEY,
    date_key              INT NOT NULL REFERENCES DIM_DATE(date_key),
    store_key             INT NOT NULL REFERENCES DIM_STORE(store_key),
    category              VARCHAR(50) NOT NULL,
    brand_key             INT REFERENCES DIM_BRAND(brand_key),
    planned_units         INT,
    planned_revenue       DECIMAL(12,2),
    planned_margin        DECIMAL(12,2)
);

ALTER TABLE FACT_TRANSACTION_LINES CLUSTER BY (date_key, store_key, product_key);
