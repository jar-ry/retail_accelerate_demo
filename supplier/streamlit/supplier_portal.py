import streamlit as st

st.set_page_config(
    page_title="Baby Mart Supplier Portal",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.sidebar.markdown("""
### 🏪 Baby Mart
**Supplier Portal**

*Installed via Native App*
""")

st.sidebar.divider()
st.sidebar.caption("📡 Live data via Snowflake Secure Data Sharing")
st.sidebar.caption("🤖 AI Agent + Semantic View included")

st.title("Supplier Sellthrough Intelligence")
st.markdown("Welcome to your Baby Mart performance portal. Navigate using the sidebar to explore your sell-through data, customer segments, brand switching dynamics, and AI-powered insights.")

col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric("Units Sold (L4W)", "12,847", "+8.3%")
with col2:
    st.metric("Revenue (L4W)", "$2.14M", "+12.1%")
with col3:
    st.metric("Sell-Through Rate", "68.4%", "+2.1pp")
with col4:
    st.metric("Avg Weeks of Cover", "6.2", "-0.8")

st.divider()
st.info("👈 Use the sidebar pages to explore detailed analytics, or go to **AI Comms** to chat with the performance agent.")
