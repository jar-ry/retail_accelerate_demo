"""Build the Baby Mart Category Manager business ontology (Snowhouse).

Creates the domain "SE Workflow.Baby Mart Category Manager", then its nodes,
relationships and representations, all ACTIVE. The representations point at the
composable semantic views from sql/53 and the curated tables, so the ontology and
the views describe one model.

Re-runnable: nodes and relationships that already exist are skipped, and
representations are idempotent on the server. Every write is read back from the
published graph at the end.

    SNOWFLAKE_ACCOUNT=... SNOWFLAKE_USER=... SNOWFLAKE_ROLE=SALES_ENGINEER \
      python scripts/build_category_ontology.py [--dry-run]

Snowhouse only: SALES_ENGINEER cannot create a top-level domain, so this is a
subdomain of SE Workflow, which that role owns.
"""

import argparse
import json
import sys

import run_sql

PARENT = "SE Workflow"
DOMAIN = "Baby Mart Category Manager"
DOMAIN_DESC = ("How a Baby Mart category manager reads a brand: sales, margin, customers, "
               "promotions, competitor prices and supplier delivery, and the rules for comparing them.")

SV = "TEMP.JARCHEN_ANALYTICS"
CUR = "TEMP.JARCHEN_CURATED"
AI = "TEMP.JARCHEN_AI"
DESC_LIMIT = 270  # server truncates node descriptions beyond this

# name, kind, description, synonyms, formula (METRIC only)
NODES = [
    ("Brand", "ENTITY",
     "A product label Baby Mart ranges, such as Huggies, Bugaboo or Rascal + Friends. A Brand has Products, "
     "is bought from one Supplier and sits in a Price Tier. It is the unit a category manager reviews, ranges and negotiates.",
     ["label"], None),
    ("Supplier", "ENTITY",
     "The company Baby Mart buys a Brand from, e.g. Kimberly-Clark for Huggies. A Supplier has one or more Brands, "
     "agreed payment terms and a contracted lead time, and its delivery is measured by DIFOT %.",
     ["vendor"], None),
    ("Product", "ENTITY",
     "A sellable item (SKU) of a Brand, e.g. a Huggies Crawler Nappies pack. Each Product sits in one Category and one Class.",
     ["SKU", "item"], None),
    ("Customer", "ENTITY",
     "A Baby Mart shopper known through loyalty or registry. Each Customer belongs to a Customer Segment; "
     "their long-term value is Customer Lifetime Value.",
     ["shopper"], None),
    ("Promotion", "ENTITY",
     "A time-bound offer on one or more Products, run with a Promotion Mechanic such as BOGO or % Off.",
     ["promo", "deal"], None),
    ("Competitor", "ENTITY",
     "A rival retailer Baby Mart checks shelf prices against, e.g. Coles, Woolworths or Amazon. Compared through Price Gap %.",
     ["rival retailer"], None),
    ("Category", "DIMENSION",
     "The top product grouping a category manager owns: Prams & Strollers, Car Seats, Nappies & Wipes, Clothing, Feeding. "
     "A Category has Classes.",
     ["department"], None),
    ("Class", "DIMENSION",
     "A product grouping within a Category, e.g. Crawler Nappies, Capsule Stroller or Bottles. Brand switching is measured within a Class.",
     ["sub-category"], None),
    ("Customer Segment", "DIMENSION",
     "The shopper type a Customer belongs to: First-time Parents, Second-time Parents, Expecting, Gift Buyers, Grandparents, Registry Shoppers.",
     ["shopper type"], None),
    ("Promotion Mechanic", "DIMENSION",
     "How a Promotion gives value: % Off, BOGO, Bundle, Gift With Purchase or Multi-buy.",
     ["promo type"], None),
    ("Price Tier", "DIMENSION",
     "A Brand's price positioning: Premium, Mid or Value.",
     ["price positioning"], None),
    ("Revenue", "METRIC",
     "Net sales in AUD from POS sell-through, after discounts. The base for Margin %, Average Selling Price and Like-for-like Revenue Growth.",
     ["sales", "turnover"], "SUM(REVENUE)"),
    ("Units Sold", "METRIC",
     "Number of units sold through the tills.",
     ["volume", "units"], "SUM(UNITS_SOLD)"),
    ("Gross Margin", "METRIC",
     "Revenue less cost of goods, in AUD.",
     ["GP", "margin dollars"], "SUM(MARGIN)"),
    ("Margin %", "METRIC",
     "Gross Margin divided by Revenue, on a 0-100 scale. Rebuilt from the totals for any group, never averaged across rows.",
     ["GM%", "margin rate"], "SUM(MARGIN) / SUM(REVENUE) * 100"),
    ("Average Selling Price", "METRIC",
     "Revenue divided by Units Sold, in AUD.",
     ["ASP"], "SUM(REVENUE) / SUM(UNITS_SOLD)"),
    ("Rate of Sale", "METRIC",
     "Units of a Brand sold per store per week. Shows how fast a range turns, independent of how many stores carry it.",
     ["ROS"], "AVG(RATE_OF_SALE)"),
    ("Like-for-like Revenue Growth", "METRIC",
     "Revenue this year over Revenue in the same fiscal weeks last year, minus one, as a %. "
     "Uses the Like-for-like Period so a part year is never compared with a full year.",
     ["LFL growth", "YoY growth", "this year vs last year"],
     "SUM(REVENUE) FY2026 / SUM(REVENUE) FY2025 - 1, both over fiscal weeks 27-52 and 1-18"),
    ("DIFOT %", "METRIC",
     "Share of a Supplier's orders delivered in full and on time, weighted by orders, on a 0-100 scale. Baby Mart's DIFOT Target is 96.",
     ["DIFOT", "OTIF", "on-time in-full"], "SUM(DIFOT_PCT * ORDERS_TOTAL) / SUM(ORDERS_TOTAL)"),
    ("Customer Lifetime Value", "METRIC",
     "Expected total spend of a Brand's Customers over their time with Baby Mart, in AUD, weighted by customers.",
     ["CLV", "lifetime value"], "SUM(AVG_CLV * CUSTOMER_COUNT) / SUM(CUSTOMER_COUNT)"),
    ("Brand Switches", "METRIC",
     "Customers who moved from one Brand to another within a Class. Counted against the Brand they left, so it shows customers lost.",
     ["switching", "customers lost"], "SUM(SWITCH_COUNT) GROUP BY FROM_BRAND"),
    ("Promotional Margin %", "METRIC",
     "Margin earned on a Promotion divided by its promotional revenue, on a 0-100 scale.",
     ["promo margin rate"], "SUM(PROMO_MARGIN) / SUM(PROMO_REVENUE) * 100"),
    ("Margin per Discount Dollar", "METRIC",
     "Margin a Promotion returns for every AUD 1 of discount given. Compares Promotion Mechanics on payback.",
     ["promo ROI"], "SUM(PROMO_MARGIN) / SUM(TOTAL_DISCOUNT)"),
    ("Price Gap %", "METRIC",
     "How much dearer Baby Mart's shelf price is than a Competitor's on the same Product, as a %. Positive means Baby Mart is dearer.",
     ["price index", "price gap"], "AVG(AVG_PRICE_GAP_PCT)"),
    ("Revenue per Switch", "METRIC",
     "Revenue divided by Brand Switches: how much a Brand sells for each customer it loses to another brand.",
     [], "SUM(REVENUE) / SUM(SWITCH_COUNT)"),
    ("Like-for-like Period", "POLICY",
     "FY2026 sales end 7 May 2026, so growth compares the same fiscal weeks of both years: weeks 27-52 and 1-18. "
     "Never compare a part year with a full year.",
     ["same weeks rule"], None),
    ("DIFOT Target", "POLICY",
     "Baby Mart expects Suppliers to deliver 96% of orders in full and on time. Below 90% is a red flag to raise in the negotiation brief.",
     ["DIFOT SLA"], None),
    ("Rebuilt Ratios", "POLICY",
     "Margin %, Average Selling Price, DIFOT % and Customer Lifetime Value are rebuilt from their totals for any group, "
     "weighted by revenue, units, orders or customers. Never average row-level percentages.",
     ["no averaging percentages"], None),
    ("Demand Override", "TERM",
     "A planner adjustment that multiplies forecast demand for a Class over chosen weeks, e.g. DOV-26-0415. "
     "Explains why reported demand can run ahead of Units Sold at the tills.",
     ["planner override"], None),
]

# source, target, type
RELS = [
    ("Supplier", "Brand", "HAS_PART"),
    ("Brand", "Product", "HAS_PART"),
    ("Category", "Class", "HAS_PART"),
    ("Category", "Product", "CLASSIFIES"),
    ("Class", "Product", "CLASSIFIES"),
    ("Price Tier", "Brand", "CLASSIFIES"),
    ("Customer Segment", "Customer", "CLASSIFIES"),
    ("Promotion Mechanic", "Promotion", "CLASSIFIES"),
    ("Revenue", "Margin %", "DERIVES"),
    ("Gross Margin", "Margin %", "DERIVES"),
    ("Revenue", "Average Selling Price", "DERIVES"),
    ("Units Sold", "Average Selling Price", "DERIVES"),
    ("Revenue", "Like-for-like Revenue Growth", "DERIVES"),
    ("Revenue", "Revenue per Switch", "DERIVES"),
    ("Brand Switches", "Revenue per Switch", "DERIVES"),
    ("Revenue", "Brand", "MEASURES"),
    ("Rate of Sale", "Brand", "MEASURES"),
    ("Brand Switches", "Brand", "MEASURES"),
    ("DIFOT %", "Supplier", "MEASURES"),
    ("Customer Lifetime Value", "Customer", "MEASURES"),
    ("Promotional Margin %", "Promotion", "MEASURES"),
    ("Margin per Discount Dollar", "Promotion", "MEASURES"),
    ("Price Gap %", "Competitor", "MEASURES"),
    ("Like-for-like Period", "Like-for-like Revenue Growth", "APPLIES_TO"),
    ("DIFOT Target", "DIFOT %", "APPLIES_TO"),
    ("Rebuilt Ratios", "Margin %", "APPLIES_TO"),
    ("Rebuilt Ratios", "Average Selling Price", "APPLIES_TO"),
    ("Rebuilt Ratios", "DIFOT %", "APPLIES_TO"),
    ("Rebuilt Ratios", "Customer Lifetime Value", "APPLIES_TO"),
    ("Demand Override", "Units Sold", "RELATED_TO"),
]


def table(name, fqn):
    return {"refType": "TABLE", "fqn": fqn, "objectName": fqn.split(".")[-1]}


def sv(view, kind=None, entity=None, name=None):
    ref = {"refType": "SEMANTIC_VIEW", "fqn": f"{SV}.{view}"}
    if kind is None:
        ref["objectName"] = view
        return ref
    ref["subObjectType"] = kind
    ref["subObjectName"] = name
    if entity:
        ref["entityQualifier"] = entity
    return ref


def metric(view, entity, name):
    return sv(view, "METRIC", entity, name)


def dim(view, entity, name):
    return sv(view, "DIMENSION", entity, name)


# node -> [(assetRef, role)]
D, R = "DESCRIBES", "RELATED_SEMANTIC_VIEW"
REPS = {
    "Brand": [(table(None, f"{CUR}.DIM_BRAND"), D), (sv("SV_CM_BRAND_BASE", "ENTITY", None, "BRANDS"), R),
              (sv("SV_CATEGORY_MANAGER"), R)],
    "Supplier": [(table(None, f"{CUR}.DIM_SUPPLIER"), D), (sv("SV_CM_BRAND_BASE", "ENTITY", None, "SUPPLIERS"), R)],
    "Product": [(table(None, f"{CUR}.DIM_PRODUCT"), D)],
    "Customer": [(table(None, f"{CUR}.DIM_CUSTOMER"), D)],
    "Promotion": [(table(None, f"{CUR}.DIM_PROMOTION"), D), (sv("SV_CM_COMMERCIAL", "ENTITY", None, "PROMOTIONS"), R)],
    "Competitor": [(dim("SV_CM_COMMERCIAL", "COMPETITIVE", "COMPETITOR_NAME"), R)],
    "Category": [(dim("SV_CM_SALES", "SELLTHROUGH", "CATEGORY"), R)],
    "Class": [(dim("SV_CM_SALES", "SELLTHROUGH", "CLASS"), R)],
    "Customer Segment": [(dim("SV_CM_CUSTOMER", "SEGMENTS", "SEGMENT_NAME"), R)],
    "Promotion Mechanic": [(dim("SV_CM_COMMERCIAL", "PROMOTIONS", "MECHANIC"), R)],
    "Price Tier": [(dim("SV_CM_BRAND_BASE", "BRANDS", "PRICE_TIER"), R)],
    "Revenue": [(metric("SV_CM_SALES", "SELLTHROUGH", "TOTAL_REVENUE"), R)],
    "Units Sold": [(metric("SV_CM_SALES", "SELLTHROUGH", "TOTAL_UNITS"), R)],
    "Gross Margin": [(metric("SV_CM_SALES", "SELLTHROUGH", "TOTAL_MARGIN"), R)],
    "Margin %": [(metric("SV_CM_SALES", "SELLTHROUGH", "MARGIN_PCT"), R)],
    "Average Selling Price": [(metric("SV_CM_SALES", "SELLTHROUGH", "AVERAGE_SELLING_PRICE"), R)],
    "Rate of Sale": [(metric("SV_CM_SALES", "SELLTHROUGH", "AVG_RATE_OF_SALE"), R)],
    "Like-for-like Revenue Growth": [(sv("SV_CM_SALES"), R)],
    "DIFOT %": [(metric("SV_CM_SUPPLY", "DIFOT", "DIFOT_RATE_PCT"), R)],
    "Customer Lifetime Value": [(metric("SV_CM_CUSTOMER", "CLV", "CUSTOMER_LIFETIME_VALUE"), R)],
    "Brand Switches": [(metric("SV_CM_CUSTOMER", "SWITCHING", "TOTAL_SWITCHES"), R)],
    "Promotional Margin %": [(metric("SV_CM_COMMERCIAL", "PROMOTIONS", "PROMO_MARGIN_PCT"), R)],
    "Margin per Discount Dollar": [(metric("SV_CM_COMMERCIAL", "PROMOTIONS", "MARGIN_PER_DISCOUNT_DOLLAR"), R)],
    "Price Gap %": [(metric("SV_CM_COMMERCIAL", "COMPETITIVE", "PRICE_GAP_PCT"), R)],
    "Revenue per Switch": [(sv("SV_CATEGORY_MANAGER", "DERIVED_METRIC", None, "REVENUE_PER_SWITCH"), R)],
    "Like-for-like Period": [(sv("SV_CM_SALES"), R)],
    "DIFOT Target": [(sv("SV_CM_SUPPLY"), R)],
    "Rebuilt Ratios": [(sv("SV_CATEGORY_MANAGER"), R)],
    "Demand Override": [(table(None, "TEMP.JARCHEN_ANALYTICS.DEMAND_OVERRIDE"), D)],
}


def check_spec():
    """The pre-write gate: anything here is a BLOCK, nothing is written."""
    kinds = {n[0]: n[1] for n in NODES}
    problems = []
    if len(kinds) != len(NODES):
        problems.append("duplicate node names")
    for name, kind, desc, _, formula in NODES:
        if len(desc) > DESC_LIMIT:
            problems.append(f"{name}: description {len(desc)} chars > {DESC_LIMIT}")
        if formula and kind != "METRIC":
            problems.append(f"{name}: formula on a {kind}")
    for s, t, typ in RELS:
        if s not in kinds or t not in kinds:
            problems.append(f"{s} -> {t}: unknown endpoint")
            continue
        if typ == "CLASSIFIES" and (kinds[s] != "DIMENSION" or kinds[t] != "ENTITY"):
            problems.append(f"{s} CLASSIFIES {t}: needs DIMENSION -> ENTITY")
        if typ == "APPLIES_TO" and kinds[s] != "POLICY":
            problems.append(f"{s} APPLIES_TO {t}: source must be a POLICY")
        if typ in ("DERIVES",) and kinds[t] != "METRIC":
            problems.append(f"{s} DERIVES {t}: target must be a METRIC")
    for name in REPS:
        if name not in kinds:
            problems.append(f"representation for unknown node {name}")
    return problems


def call(cur, fn, *args):
    """Run SYSTEM$<fn>(args) with bound string literals; return the parsed envelope."""
    placeholders = ", ".join("NULL" if a is None else "%s" for a in args)
    cur.execute(f"SELECT SYSTEM${fn}({placeholders})", [a for a in args if a is not None])
    out = json.loads(cur.fetchone()[0])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="run the gate and show the plan only")
    ap.add_argument("--snapshot-only", action="store_true",
                    help="only rewrite the lookup snapshot from the live ontology")
    a = ap.parse_args()

    problems = check_spec()
    if problems:
        print("Gate BLOCK:\n  " + "\n  ".join(problems))
        return 1
    print(f"Gate passed: {len(NODES)} nodes, {len(RELS)} relationships, "
          f"{sum(len(v) for v in REPS.values())} representations")
    if a.dry_run:
        return 0

    cur = run_sql.connect().cursor()

    if a.snapshot_only:
        live = call(cur, "GET_ONTOLOGY_SUMMARY")
        domain_id = next((d["domainId"] for d in live.get("domains", [])
                          if d.get("path") == f"Business Ontology > {PARENT} > {DOMAIN}"), None)
        if not domain_id:
            print("Domain not found")
            return 1
        return 0 if write_snapshot(cur, domain_id) else 1

    # Domain: reuse when it exists (domains have no draft state).
    summary = call(cur, "GET_ONTOLOGY_SUMMARY")
    by_path = {d.get("path"): d["domainId"] for d in summary.get("domains", [])}
    path = f"Business Ontology > {PARENT} > {DOMAIN}"
    domain_id = by_path.get(path)
    if domain_id:
        print(f"Domain exists: {path} ({domain_id})")
    else:
        res = call(cur, "CREATE_ONTOLOGY_DOMAIN", f"{PARENT}.{DOMAIN}", DOMAIN_DESC)
        if res.get("error"):
            print("Domain create failed:", res.get("errorMessage"))
            return 1
        domain_id = res["domainId"]
        print(f"Domain created: {res.get('path')} ({domain_id})")

    # Nodes: skip names already live or drafted in this domain.
    live = call(cur, "GET_ONTOLOGY_TERM_LIST", domain_id, "TERM", "", "10000", "0")
    ids = {t["name"]: t["termId"] for t in live.get("terms", [])}
    active = set(ids)
    drafts = call(cur, "GET_ONTOLOGY_TERM_DRAFTS", domain_id, "100", "0")
    for t in drafts.get("terms", drafts.get("drafts", [])):
        if t.get("draftKind", "CREATE") == "CREATE" and t.get("termId"):
            ids.setdefault(t.get("name") or t.get("termName"), t["termId"])

    failed = 0
    for name, kind, desc, syns, formula in NODES:
        if name in active:
            continue
        if name not in ids:
            payload = {"name": name, "domainId": domain_id, "itemKind": kind, "description": desc,
                       "synonyms": syns, "sourceType": "MANUAL"}
            if formula:
                payload["formula"] = formula
                payload["formulaSource"] = "sql/53_category_composable_semantic_views.sql"
            res = call(cur, "DRAFT_ONTOLOGY_TERM", json.dumps(payload))
            if res.get("error"):
                print(f"  node {name}: {res.get('errorMessage')}")
                failed += 1
                continue
            ids[name] = res["termId"]
        res = call(cur, "APPROVE_ONTOLOGY_TERM", ids[name])
        if res.get("error"):
            print(f"  approve {name}: {res.get('errorMessage')}")
            failed += 1
    print(f"Nodes: {len(ids)} in domain")

    # Relationships: CREATE is not idempotent, so skip edges that already exist.
    have = live_edges(cur, ids.values())
    for s, t, typ in RELS:
        if s not in ids or t not in ids:
            continue
        if (ids[s], ids[t], typ) in have:
            continue
        # Snowhouse rejects a NULL label ("inputs may not be null"), so a standard
        # type is the three-argument form; provenance is then left unset.
        res = call(cur, "CREATE_ONTOLOGY_RELATIONSHIP", ids[s], ids[t], typ)
        if res.get("error"):
            print(f"  {s} {typ} {t}: {res.get('errorMessage')}")
            failed += 1

    # Representations: idempotent server-side.
    for name, refs in REPS.items():
        if name not in ids:
            continue
        for ref, role in refs:
            src = "SV_DEFINITION" if ref["refType"] == "SEMANTIC_VIEW" else "MANUAL"
            res = call(cur, "CREATE_ONTOLOGY_ASSOCIATION", ids[name], json.dumps(ref), role, src)
            if res.get("error"):
                print(f"  {name} -> {ref.get('subObjectName') or ref.get('objectName')}: {res.get('errorMessage')}")
                failed += 1

    # Read back. GET_ONTOLOGY_GRAPH caps its relationships and associations on
    # Snowhouse (truncated: true, 18 of 30 edges), so read each node instead.
    live = call(cur, "GET_ONTOLOGY_TERM_LIST", domain_id, "TERM", "", "10000", "0")
    active = {t["name"] for t in live.get("terms", [])}
    edges = live_edges(cur, ids.values())
    rels_ok = sum((ids.get(s), ids.get(t), typ) in edges for s, t, typ in RELS)
    reps = sum(len(call(cur, "GET_ONTOLOGY_TERM_ASSETS", ids[n], "").get("assets", []))
               for n in REPS if n in ids)
    print(f"Read back: {len(active)}/{len(NODES)} nodes, {rels_ok}/{len(RELS)} relationships, "
          f"{reps}/{sum(len(v) for v in REPS.values())} representations")
    missing = [n for n, *_ in NODES if n not in active]
    if missing:
        print("  not active:", ", ".join(missing))
    if not write_snapshot(cur, domain_id):
        failed += 1
    return 1 if failed or missing or rels_ok < len(RELS) else 0


def write_snapshot(cur, domain_id):
    """Copy the live, ACTIVE ontology into AI.ONTOLOGY_SNAPSHOT for ONTOLOGY_LOOKUP
    (sql/54). Listing a domain's terms takes ~25 s on Snowhouse, longer than an agent
    tool should; reading one term takes under a second, so the copy is built here,
    term by term, whenever the ontology is (re)built."""
    live = call(cur, "GET_ONTOLOGY_TERM_LIST", domain_id, "TERM", "", "10000", "0")
    terms = [t for t in live.get("terms", []) if t.get("status") == "ACTIVE"]
    names = {t["termId"]: t["name"] for t in terms}
    rows = []
    for t in terms:
        full = call(cur, "GET_ONTOLOGY_TERM", t["termId"])
        edges = [f"{names.get(e['sourceTermId'], e['sourceTermId'])} "
                 f"{e['relationshipType'].lower().replace('_', ' ')} "
                 f"{names.get(e['targetTermId'], e['targetTermId'])}"
                 for e in (full.get("relationships") or {}).get("edges", []) if e.get("status") == "ACTIVE"]
        reps = [f"{r.get('fqn')} {str(r.get('subObjectType') or '').lower()} "
                f"{(r.get('entityQualifier') + '.') if r.get('entityQualifier') else ''}{r.get('subObjectName')}"
                if r.get("subObjectName") else (r.get("fqn") or r.get("objectName"))
                for r in full.get("representedAs") or []]
        rows.append((t["termId"], t["name"], t.get("itemKind"), t.get("description"), t.get("formula"),
                     json.dumps(t.get("synonyms") or []), json.dumps(sorted(set(edges))), json.dumps(reps)))
    cur.execute(f"""CREATE OR REPLACE TABLE {AI}.ONTOLOGY_SNAPSHOT (
        TERM_ID VARCHAR, NAME VARCHAR, ITEM_KIND VARCHAR, DEFINITION VARCHAR, FORMULA VARCHAR,
        SYNONYMS ARRAY, RELATIONSHIPS ARRAY, REPRESENTED_BY ARRAY,
        DOMAIN VARCHAR DEFAULT '{DOMAIN}', DOMAIN_ID VARCHAR DEFAULT '{domain_id}',
        SNAPSHOT_AT TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP())
      COMMENT = 'ACTIVE nodes of the {DOMAIN} ontology, copied by scripts/build_category_ontology.py'""")
    # One INSERT per node: the connector cannot batch an INSERT ... SELECT.
    for row in rows:
        cur.execute(f"""INSERT INTO {AI}.ONTOLOGY_SNAPSHOT
            (TERM_ID, NAME, ITEM_KIND, DEFINITION, FORMULA, SYNONYMS, RELATIONSHIPS, REPRESENTED_BY)
            SELECT %s, %s, %s, %s, %s, PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s)""", row)
    print(f"Snapshot: {len(rows)} nodes into {AI}.ONTOLOGY_SNAPSHOT")
    return len(rows) == len(terms) and len(rows) > 0


def live_edges(cur, term_ids):
    """Every ACTIVE edge touching these nodes, as (sourceId, targetId, type)."""
    out = set()
    for tid in term_ids:
        term = call(cur, "GET_ONTOLOGY_TERM", tid)
        for e in (term.get("relationships") or {}).get("edges", []):
            if e.get("status") == "ACTIVE":
                out.add((e["sourceTermId"], e["targetTermId"], e["relationshipType"]))
    return out


if __name__ == "__main__":
    sys.exit(main())
