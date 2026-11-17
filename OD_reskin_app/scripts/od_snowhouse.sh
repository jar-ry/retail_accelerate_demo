#!/bin/bash
# Retarget the OneDigital SQL to Snowhouse (TEMP.JARCHEN_OD_*) and run it.
#   FILES="od_10_base od_40_foundation" scripts/od_snowhouse.sh
set -u
A="$(cd "$(dirname "$0")/.." && pwd)"
OUT=/tmp/od/sh
unset SNOWFLAKE_CONNECTION_NAME
export SNOWFLAKE_ACCOUNT=SFCOGSOPS-SNOWHOUSE_AWS_US_WEST_2 SNOWFLAKE_USER=JARCHEN SNOWFLAKE_HOST=snowhouse.snowflakecomputing.com
export SNOWFLAKE_ROLE=SALES_ENGINEER SNOWFLAKE_WAREHOUSE=MNEGLAY_XS
mkdir -p $OUT
for f in ${FILES:-od_10_base od_40_foundation od_43_history od_44_views od_45_procs deploy_od_campaign_agents}; do
  src="$A/sql/$f.sql"; [ -f "$src" ] || src="$A/agent/$f.sql"
  /opt/miniconda3/bin/python "$A/scripts/od_target.py" --db TEMP --prefix JARCHEN_OD_ --warehouse MNEGLAY_XS --role SALES_ENGINEER \
    --out-dir $OUT "$src" 2>/dev/null || { echo "FAIL retarget $f"; exit 1; }
  t=$(date +%s)
  if /opt/miniconda3/bin/python "$A/scripts/run_sql.py" "$OUT/$f.sql" > "$OUT/run_$f.log" 2>&1; then
    echo "OK   $f ($(( $(date +%s) - t ))s)"
  else
    echo "FAIL $f ($(( $(date +%s) - t ))s)"; tail -25 "$OUT/run_$f.log"; exit 1
  fi
done
echo "ALL OK"
