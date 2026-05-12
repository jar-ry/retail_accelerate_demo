import streamlit as st
import plotly.express as px
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="Brand Switching", page_icon="🔄", layout="wide")
st.title("🔄 Brand Switching Analysis")

session = get_active_session()

categories = session.sql("SELECT DISTINCT category FROM APP_CODE.SWITCHING ORDER BY category").to_pandas()["CATEGORY"].tolist()

if not categories:
    st.info("No brand switching data available.")
    st.stop()

category = st.selectbox("Category", categories)

our_brands = session.sql("SELECT DISTINCT brand_name FROM APP_CODE.SELLTHROUGH").to_pandas()["BRAND_NAME"].tolist()
our_brands_sql = ",".join(f"'{b}'" for b in our_brands)

df_gaining = session.sql(f"""
    SELECT class, SUM(switch_count) as customers_gained
    FROM APP_CODE.SWITCHING
    WHERE category = '{category}' AND to_brand IN ({our_brands_sql})
    GROUP BY class
    ORDER BY customers_gained DESC
""").to_pandas()

df_losing = session.sql(f"""
    SELECT class, SUM(switch_count) as customers_lost
    FROM APP_CODE.SWITCHING
    WHERE category = '{category}' AND from_brand IN ({our_brands_sql})
    GROUP BY class
    ORDER BY customers_lost DESC
""").to_pandas()

total_gained = int(df_gaining["CUSTOMERS_GAINED"].sum()) if not df_gaining.empty else 0
total_lost = int(df_losing["CUSTOMERS_LOST"].sum()) if not df_losing.empty else 0
net = total_gained - total_lost

col1, col2, col3 = st.columns(3)
with col1:
    st.metric("Customers Gained", f"{total_gained:,}", help="Customers switching TO your products")
with col2:
    st.metric("Customers Lost", f"{total_lost:,}", help="Customers switching AWAY from your products")
with col3:
    delta_color = "normal" if net >= 0 else "inverse"
    st.metric("Net Position", f"{net:+,}", delta=f"{net:+,}", delta_color=delta_color)

st.divider()

col1, col2 = st.columns(2)

with col1:
    st.subheader("Gaining by Product Class")
    if not df_gaining.empty:
        fig = px.bar(df_gaining, x="CLASS", y="CUSTOMERS_GAINED",
                     labels={"CLASS": "Product Class", "CUSTOMERS_GAINED": "Customers Gained"},
                     color_discrete_sequence=["#2ecc71"])
        fig.update_layout(height=300)
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No customers switching to your products in this category.")

with col2:
    st.subheader("Losing by Product Class")
    if not df_losing.empty:
        fig = px.bar(df_losing, x="CLASS", y="CUSTOMERS_LOST",
                     labels={"CLASS": "Product Class", "CUSTOMERS_LOST": "Customers Lost"},
                     color_discrete_sequence=["#e74c3c"])
        fig.update_layout(height=300)
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No customers switching away from your products in this category.")

st.divider()
st.subheader("Net Position by Product Class")

if not df_gaining.empty or not df_losing.empty:
    import pandas as pd
    all_classes = list(set(
        (df_gaining["CLASS"].tolist() if not df_gaining.empty else []) +
        (df_losing["CLASS"].tolist() if not df_losing.empty else [])
    ))
    net_data = []
    for cls in all_classes:
        gained = int(df_gaining[df_gaining["CLASS"] == cls]["CUSTOMERS_GAINED"].sum()) if not df_gaining.empty else 0
        lost = int(df_losing[df_losing["CLASS"] == cls]["CUSTOMERS_LOST"].sum()) if not df_losing.empty else 0
        net_data.append({"Product Class": cls, "Gained": gained, "Lost": lost, "Net": gained - lost})

    df_net = pd.DataFrame(net_data).sort_values("Net", ascending=True)
    fig = px.bar(df_net, x="Net", y="Product Class", orientation="h",
                 color="Net", color_continuous_scale=["#e74c3c", "#f39c12", "#2ecc71"],
                 labels={"Net": "Net Customers"})
    fig.update_layout(height=max(250, len(all_classes) * 40))
    st.plotly_chart(fig, use_container_width=True)

st.divider()
st.subheader("Category Overview")
st.caption("Total switching activity in this category (competitor names anonymised)")

df_category_total = session.sql(f"""
    SELECT SUM(switch_count) as total_switches
    FROM APP_CODE.SWITCHING
    WHERE category = '{category}'
""").to_pandas()

if not df_category_total.empty:
    total_cat = int(df_category_total['TOTAL_SWITCHES'].iloc[0])
    col1, col2 = st.columns(2)
    with col1:
        st.metric("Total Category Switches", f"{total_cat:,}")
    with col2:
        your_share = (total_gained / total_cat * 100) if total_cat > 0 else 0
        st.metric("Your Share of Gains", f"{your_share:.1f}%")
