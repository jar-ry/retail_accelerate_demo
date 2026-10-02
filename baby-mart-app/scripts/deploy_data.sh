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
  # Baby Mart Global Planning. Strictly ordered: 11_ reads the hierarchy and
  # calendar from 10_, 12_ derives its weekly sales from 11_, and 21_ must precede
  # 13_ because the 13_ views CROSS JOIN the parameter pivot that 21_ creates.
  # 21_ in turn seeds per-class cover targets from the 12_ fact, so it sits
  # between them. 14_ reads the 13_ views.
  "$APP_DIR/sql/10_planning_dimensions.sql"              # DIM_MERCH_HIERARCHY + DIM_FISCAL_PERIOD
  "$APP_DIR/sql/11_planning_mfp.sql"                     # FACT_MFP_PLAN
  "$APP_DIR/sql/12_planning_otb.sql"                     # FACT_OTB_POSITION + FACT_SUPPLIER_COMMITMENT
  "$APP_DIR/sql/21_planning_parameters.sql"              # PLANNING_SETTING + class targets + VW_PLANNING_PARAM
  "$APP_DIR/sql/13_planning_views.sql"                   # VW_MFP_SUMMARY / VW_OTB_SUMMARY / VW_OTB_WEEKLY / exceptions
  "$APP_DIR/sql/14_planning_insights_procedure.sql"      # GENERATE_PLANNING_INSIGHTS
  # Weekly grid, option range, scenario sandbox. 17_ allocates the 11_ monthly
  # plan across weeks and reads the actuals cut-off from the 21_ pivot; 18_ needs
  # both 11_ and 12_; 19_ defines the sandbox over the 17_ weekly fact; 20_ reads
  # the 18_ productivity view and the 19_ impact view; 22_ audits 19_ and 20_.
  "$APP_DIR/sql/17_planning_weekly.sql"                  # FACT_MFP_WEEKLY + VW_MFP_WEEKLY
  "$APP_DIR/sql/18_plan_options.sql"                     # DIM_PLAN_OPTION + VW_OPTION_PRODUCTIVITY
  "$APP_DIR/sql/19_scenario_sandbox.sql"                 # PLANNING_SCENARIO + cells + annotations + versions
  "$APP_DIR/sql/20_scenario_procedures.sql"              # PARSE/BUILD/GOAL_SEEK/APPROVE
  "$APP_DIR/sql/22_plan_audit.sql"                       # PLANNING_CELL_AUDIT + VW_PLAN_AUDIT
  # Merch agent. Needs the 13_ views, the 18_ option productivity view and the
  # 20_ scenario procedures, so it runs after all three. NOTE: its semantic view
  # YAML addresses base tables with separate `database:` / `schema:` keys, so a
  # namespace rewrite must handle that form as well as the dotted one.
  "$APP_DIR/sql/23_merch_agent.sql"                      # MERCH_PLANNING_VIEW + MERCH_OPTION_SEARCH
  # AI Assessment. 15_ provisions the SOP/template tables with CREATE TABLE IF
  # NOT EXISTS and seeds WHEN NOT MATCHED, so a rerun preserves user-authored
  # SOPs rather than clobbering them. 16_ reads the 13_ planning views and the
  # DT_* aggregates, so it must follow both.
  "$APP_DIR/sql/15_assessment_settings.sql"              # ASSESSMENT_TEMPLATE + history + runs
  "$APP_DIR/sql/16_assessment_procedure.sql"             # GENERATE_AI_ASSESSMENT
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

# The procedure tools have to be spliced into the agent's existing JSON spec,
# which is not expressible in SQL -- see the script's header. This must run AFTER
# retailer/sql/05_create_agent.sql, which recreates the agent and would otherwise
# drop the spliced-in tools.
echo ""
echo ">>> Registering procedure tools on the agent"
AGENT_SCHEMA="${SCHEMA_PREFIX}AI"
if "$PY" "$APP_DIR/scripts/register_agent_tools.py" \
     --agent "${TARGET_DB}.${AGENT_SCHEMA}.CATEGORY_MANAGER_AGENT" \
     --schema "${TARGET_DB}.${AGENT_SCHEMA}" \
     --warehouse "${TARGET_WH:-DEMO_AI_WH}" >"$WORK/agent_tool.log" 2>&1; then
  echo "    OK"
else
  echo "    FAILED - last lines:"
  tail -10 "$WORK/agent_tool.log" | sed 's/^/      /'
  FAILED+=("register_agent_tools.py")
fi

echo ""
echo "=============================================="
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo " All steps completed."
else
  echo " Completed with failures in: ${FAILED[*]}"
fi
echo "=============================================="
