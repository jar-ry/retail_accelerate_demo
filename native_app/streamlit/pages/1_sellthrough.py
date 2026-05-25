import streamlit as st
import plotly.express as px
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="Sellthrough", page_icon="📊", layout="wide")
st.title("📊 Sellthrough Dashboard")

session = get_active_session()

categories = session.sql("SELECT DISTINCT category FROM APP_CODE.SELLTHROUGH ORDER BY category").to_pandas()["CATEGORY"].tolist()

col1, col2 = st.columns([1, 1])
with col1:
    time_period = st.selectbox("Period", ["Last 4 Weeks", "Last 8 Weeks", "MTD", "QTD", "YTD"])
with col2:
    category = st.selectbox("Category", ["All Categories"] + categories)

cat_filter = f"AND category = '{category}'" if category != "All Categories" else ""

st.subheader("📊 Product Class Ranking")
st.caption("Your rank by units sold in each product class against all brands in the category.")

try:
    rank_filter = f"WHERE category = '{category}'" if category != "All Categories" else ""
    df_rank = session.sql(f"SELECT * FROM APP_CODE.CLASS_RANK {rank_filter} ORDER BY category, total_units DESC").to_pandas()
    if not df_rank.empty:
        for cat_name in df_rank["CATEGORY"].unique():
            st.markdown(f"**{cat_name}**")
            cat_df = df_rank[df_rank["CATEGORY"] == cat_name][["CLASS", "TOTAL_UNITS", "TOTAL_REVENUE", "UNITS_RANK", "BRANDS_IN_CLASS"]].copy()
            cat_df["UNITS_RANK"] = cat_df.apply(lambda r: f"#{int(r['UNITS_RANK'])} of {int(r['BRANDS_IN_CLASS'])}", axis=1)
            cat_df["TOTAL_REVENUE"] = cat_df["TOTAL_REVENUE"].apply(lambda x: f"${x:,.0f}")
            cat_df["TOTAL_UNITS"] = cat_df["TOTAL_UNITS"].apply(lambda x: f"{int(x):,}")
            cat_df = cat_df.rename(columns={
                "CLASS": "Product Class",
                "TOTAL_UNITS": "Units Sold",
                "TOTAL_REVENUE": "Revenue",
                "UNITS_RANK": "Your Rank",
                "BRANDS_IN_CLASS": "_",
            })
            st.dataframe(cat_df[["Product Class", "Units Sold", "Revenue", "Your Rank"]], use_container_width=True, hide_index=True)
    else:
        st.info("No ranking data available.")
except Exception:
    st.info("Product class ranking not available for this app version.")

st.divider()

st.subheader("Weekly Trend")
df_trend = session.sql(f"""
    SELECT fiscal_week, SUM(units_sold) as units, SUM(revenue) as revenue
    FROM APP_CODE.SELLTHROUGH
    WHERE fiscal_year = 2026 {cat_filter}
    GROUP BY fiscal_week
    ORDER BY fiscal_week
""").to_pandas()

if not df_trend.empty:
    fig = px.line(df_trend, x="FISCAL_WEEK", y="UNITS", markers=True,
                  labels={"FISCAL_WEEK": "Week", "UNITS": "Units Sold"})
    fig.update_layout(height=300)
    st.plotly_chart(fig, use_container_width=True)

st.subheader("Performance by State")
df_state = session.sql(f"""
    SELECT state, SUM(units_sold) as units, SUM(revenue) as revenue,
           AVG(rate_of_sale) as ros
    FROM APP_CODE.SELLTHROUGH
    WHERE fiscal_year = 2026 {cat_filter}
    GROUP BY state
    ORDER BY revenue DESC
""").to_pandas()

if not df_state.empty:
    st.dataframe(df_state, use_container_width=True, hide_index=True)
