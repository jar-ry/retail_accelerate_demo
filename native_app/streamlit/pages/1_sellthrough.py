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
