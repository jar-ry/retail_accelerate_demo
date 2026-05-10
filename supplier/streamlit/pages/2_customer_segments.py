import streamlit as st
import plotly.express as px
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="Customer Segments", page_icon="👥", layout="wide")
st.title("👥 Customer Segments")

session = get_active_session()

df_segments = session.sql("""
    SELECT segment_name, SUM(customer_count) as customers, SUM(revenue) as revenue,
           AVG(avg_items_per_txn) as avg_items
    FROM APP_CODE.SEGMENTS
    WHERE fiscal_year = 2026
    GROUP BY segment_name
    ORDER BY revenue DESC
""").to_pandas()

if not df_segments.empty:
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
    st.dataframe(df_segments, use_container_width=True, hide_index=True)
