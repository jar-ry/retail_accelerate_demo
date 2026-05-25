import streamlit as st
import plotly.express as px
import pandas as pd
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="Customer Segments", page_icon="👥", layout="wide")
st.title("👥 Customer Segments")

session = get_active_session()

brands = session.sql("SELECT DISTINCT brand_name FROM APP_CODE.SEGMENTS ORDER BY brand_name").to_pandas()["BRAND_NAME"].tolist()

if len(brands) == 1:
    brand = brands[0]
    st.caption(f"Showing data for **{brand}**")
else:
    brand = st.selectbox("Brand", brands)

brand_filter = f"AND brand_name = '{brand}'"

df_segments = session.sql(f"""
    SELECT segment_name,
           SUM(customer_count) as customers,
           SUM(revenue) as revenue,
           SUM(units) as units,
           SUM(transaction_count) as transactions,
           AVG(avg_items_per_txn) as avg_items
    FROM APP_CODE.SEGMENTS
    WHERE fiscal_year = 2026 {brand_filter}
    GROUP BY segment_name
    ORDER BY revenue DESC
""").to_pandas()

if not df_segments.empty:
    total_rev = df_segments["REVENUE"].sum()
    total_cust = df_segments["CUSTOMERS"].sum()
    top_segment = df_segments.iloc[0]["SEGMENT_NAME"]
    top_segment_pct = (df_segments.iloc[0]["REVENUE"] / total_rev * 100) if total_rev > 0 else 0

    kpi1, kpi2, kpi3, kpi4 = st.columns(4)
    kpi1.metric("Total Customers", f"{total_cust:,.0f}")
    kpi2.metric("Total Revenue", f"${total_rev:,.0f}")
    kpi3.metric("Top Segment", top_segment)
    kpi4.metric("Top Segment Skew", f"{top_segment_pct:.1f}% of revenue")

    st.divider()

    col1, col2 = st.columns(2)
    with col1:
        st.subheader("Revenue by Segment")
        fig = px.pie(df_segments, names="SEGMENT_NAME", values="REVENUE", hole=0.5)
        fig.update_layout(height=350)
        st.plotly_chart(fig, use_container_width=True)

    with col2:
        st.subheader("Customer Count by Segment")
        fig = px.bar(df_segments, x="SEGMENT_NAME", y="CUSTOMERS",
                     labels={"SEGMENT_NAME": "Segment", "CUSTOMERS": "Customers"})
        fig.update_layout(height=350)
        st.plotly_chart(fig, use_container_width=True)

    st.subheader("Segment Performance Table")
    display_df = df_segments.copy()
    display_df["REV_SHARE"] = (display_df["REVENUE"] / total_rev * 100).round(1).astype(str) + "%"
    display_df["AVG_REV_PER_CUSTOMER"] = (display_df["REVENUE"] / display_df["CUSTOMERS"]).round(2)
    display_df = display_df.rename(columns={
        "SEGMENT_NAME": "Segment",
        "CUSTOMERS": "Customers",
        "REVENUE": "Revenue ($)",
        "REV_SHARE": "Revenue Share",
        "UNITS": "Units",
        "TRANSACTIONS": "Transactions",
        "AVG_ITEMS": "Avg Items/Txn",
        "AVG_REV_PER_CUSTOMER": "Rev/Customer ($)",
    })
    st.dataframe(
        display_df[["Segment", "Customers", "Revenue ($)", "Revenue Share", "Rev/Customer ($)", "Units", "Transactions", "Avg Items/Txn"]],
        use_container_width=True,
        hide_index=True,
    )

    st.divider()
    st.subheader("📊 Category Competitive Position")
    st.caption("Your brand's rank by units sold and revenue against all brands in each category.")

    try:
        df_rank = session.sql("SELECT * FROM APP_CODE.CATEGORY_RANK ORDER BY category").to_pandas()
        if not df_rank.empty:
            for _, row in df_rank.iterrows():
                cat = row["CATEGORY"]
                units_rank = int(row["UNITS_RANK"])
                rev_rank = int(row["REVENUE_RANK"])
                total = int(row["BRANDS_IN_CATEGORY"])
                total_units = int(row["TOTAL_UNITS"])
                total_rev_cat = row["TOTAL_REVENUE"]

                col_a, col_b, col_c = st.columns([2, 1, 1])
                col_a.markdown(f"**{cat}**")
                col_b.metric("Units Rank", f"#{units_rank} of {total}", f"{total_units:,} units")
                col_c.metric("Revenue Rank", f"#{rev_rank} of {total}", f"${total_rev_cat:,.0f}")
        else:
            st.info("Category ranking data not available.")
    except Exception:
        st.info("Category ranking data not available for this app version.")
else:
    st.info("No segment data available for this selection.")
