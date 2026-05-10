import streamlit as st
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="AI Comms", page_icon="🤖", layout="wide")
st.title("🤖 AI Supplier Intelligence Agent")
st.caption("Powered by Cortex Agent + Semantic View — ask anything about your performance")

session = get_active_session()

if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

if prompt := st.chat_input("Ask about your performance (e.g., 'How am I performing this week?')"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Querying your data..."):
            try:
                result = session.sql(f"""
                    SELECT SNOWFLAKE.CORTEX.AGENT(
                        'APP_CODE.SUPPLIER_COMMS_AGENT',
                        '{prompt.replace("'", "''")}'
                    ) AS response
                """).collect()
                response = result[0]["RESPONSE"] if result else "I couldn't retrieve that information. Please try rephrasing."
            except Exception as e:
                response = f"I encountered an issue querying the data. Error: {str(e)}"

        st.markdown(response)
        st.session_state.messages.append({"role": "assistant", "content": response})
