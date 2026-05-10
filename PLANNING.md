# Baby Mart Supplier Collaboration Platform — Planning Document

## Executive Summary

This demo showcases two complementary products built on Snowflake for **Baby Mart**, Australia's largest specialty baby retailer. The platform demonstrates how a retailer can leverage Snowflake's full stack to power supplier collaboration and category management — turning data into a competitive advantage.

**Target Audience:** Retail executives, category managers, supply chain leaders, and technology decision-makers at a retail conference.

**Key Message:** Snowflake is not just a data warehouse — it's the intelligent platform that powers real-time supplier collaboration, AI-driven negotiation support, and automated supply chain communications.

**Frontend:** Modern React application (Vite + TypeScript) with a polished, production-grade UI that demonstrates how enterprises build on top of Snowflake APIs.

---

## Demo Products

### Product 1: Supplier Sellthrough Intelligence (EXTERNAL — Supplier-facing)
A portal that gives suppliers visibility into how their products are performing at Baby Mart. Data flows from the retailer's Snowflake to the supplier's Snowflake via **Secure Data Sharing** (zero-copy, real-time). The supplier can build their own apps on top of this shared data — or use the React portal we provide.

**Who uses it:** Suppliers (e.g., Bugaboo, Huggies) — on their own Snowflake account
**Value prop for supplier:** "This is how you're performing in our business. This is where you're hot. This is where you need to replenish."
**Value prop for retailer:** Better supplier collaboration → just-in-time inventory → fewer stockouts, less overstock, better availability for customers.

### Product 2: Category Manager Battlecard & Negotiation Support (INTERNAL — Retailer only)
An internal tool that arms category managers with data-driven insights for buying decisions and commercial negotiations. This data is **never shared** with suppliers — it's the retailer's asymmetric advantage.

**Who uses it:** Baby Mart category managers — internal access only
**Value prop:** "This is how you should negotiate against this supplier. These are the levers you have."
**Example insight:** "Huggies has a super high CLV — customers who buy Huggies go on to spend 40% more across our business. We can accept thinner margins on Huggies because the long-term customer value justifies it (like iPhones at Officeworks)."

---

## Technology Stack

### Retailer App (Category Manager Battlecard — Internal)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | React 18 + TypeScript + Vite | Production-grade UI, conference-worthy polish |
| **UI Framework** | Tailwind CSS + shadcn/ui | Clean, professional components |
| **Charting** | Recharts + Plotly.js (Sankey) | Rich interactive visualizations |
| **State Management** | TanStack Query (React Query) | Server state caching, loading states |
| **Routing** | React Router v6 | Multi-page app with clean navigation |
| **API Layer** | Python FastAPI proxy | Connects React to Snowflake securely |
| **Backend** | Snowflake (SQL, Cortex Agent, Cortex Analyst) | All data & AI processing |
| **AI Chat** | Cortex Agent REST API (SSE) | Streaming responses for agent comms |

### Supplier App (Sellthrough Intelligence — External, Native App)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | Snowflake Native App Framework | Distributed via private listing; app + data together |
| **Frontend** | Streamlit in Snowflake (inside app) | Runs on supplier's compute; no external hosting |
| **Charting** | Plotly (via Streamlit) | Sankey, heatmaps, trend charts |
| **Data Access** | Shared content data in app package | Zero-copy secure views, supplier-filtered |
| **Distribution** | Private Listing → Supplier Account | Marketplace-style install experience |
| **AI Agent** | Cortex Agent (called from Streamlit) | Supplier can chat with AI about their performance |

---

## Mocked Data Requirements

### Business Context
- **Retailer:** Baby Mart (AU specialty baby retailer)
- **Product Mix:** Soft lines, hard lines, FMCG
- **Categories (5):** Car Seats, Prams & Strollers, Nappies & Wipes, Clothing, Feeding
- **Time Range:** 2 full years of history (Jul 2024 – Jun 2026) to enable YoY comparisons
- **Fiscal Calendar:** Australian retail (Jul–Jun financial year)

### Data Volumes (Synthetic)

| Table | Approximate Rows | Notes |
|-------|------------------|-------|
| DIM_STORE | 60 | Based on Baby Mart's real store footprint across AU |
| DIM_PRODUCT | 2,500 | ~500 SKUs per category across multiple brands |
| DIM_SUPPLIER | 25 | 5 per category on average |
| DIM_BRAND | 40 | Multiple brands per supplier |
| DIM_CUSTOMER | 150,000 | Loyalty program members |
| DIM_CUSTOMER_SEGMENT | 6 | First-time parents, Second-time parents, Gift buyers, Grandparents, Expecting, Registry |
| FACT_TRANSACTIONS | 5,000,000 | ~2 years of daily transactions |
| FACT_TRANSACTION_LINES | 12,000,000 | ~2.4 items per basket |
| FACT_INVENTORY | 50,000,000 | Daily SOH snapshots (60 stores x 2500 SKUs x ~330 days) |
| FACT_PURCHASE_ORDERS | 200,000 | Supplier POs over 2 years |
| DIM_PROMOTIONS | 500 | Promotional events with mechanic types |
| FACT_PROMOTION_RESULTS | 25,000 | SKU-level promo performance |
| COMPETITOR_PRICING | 500,000 | Weekly scraped prices from 3 competitors |
| FACT_BUDGET | 150,000 | Plan/budget at category-store-week level |

### Key Brands Per Category (Mocked)

| Category | Brands | Notes |
|----------|--------|-------|
| Prams & Strollers | Bugaboo, Uppababy, Silver Cross, Babyzen, Mountain Buggy | Premium segment with clear switching dynamics |
| Car Seats | Maxi-Cosi, Britax, Cybex, Nuna, Infasecure | Safety-focused, regulatory driven |
| Nappies & Wipes | Huggies, Pampers, Rascal + Friends, Tooshies, ECO by Naty | FMCG with high repeat purchase |
| Clothing | Bonds Baby, Purebaby, Cotton On Baby, Marquise, Bebe | Seasonal, size-driven purchases |
| Feeding | Avent (Philips), Tommee Tippee, Dr Browns, Pigeon, NUK | Accessory-heavy, brand loyal |

### Customer Segments

| Segment | % of Base | Behaviour |
|---------|-----------|-----------|
| First-time Parents | 35% | High research, premium-leaning, large baskets |
| Second-time Parents | 25% | Value-seeking, know what they want, faster purchase cycle |
| Gift Buyers | 15% | Seasonal spikes, premium items, one-off |
| Grandparents | 10% | Car seats, prams (big ticket), infrequent but high AOV |
| Expecting | 10% | Registry-driven, discovery phase |
| Registry Shoppers | 5% | Following someone else's list, diverse basket |

### Data Characteristics to Mock

1. **Seasonality:** Birth seasonality (peaks in March/Sept in AU), Christmas gifting surge
2. **Brand Switching:** Clear patterns — Bugaboo losing share to Uppababy in premium prams; Huggies stable but losing to Rascal + Friends in eco-conscious segment
3. **Promotional Patterns:** Huggies deep discounts = pull-forward (not incremental); Bugaboo rarely discounts (low elasticity)
4. **Regional Variation:** Melbourne metro = premium preference; Regional QLD = value-driven
5. **New Customer Entry:** Specific brands act as "entry points" (e.g., Bonds Baby in clothing brings customers who later buy across categories)

---

## Demo Flow (15-minute conference presentation)

### Act 1: Category Manager View — Internal (5 min)
*Context: "This is what the retailer's category manager sees. None of this is shared with the supplier."*

1. **Open Battlecard** for "Huggies" in Nappies category
   - Show CLV comparison: Huggies customers vs. category average
   - Show entry point analysis: Huggies is a gateway brand (70% of nappy customers start here)
   - Key message: "We can accept thinner margins on Huggies because they bring us high-value customers"
2. **Promotional Elasticity Deep Dive**
   - Visual: Huggies 30% off = 80% uplift BUT 60% is pull-forward (customers buying early, not new customers)
   - Contrast: Rascal + Friends 20% off = 40% uplift, 75% incremental (attracting new customers)
3. **Competitive Intelligence**
   - Price gap index: Huggies is 8% above market average
   - When Coles drops Huggies price, Baby Mart sell-through dips within 48hrs
4. **AI-Generated Negotiation Summary**
   - One-pager: "Huggies promos are not incremental. Recommend requesting co-op marketing spend instead of deeper discounts. Their brand switching position is stable — they have leverage but we should push for exclusive pack sizes."

### Act 2: Supplier Portal View — Native App (5 min)
*Context: "Now let's switch to what the supplier sees. The retailer has shared a Native App — it includes data, dashboards, a semantic view, AND a Cortex Agent. The supplier installs it and gets everything in one click."*

5. **Show the Native App install moment** (brief)
   - Quick view in Snowsight: Supplier installs the app from the private listing
   - "The supplier gets data + dashboards + AI agent + natural language interface. No ETL, no setup, no data leaving the retailer's control."
6. **Switch to Bugaboo supplier view** (inside the installed native app)
   - Sellthrough dashboard: Drilldown National → VIC → Melbourne CBD → Store #12
   - Weeks of cover: 14 weeks in SA (overstocked) vs. 3 weeks in VIC (risk of stockout)
   - Key message: "Bugaboo can see they need to replenish Melbourne NOW"
7. **Customer Segment Overlay**
   - Bugaboo over-indexes with First-time Parents (45% vs. 35% category average)
   - Gift buyers contribute 20% of Bugaboo revenue (vs. 12% category average)
8. **Brand Switching Analysis**
   - Switch-in: 12% of Bugaboo buyers previously bought Silver Cross
   - Switch-out: 18% of lapsed Bugaboo buyers moved to Uppababy (alarming trend)
   - Visual: Sankey diagram of brand flows

### Act 3: AI Agent Communication — Inside the Native App (5 min)
*Context: "The Cortex Agent and Semantic View are INSIDE the native app — the supplier can ask questions in plain English and the agent queries their shared data."*

9. **Supplier asks the agent** (inside the Streamlit chat panel): "How am I performing this week?"
   - Agent uses Semantic View → translates to SQL → queries shared data → responds:
   - "Bugaboo Fox 5 sell-through is +15% vs. LW nationally, but Melbourne is -8% vs. plan. Recommend transferring 20 units from Adelaide (14 WOC) to Melbourne (3 WOC). PO #4521 for Dragonfly should be reduced by 30%."
10. **Supplier Reply** — "Why is Melbourne underperforming?"
   - Agent responds with data-backed answer: "Melbourne CBD store saw a 22% drop in foot traffic W/C April 28 due to construction. Additionally, Uppababy launched a competing model at $200 less at David Jones Melbourne on April 25. Recommend temporary bundle offer."
11. **Wow Moment** — Show that this is all running inside the supplier's Snowflake account, on their compute, with zero data leaving the retailer's governance perimeter. The retailer shipped an AI analyst to the supplier.

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Audience engagement | Visible reactions at brand switching Sankey and agent reply |
| Data realism | Attendees should believe the data is real (proper seasonality, realistic margins) |
| Speed | All queries return in < 3 seconds |
| AI quality | Agent responses are specific, data-backed, and actionable |
| Platform coverage | Showcase 5+ Snowflake capabilities (see Architecture doc) |
| UI polish | App looks like a real production SaaS product, not a prototype |

---

## Timeline (Estimated)

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| 1. Data Generation | 2 days | All synthetic tables loaded into Snowflake (retailer account) |
| 2. Semantic Model | 1 day | Cortex Analyst semantic model YAML |
| 3. Retailer React App | 2 days | Category Manager Battlecard (CLV, elasticity, competitive, AI battlecard) |
| 4. FastAPI Proxy | 0.5 day | API layer for retailer React app |
| 5. Supplier Native App (Streamlit) | 2 days | Streamlit pages (sellthrough, segments, switching, AI comms) |
| 6. Native App Packaging | 1 day | manifest.yml, setup.sql, app package, version, private listing |
| 7. Cortex Agent Backend | 1 day | Agent definition + tools + semantic model |
| 8. Install & Test on Supplier Account | 0.5 day | Install native app, verify data + UI |
| 9. Demo Polish & Rehearsal | 1 day | Animations, transitions, timing, fallbacks |
| **Total** | **~11 days** | |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Synthetic data looks fake | Kills credibility | Use real store locations, real brand names, realistic seasonality curves |
| Agent hallucination in live demo | Embarrassment | Pre-seed agent context; use deterministic queries for demo path; have fallback responses |
| Slow queries on large fact tables | Breaks flow | Pre-warm warehouse; use materialized views for complex aggregations; cluster key tables |
| Audience asks "is this real data?" | Distraction | Upfront disclaimer: "Synthetic data modelled on real retail patterns" |
| Native App install fails on demo day | Demo breaks | Pre-install before presentation; have screenshots/video backup |
| React app CORS / auth issues on stage | Demo fails | FastAPI proxy handles all Snowflake auth; test on venue wifi beforehand |
| Native App listing not visible on supplier account | Blocks Act 2 | Pre-install 24hrs before; verify access with test query |
| Conference wifi unreliable | Total failure | Pre-cache API responses locally; have offline fallback JSON; native app data is already in supplier account |

---

## Out of Scope (for this demo)

- Real web scraping (will use pre-loaded competitor pricing table)
- Email/Slack integration (will show generated content in-app)
- Multi-tenant supplier authentication (will simulate with a supplier dropdown on the supplier portal)
- Mobile responsiveness (demo is on a large screen / projector)
- Full multi-supplier share automation (will demo with one supplier account; explain scalability verbally)
