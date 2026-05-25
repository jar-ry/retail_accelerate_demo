# Demo Bullets — Baby Mart Supplier Collaboration Platform
## Snowflake Retail Forum 2026 (~17 min)

---

### Opening (1 min)
- Retailer-supplier relationship = asymmetric information problem
- Both sides walk into meetings with spreadsheets and gut feel
- One platform, two products, same data, different intent
- Product 1: Supplier-facing Native App (their account, their compute)
- Product 2: Retailer-facing internal AI tool (battlecards, competitive intel)
- If you're a retailer — this is your playbook. If you're a supplier — this is what's coming.

---

### Act 1: Retailer Internal Advantage (5 min)

**Dashboard**
- SPCS-hosted React app — no external infra
- Top/bottom performers at a glance
- Uppababy up 24%, Bugaboo declining -8% — these are this week's conversations

**Brand Deep-Dive (Bugaboo)**
- Revenue trending down, rate of sale dropping
- Inventory imbalance: SA overstocked (14 weeks), VIC about to run out (3 weeks)
- This drives a specific supplier conversation about distribution

**Battlecard (Huggies)**
- One button → AI-generated negotiation prep from real transaction data
- Key insights: gateway brand, high CLV, promo ROI below break-even, bundles 2.1x better
- Recommended levers: shift to bundles, request exclusive pack sizes, leverage acquisition value
- "I know more about their performance in my business than they do" — asymmetric advantage

**Competitive Intel**
- Price gap analysis — Huggies 8% above market
- Switching data with competitor names attached
- None of this leaves the retailer side

**Transition:** "That's the internal weapon. SPCS, Cortex AI, Dynamic Tables, Semantic View. Now let's flip to the supplier side."

---

### Act 2: Supplier Native App (5 min)

**Install Moment**
- Supplier's own Snowflake account
- One-click install via private listing
- Gets: 4 dashboards + semantic view + Cortex Agent
- Runs on THEIR compute — retailer controls the data perimeter

**Sellthrough**
- Filtered to their brands only
- Strong in NSW, underperforming VIC
- Actionable: where to focus trade marketing spend

**Customer Segments**
- Which segments buy their products
- First-time parents = biggest segment (positioning working)
- Expecting segment underindexed = registry opportunity
- Supplier only sees their own data

**Brand Switching (Anonymised)**
- Gaining in Newborn Nappies, losing in Toddler Nappies
- Net position by product class
- NO competitor names — they know they're losing, not to whom
- Secure views + row-level filtering = same data, different visibility

---

### Act 3: AI Agent in Native App (4 min)

**First Question: "How am I performing by state this quarter?"**
- Cortex Agent + Semantic View inside the native app
- Natural language → SQL → structured answer with data table
- No BI training, no SQL knowledge needed — sales reps can use this

**Follow-up: "Which product class is losing the most customers?"**
- Handles context, uses switching data
- Tells Huggies that Toddler Nappies is the weak spot

**The Wow:** Retailer built an agent, packaged it in a Native App, shipped it to the supplier's account. Supplier installed an app — didn't build anything, didn't hire a data team.

---

### Architecture + Close (2 min)

**8 Snowflake capabilities in one demo:**
- Native App Framework — full app in one install
- Secure Data Sharing — zero-copy, real-time, filtered
- Dynamic Tables — hourly refresh aggregations
- Secure Views — row-level filtering per supplier
- Cortex Agent — NL Q&A inside native app
- Semantic View — business-friendly layer
- SPCS — React app inside Snowflake
- Cortex AI (COMPLETE) — battlecard generation

**Close:**
- Not a science project — all GA or preview, buildable in weeks
- The winners will have better data PRODUCTS, not just better data
- Relevant to everyone: retailers build this, suppliers should demand it

---

### Key Phrases
- "Same data, different intent"
- "Asymmetric advantage"
- "We shipped an AI analyst to the supplier"
- "Zero ETL, zero credentials, zero data movement"
- "One platform, two products"

---

### Prep Checklist
- [ ] Pre-warm warehouses 5 min before
- [ ] SPCS service running
- [ ] Test retailer app: https://fmcy5is-sfseapac-jchen-aws1.snowflakecomputing.app
- [ ] Test supplier Streamlit loads in Snowsight
- [ ] Pre-test agent with "How am I performing by state?"
- [ ] Two browser windows ready (retailer + supplier)
- [ ] Fallback screenshots prepared
