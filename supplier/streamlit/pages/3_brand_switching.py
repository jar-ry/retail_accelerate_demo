import streamlit as st
import plotly.graph_objects as go
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="Brand Switching", page_icon="🔄", layout="wide")
st.title("🔄 Brand Switching Analysis")

session = get_active_session()

category = st.selectbox("Category", ["Prams & Strollers", "Car Seats", "Nappies & Wipes", "Clothing", "Feeding"])

df_switching = session.sql(f"""
    SELECT from_brand, to_brand, SUM(switch_count) as switches
    FROM APP_CODE.SWITCHING
    WHERE category = '{category}'
    GROUP BY from_brand, to_brand
    ORDER BY switches DESC
    LIMIT 20
""").to_pandas()

if not df_switching.empty:
    col1, col2, col3 = st.columns(3)

    our_brands = df_switching["FROM_BRAND"].unique().tolist()
    switch_in = df_switching[df_switching["TO_BRAND"].isin(our_brands)]["SWITCHES"].sum()
    switch_out = df_switching[df_switching["FROM_BRAND"].isin(our_brands)]["SWITCHES"].sum()

    with col1:
        st.metric("Switch-In", f"{switch_in:,}", help="Customers gained from other brands")
    with col2:
        st.metric("Switch-Out", f"{switch_out:,}", help="Customers lost to other brands")
    with col3:
        net = switch_in - switch_out
        st.metric("Net Position", f"{net:+,}")

    st.subheader("Brand Flow (Sankey)")
    all_labels = list(set(df_switching["FROM_BRAND"].tolist() + df_switching["TO_BRAND"].tolist()))
    label_to_idx = {l: i for i, l in enumerate(all_labels)}

    fig = go.Figure(go.Sankey(
        node=dict(pad=20, thickness=20, label=all_labels),
        link=dict(
            source=[label_to_idx[r] for r in df_switching["FROM_BRAND"]],
            target=[label_to_idx[r] for r in df_switching["TO_BRAND"]],
            value=df_switching["SWITCHES"].tolist(),
        )
    ))
    fig.update_layout(height=450)
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("Switching Detail")
    st.dataframe(df_switching, use_container_width=True, hide_index=True)
