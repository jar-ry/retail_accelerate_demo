#!/usr/bin/env bash
# ============================================================
# Deploy the Baby Mart demo data layer to a target Snowflake account.
#
# Defaults target the canonical demo account (BABY_MART_DEMO, no schema prefix),
# where retargeting is a no-op. Pass overrides for accounts that cannot create
# the BABY_MART_DEMO database or the DEMO_*_WH warehouses.
#
# Usage:
#   ./scripts/deploy_data.sh <connection> [target_db] [target_warehouse] [target_role] [schema_prefix]
#
# Canonical account:
#   ./scripts/deploy_data.sh JCHEN_AWS1
#
# Snowhouse (connection is nested in connections.toml and invisible to the CLI,
# so supply credentials via the environment instead):
#   SNOWFLAKE_ACCOUNT=SFCOGSOPS-SNOWHOUSE_AWS_US_WEST_2 \
#   SNOWFLAKE_USER=JARCHEN SNOWFLAKE_HOST=snowhouse.snowflakecomputing.com \
#   SNOWFLAKE_ROLE=SALES_ENGINEER SNOWFLAKE_WAREHOUSE=MNEGLAY_XS \
#   ./scripts/deploy_data.sh unused TEMP MNEGLAY_XS SALES_ENGINEER JARCHEN_
#
# Statements are executed with scripts/run_sql.py, NOT `snow sql -f`: the CLI
# applies &{...} / <%...%> template substitution to SQL text and misparses the
# data literals in these scripts.
# ============================================================
set -uo pipefail

CONNECTION="${1:?connection name required (ignored if SNOWFLAKE_ACCOUNT is set)}"
TARGET_DB="${2:-BABY_MART_DEMO}"
TARGET_WH="${3:-}"
TARGET_ROLE="${4:-}"
SCHEMA_PREFIX="${5:-}"

PY="${PY:-python3}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# run_sql.py uses SNOWFLAKE_ACCOUNT if present, else the named connection.
if [[ -z "${SNOWFLAKE_ACCOUNT:-}" ]]; then
  export SNOWFLAKE_CONNECTION_NAME="$CONNECTION"
fi

# Scripts in dependency order.
SCRIPTS=(
  "$REPO_DIR/retailer/sql/01_create_tables.sql"          # CURATED dims + facts (generated data)
  "$REPO_DIR/retailer/sql/02_create_dynamic_tables.sql"  # DT_* aggregates
  "$REPO_DIR/retailer/sql/05_create_agent.sql"           # DT_SUPPLIER_DIFOT + semantic view + agent
  "$REPO_DIR/retailer/sql/03_create_secure_views.sql"    # VW_SUPPLIER_* secure views
  "$APP_DIR/sql/07_analytics_views.sql"                  # V_DEMAND_ROLLUP etc (no semantic view snapshot)
  "$APP_DIR/sql/01_dim_supplier.sql"                     # 25 suppliers + 10 distributors
  "$APP_DIR/sql/02_forecast_demand_daily.sql"
  "$APP_DIR/sql/03_forecast_replenishment_supplier_dc.sql"
  "$APP_DIR/sql/04_forecast_replenishment_dc_store.sql"
  "$APP_DIR/sql/05_dc_workforce.sql"
  "$APP_DIR/sql/08_difot_realism.sql"                    # realistic DIFOT spread
  "$APP_DIR/sql/06_adhoc_analytics_tables.sql"           # extracted ad-hoc tables
  "$APP_DIR/sql/09_battlecard_procedure.sql"             # GENERATE_BATTLECARD
)

echo "=============================================="
echo " Baby Mart data deploy"
echo "   connection    : ${SNOWFLAKE_ACCOUNT:-$CONNECTION}"
echo "   database      : $TARGET_DB"
echo "   warehouse     : ${TARGET_WH:-<unchanged>}"
echo "   role          : ${TARGET_ROLE:-<unchanged>}"
echo "   schema prefix : ${SCHEMA_PREFIX:-<none>}"
echo "=============================================="

# Ensure target schemas exist before anything references them.
echo ""
echo ">>> Creating schemas"
for S in RAW CURATED ANALYTICS AI APP; do
  echo "CREATE SCHEMA IF NOT EXISTS ${TARGET_DB}.${SCHEMA_PREFIX}${S};" > "$WORK/schema_$S.sql"
  if "$PY" "$APP_DIR/scripts/run_sql.py" "$WORK/schema_$S.sql" >/dev/null 2>&1; then
    echo "    ${TARGET_DB}.${SCHEMA_PREFIX}${S}"
  else
    echo "    WARN could not create ${TARGET_DB}.${SCHEMA_PREFIX}${S}"
  fi
done

FAILED=()
for SRC in "${SCRIPTS[@]}"; do
  NAME="$(basename "$SRC")"
  if [[ ! -f "$SRC" ]]; then
    echo ""
    echo ">>> SKIP $NAME (not found)"
    continue
  fi

  DEST="$WORK/$NAME"
  "$PY" "$APP_DIR/scripts/retarget_sql.py" \
    --in "$SRC" --out "$DEST" \
    --target-db "$TARGET_DB" \
    --target-warehouse "$TARGET_WH" \
    --target-role "$TARGET_ROLE" \
    --schema-prefix "$SCHEMA_PREFIX"

  echo ""
  echo ">>> Running $NAME"
  if "$PY" "$APP_DIR/scripts/run_sql.py" "$DEST" >"$WORK/$NAME.log" 2>&1; then
    echo "    OK"
  else
    echo "    FAILED - last lines:"
    tail -15 "$WORK/$NAME.log" | sed 's/^/      /'
    FAILED+=("$NAME")
  fi
done

# The battlecard tool has to be spliced into the agent's existing JSON spec,
# which is not expressible in SQL -- see the script's header.
echo ""
echo ">>> Registering generate_battlecard on the agent"
AGENT_SCHEMA="${SCHEMA_PREFIX}AI"
if "$PY" "$APP_DIR/scripts/register_battlecard_tool.py" \
     --agent "${TARGET_DB}.${AGENT_SCHEMA}.CATEGORY_MANAGER_AGENT" \
     --procedure "${TARGET_DB}.${AGENT_SCHEMA}.GENERATE_BATTLECARD" \
     --warehouse "${TARGET_WH:-DEMO_AI_WH}" >"$WORK/agent_tool.log" 2>&1; then
  echo "    OK"
else
  echo "    FAILED - last lines:"
  tail -10 "$WORK/agent_tool.log" | sed 's/^/      /'
  FAILED+=("register_battlecard_tool.py")
fi

echo ""
echo "=============================================="
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo " All steps completed."
else
  echo " Completed with failures in: ${FAILED[*]}"
fi
echo "=============================================="
