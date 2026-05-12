import streamlit as st
from snowflake.snowpark.context import get_active_session
import _snowflake
import json
import pandas as pd

st.set_page_config(page_title="AI Comms", page_icon="🤖", layout="wide")
st.title("🤖 AI Supplier Intelligence Agent")
st.caption("Ask anything about your performance — powered by Cortex Agent")

session = get_active_session()

def get_app_name():
    result = session.sql("SELECT CURRENT_DATABASE()").collect()
    return result[0][0]

if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.app_name = get_app_name()

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if "data" in msg and msg["data"] is not None:
            st.dataframe(msg["data"], use_container_width=True)

if prompt := st.chat_input("Ask about your performance (e.g. 'How am I performing by state?')"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Agent is analysing your data..."):
            try:
                app_name = st.session_state.app_name
                endpoint = f"/api/v2/databases/{app_name}/schemas/APP_CODE/agents/SUPPLIER_AGENT:run"

                request_body = {
                    "messages": [
                        {
                            "role": "user",
                            "content": [{"type": "text", "text": prompt}]
                        }
                    ],
                    "stream": False
                }

                raw_resp = _snowflake.send_snow_api_request(
                    "POST",
                    endpoint,
                    {"Accept": "application/json"},
                    {},
                    request_body,
                    {},
                    60000,
                )

                status = raw_resp["status"] if isinstance(raw_resp, dict) else 200
                content = raw_resp["content"] if isinstance(raw_resp, dict) else raw_resp

                if status != 200:
                    try:
                        error_json = json.loads(content) if isinstance(content, str) else content
                        st.error(f"Error ({status}): {error_json.get('message', content)}")
                    except:
                        st.error(f"Error ({status}): {content}")
                    st.session_state.messages.append({"role": "assistant", "content": f"Error: {content}", "data": None})
                else:
                    resp_json = json.loads(content) if isinstance(content, str) else content
                    text_response = ""
                    data_df = None
                    sql_query = ""

                    for item in resp_json.get("content", []):
                        item_type = item.get("type")

                        if item_type == "text":
                            text_response += item.get("text", "")

                        elif item_type == "tool_result":
                            tool_result = item.get("tool_result", {})
                            for tr_content in tool_result.get("content", []):
                                if tr_content.get("type") == "json":
                                    tr_json = tr_content.get("json", {})
                                    sql_query = tr_json.get("sql", sql_query)
                                    result_set = tr_json.get("result_set")
                                    if result_set and result_set.get("data"):
                                        cols = [col["name"] for col in result_set.get("resultSetMetaData", {}).get("rowType", [])]
                                        data_df = pd.DataFrame(result_set["data"], columns=cols if cols else None)

                        elif item_type == "table":
                            table_content = item.get("table", item)
                            result_set = table_content.get("result_set")
                            if result_set and result_set.get("data"):
                                cols = [col["name"] for col in result_set.get("resultSetMetaData", {}).get("rowType", [])]
                                data_df = pd.DataFrame(result_set["data"], columns=cols if cols else None)

                    if not text_response and not sql_query and not data_df is not None:
                        text_response = "I couldn't generate a response. Please try rephrasing your question."

                    if text_response:
                        st.markdown(text_response)

                    if sql_query:
                        with st.expander("SQL Query"):
                            st.code(sql_query, language="sql")

                    if data_df is not None:
                        st.dataframe(data_df, use_container_width=True)

                    display_text = text_response if text_response else "Here are your results."
                    st.session_state.messages.append({"role": "assistant", "content": display_text, "data": data_df})

            except Exception as e:
                st.error(f"Error: {e}")
                st.session_state.messages.append({"role": "assistant", "content": f"Error: {e}", "data": None})
