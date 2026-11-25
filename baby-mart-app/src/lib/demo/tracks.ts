// ─── Demo talk tracks: one story per persona ─────────────────────────────────
//
// What /demo shows and what the presenter guide (components/demo/DemoGuide.tsx)
// walks through in demo mode. Each track opens with "Imagine you wake up
// tomorrow and ...", then follows the route a presenter takes that persona
// through the app: what is on screen, what to say, what to click next.
//
// The figures in `proof` are what the seeded data shows (checked on the pages);
// agent answers are live, so a run may word a finding differently. Keep a step's
// route a real page: the guide matches the current path against it.

export type DemoPersona = "category" | "supply" | "planning" | "hop" | "campaign" | "nps";

export type DemoStep = {
  title: string;
  /** Where the step happens. May carry a query (?q= auto-asks an agent). */
  route: string;
  /** What is on screen to point at. */
  show: string;
  /** The line to say. */
  say: string;
  /** What to click to move the story on. */
  click?: string;
  /** Figures worth quoting on this step. */
  proof?: string[];
};

export type DemoTrack = {
  id: DemoPersona;
  role: string;
  minutes: number;
  /** "Imagine you wake up tomorrow and ..." */
  hook: string;
  /** Why it matters before lunch. */
  stakes: string;
  today: string[];
  withIt: string[];
  steps: DemoStep[];
  close: string;
  /** The Snowflake capabilities the track shows. */
  snowflake: string[];
  /** Set-up and clean-up so the story lands the same way every time. */
  prep: string[];
  /** Where this story meets another persona's. */
  connects?: string;
};

const q = (s: string) => encodeURIComponent(s);

export const DEMO_TRACKS: DemoTrack[] = [
  {
    id: "category",
    role: "Category Manager",
    minutes: 10,
    hook:
      "Imagine you wake up tomorrow and Kimberly-Clark's account team is in your office at ten. The supply report says Huggies Crawler Nappies are spiking, the dashboard says Bugaboo is sliding, and you have an hour to work out what is real and what to ask for.",
    stakes:
      "Walk in with the wrong story and you either concede margin on a spike that never sold, or blame a supplier for misses that were your own orders.",
    today: [
      "Pull POS, the demand feed and the DIFOT scorecard into three spreadsheets that don't agree",
      "Ask an analyst \"why\" and wait two days for a deck",
      "Build the negotiation ask from last year's template and gut feel",
    ],
    withIt: [
      "One set of numbers from the tills, on every page",
      "An investigator that tests every cause and shows its working, with each figure checked against the data",
      "Asks sized from the data, with what to give and where to walk away",
    ],
    steps: [
      {
        title: "Start where the day starts",
        route: "/dashboard",
        show: "Category Performance Dashboard: last 28 days against last year, the brand matrix, top performers and underperformers.",
        say: "Every number here comes straight from the tills, refreshed by dynamic tables. Every other page reads the same figures, so nobody argues about whose spreadsheet is right.",
        click: "Bugaboo sits in Underperformers. Note it; we'll come back. Open Huggies from the sidebar.",
      },
      {
        title: "The spike that isn't",
        route: "/brand/Huggies",
        show: "The amber banner: \"Reported demand disagrees with POS\" for Crawler Nappies, with the class table flagged reported ≠ POS.",
        say: "The supply team's demand feed says Crawler Nappies are up. The tills say they aren't. Before anyone negotiates on a spike, let's find out which one is right.",
        click: "Click the Investigate link on Crawler Nappies.",
        proof: ["Crawler Nappies +15.0% reported vs POS, FY2026 weeks 1-19"],
      },
      {
        title: "Investigate: is it in sales at all?",
        route: `/agent?mode=investigate&q=${q("What drove the Huggies Crawler Nappies spike?")}`,
        show: "The Brand Investigator's progress trail on the left (each tool call as it runs) and the root-cause card on the right, with a \"figures verified\" badge.",
        say: "It checks whether the spike is real before it explains it. It isn't: four planner overrides from 2 April, due for review on 30 April, are still inflating the feed. The real risk is DIFOT, which collapsed in the same weeks while stores still had stock.",
        click: "Scroll to What we tested: market, price, timing, promotion, competitor and supply, each with a verdict.",
        proof: ["Overrides DOV-26-0415 to 0418 (x1.35 to x2.20), Sam Patel, review 30 Apr, still active", "Crawler DIFOT down to 54% in week 18"],
      },
      {
        title: "Ask anything, then ask why",
        route: "/agent",
        show: "The Category Agent: Look up / Investigate. A lookup goes to the Analyst over the category semantic view; a brand \"why\" goes to the investigator.",
        say: "Ask it a plain question and it writes the SQL against a governed semantic view, comparing the same weeks of each year. Ask it why, and it switches to the investigator.",
        click: "Ask \"Top 5 brands by revenue growth this year\", then \"Why is Bugaboo down on last year?\".",
        proof: ["Bugaboo -15.7% (AUD -445K) vs rest of Prams & Strollers +2.3%: volume, not price"],
      },
      {
        title: "Size the asks",
        route: `/negotiate?q=${q("Build a negotiation brief for our Huggies meeting with Kimberly-Clark.")}`,
        show: "The Negotiation Brief: each ask with opening, target and walk-away values, the gives, other levers and guardrails, saved as a DRAFT.",
        say: "Each ask is sized from the data. And it's honest: where the DIFOT misses were our own override-sized orders, it offers to waive the credit instead of claiming it. That earns credibility in the room.",
        click: "Approve it for the meeting; it moves from DRAFT to approved.",
      },
      {
        title: "Show what context changes",
        route: "/ontology",
        show: "The Ontology page: one question asked of the same agent three times over the same semantic view, alone, with the Business Ontology, and with the ontology plus Cortex Sense, checked against an answer worked out from the base tables.",
        say: "Same model, same data, same question. The only thing that changes is the context. Without it the agent compares a part year with a full year and says every brand shrank. The ontology brings the like-for-like rule; Cortex Sense adds the caveat that the Huggies class rows double count the orders.",
        click: "Ask \"Which brands are growing fastest this year?\", then \"What is the Huggies DIFOT this year, and how many orders was that?\".",
        proof: ["Semantic view alone: Nuna -11.0%; with the ontology: Nuna +2.9% like-for-like", "Huggies DIFOT 93.7% on 5,222 orders, only with Cortex Sense"],
      },
    ],
    close:
      "You walk into ten o'clock knowing the spike isn't in sales, that part of the DIFOT miss was ours, and with asks you can defend line by line. That took ten minutes, not two days.",
    snowflake: [
      "Cortex Agents (Brand Investigator, Negotiation Brief) with procedure tools",
      "Cortex Analyst over a semantic view",
      "Business Ontology and Cortex Sense as agent context",
      "Dynamic tables over POS",
      "Answer verification against tool output",
      "Snowflake App Runtime",
    ],
    prep: [
      "Category Agent: start with New so the thread is empty.",
      "Negotiation Brief: each build supersedes the brand's earlier drafts. Approve only if you want the approved state shown next time.",
    ],
    connects: "The same Huggies override shows up for the Supply Chain Planner on the demand page and in the DIFOT Investigator.",
  },
  {
    id: "supply",
    role: "Supply Chain Planner",
    minutes: 9,
    hook:
      "Imagine you wake up tomorrow and 12 of your 17 NSW stores have no Rascal + Friends Crawler Nappies, the DC has none to send, and Marketing has a live campaign pointing loyalty members straight at the empty shelves.",
    stakes:
      "Every week out costs sales, sends members to Woolworths, and drives the complaints the NPS team is about to find.",
    today: [
      "An exception email, a phone call to the supplier, and a guess at how much to transfer",
      "No one tells Marketing their campaign is pointing at empty stores",
      "DIFOT penalties argued from the supplier's scorecard, not ours",
    ],
    withIt: [
      "Alerts that turn straight into a recovery plan",
      "A recovery plan with costed options, approved in one click",
      "A DIFOT investigator that tells you whether a miss was the supplier's or ours",
    ],
    steps: [
      {
        title: "The morning picture",
        route: "/replenishment",
        show: "Replenishment dashboard: weeks of cover by brand. Uppababy, Huggies and Rascal + Friends are critical; Bugaboo is overstocked.",
        say: "POs, DC stock, the forecast and POS live in one place, so this is one view of the whole network. Three brands are below minimum cover, and Bugaboo is sitting on far too much.",
        click: "Open Alerts.",
        proof: ["Rascal + Friends 3 weeks of cover, below the 4-week minimum", "Bugaboo 18.3 weeks: overstock"],
      },
      {
        title: "One alert, two problems",
        route: "/replenishment/alerts",
        show: "The critical Rascal + Friends card: Rascal & Co has short-shipped NSW Crawler Nappies since May and NSW stores are running out.",
        say: "The supplier is short-shipping and the DC has nothing to send. And Marketing doesn't know yet: their live loyalty campaign is aimed at these same stores. We're paying to send members to empty shelves.",
        click: "Click Build a recovery plan on the Rascal + Friends card.",
      },
      {
        title: "Build the recovery",
        route: `/replenishment/recovery?q=${q("Rascal + Friends Crawler Nappies are out of stock in NSW. Get them back on shelf.")}`,
        show: "The Stockout Recovery agent's options: A transfer, B PO, C both, each costed, with the recommended option marked.",
        say: "It reads real demand from the tills and actual DC stock, then costs each way back to cover. Transfer alone isn't enough while supplier fill is under 90%, so it recommends both: move stock from VIC now and raise a PO to sustain it.",
        click: "Approve the recommended option. NSW moves from SHORT to LOW, which clears the campaign's stock conflict too.",
        proof: ["12 of 17 NSW stores out, about 0.6 weeks of cover", "About AUD 467 a week of lost sales", "Option C: 79 units from VIC plus a 240-unit PO"],
      },
      {
        title: "Them or us?",
        route: `/replenishment/investigate?q=${q("Which suppliers are below the DIFOT target, and is it them or us?")}`,
        show: "The DIFOT Investigator: each supplier below the 96% target, with the miss attributed to SUPPLIER or BABY_MART and the evidence for each.",
        say: "Rascal & Co's misses are theirs: that's a credit claim. Kimberly-Clark's Huggies Crawler misses are ours: we ordered against an inflated demand feed. We'd have penalised the wrong supplier.",
        click: "Follow the Build a recovery plan hand-off on any supplier action, or move on.",
      },
      {
        title: "Find the source",
        route: "/replenishment/demand",
        show: "Customer Demand. Open Huggies, then a Crawler Nappies SKU: the override banner names the planner, the dates and the review date.",
        say: "Here's where the inflated orders came from: a manual uplift for a TV campaign, never reviewed. One click hands it to the Category Manager's investigator.",
        click: "Ask the Brand Investigator (it opens the Category Agent).",
      },
    ],
    close:
      "Before the first coffee is cold, stock is moving back into NSW, Marketing's conflict is cleared, and you know which supplier to chase and which mistake was yours to fix.",
    snowflake: [
      "Cortex Agents with procedure tools that write DRAFT plans",
      "Human approval writing back to Snowflake tables",
      "One shared copy of data across supply, campaign and NPS",
    ],
    prep: [
      "Stockout Recovery: press Reset demo before you present. Approving a plan lifts NSW from SHORT to LOW, which also changes the Campaign and NPS stories.",
      "Reset again after the demo.",
    ],
    connects: "The NSW stockout is the root cause the NPS Investigator finds, and the conflict the Campaign Investigator flags on camp-001.",
  },
  {
    id: "planning",
    role: "Merchandise Planner",
    minutes: 9,
    hook:
      "Imagine you wake up tomorrow and the trading meeting wants to know why Prams & Strollers is 14% behind budget, and what you'll do about it before the H2 buys are locked.",
    stakes:
      "If the budget is wrong, chasing it means overbuying stock that won't sell. If trading is wrong, the fix is in range and price. You need to know which before you commit open-to-buy.",
    today: [
      "Export the MFP, pivot it by class and month, and still not know if it's demand or the budget",
      "Model a range cut in a spreadsheet copy that drifts from the plan",
      "Argue the scenario in the meeting with no audit trail",
    ],
    withIt: [
      "Exceptions that come with an \"Investigate why\"",
      "An investigator that tests class, month, price vs volume and buying before it names a cause",
      "Scenario options with guardrails, written to a sandbox, approved as a versioned forecast",
    ],
    steps: [
      {
        title: "The exceptions",
        route: "/planning",
        show: "The planning dashboard: departments against budget. Prams & Strollers is the worst sales exception; Nappies & Wipes and Feeding trade ahead. Amounts are in PHP.",
        say: "The hardgoods carry the shortfall and the consumables trade ahead: prams are the first purchase a nervous shopper delays. The question is whether Prams is underperforming, or the budget was wrong.",
        click: "Click Investigate why on PRAMS & STROLLERS.",
        proof: ["Prams & Strollers -14.2% to budget"],
      },
      {
        title: "Budget, not trading",
        route: `/planning/investigate?node=${q("PRAMS & STROLLERS")}`,
        show: "The Plan Investigator's root-cause card: the gap is uniform across classes and months, volume-led, and the weeks already traded are on forecast.",
        say: "Every class and every month is about 14% short, and what we've already traded is on forecast. That pattern means the budget was set above demand. It ruled out a bad class, seasonality, Bugaboo's late POs and margin.",
        click: "Click Run in Scenario Builder on an action.",
        proof: ["Gap about PHP -93.8M (-14.2%) in H1", "Traded weeks about -0.9% to forecast, -15.1% to budget"],
      },
      {
        title: "Options, with guardrails",
        route: `/planning/scenarios?builder=${q("PRAMS & STROLLERS is behind budget and overbought. What can we do in H2?")}`,
        show: "The Scenario Builder card: range-cut options with sales, GP, stock and GP-rate deltas, guardrails marked PASS, CAUTION or BLOCK, and one recommended.",
        say: "It doesn't just say \"cut the range\". It runs the solvers and shows what each option does to sales, margin and stock, then writes them as drafts in a sandbox. The approved forecast is never touched.",
        click: "Open the Sandbox tab: the approved Travel System range cut is v1 in the history.",
      },
      {
        title: "The near-miss",
        route: `/planning/scenarios?builder=${q("Find PHP 2M of GP in H2 for SINGLE STROLLER and give me options")}`,
        show: "The goal-seek options: the price route can't reach the target within the price elasticity, so the builder blocks it; adding options gets there but adds stock.",
        say: "It tells you when the maths doesn't work. That's the trade-off the meeting needs to see: margin through price is capped, and margin through range costs stock.",
      },
      {
        title: "Where the money is tied up",
        route: "/planning/otb",
        show: "OTB Position: overbought overall, and the class table with Travel System's cover against its target and its negative open-to-buy.",
        say: "This is why the range cut matters: Travel System is already overbought, so every unit we don't buy frees open-to-buy for the classes trading ahead.",
        proof: ["Open-to-buy -PHP 98.5M overall", "Travel System 14.4 weeks cover vs a 6.1-week target, OTB -PHP 62.6M"],
      },
    ],
    close:
      "You go into the trading meeting saying the budget was wrong, not the business, with a costed range cut, a guarded margin option and an audit trail, without one exported spreadsheet.",
    snowflake: [
      "Cortex Agents over the merchandise plan",
      "Stored-procedure solvers (goal seek, range rationalisation)",
      "Versioned scenarios with an audit trail",
      "Cortex Analyst (Merch Agent)",
    ],
    prep: [
      "Each Scenario Builder run writes DRAFT scenarios. Discard them with the trash icon on each row after the demo.",
      "The approved Travel System v1 and the Single Stroller goal-seek drafts are seeded. Don't approve the goal-seek during rehearsal.",
    ],
  },
  {
    id: "hop",
    role: "Head of Planning",
    minutes: 9,
    hook:
      "Imagine you wake up tomorrow and the plan the board signed in May (AUD 90.32M at +4.3% like-for-like) is already AUD 2.18M short on the latest estimate, the business is trading 2.4% behind last year, and someone has edited a store's December like-for-like through a spreadsheet import.",
    stakes:
      "You own the number. If the store plan and the product plan don't add up, or the locked plan is changing without sign-off, it's your credibility at the next board.",
    today: [
      "A store plan workbook, an MFP workbook and a WSSI, reconciled by hand",
      "No record of who changed a locked number, or why",
      "\"Which states are weak?\" answered with a pivot table, not a cause",
    ],
    withIt: [
      "Store plan, MFP and WSSI on one governed model that ties to the cent",
      "Every edit after lock owned, reasoned and flagged",
      "An investigator and a sandbox builder that turn a weak plan into costed options",
    ],
    steps: [
      {
        title: "The locked plan",
        route: "/hop",
        show: "Overview: the H1 store plan against the baseline approved on 27 May, like-for-like, new stores, trading to date, the latest estimate, and an AI read of the screen with every number checked.",
        say: "This is the plan of record, locked at the board and versioned. Trading is behind, the latest estimate is short of budget, and the AI read tells you where the risk sits: Buying's committed range doesn't deliver the growth.",
        proof: ["Latest estimate AUD 88.14M vs the AUD 90.32M budget (-2.4%)", "Trading to date -2.4% vs last year", "Live plan +AUD 274K since approval"],
      },
      {
        title: "Where the plan is weak",
        route: "/hop/store-plan",
        show: "The store plan by state, region and format, with each store's like-for-like and any recorded reason.",
        say: "Sixty stores, each with its own like-for-like. The question every Head of Planning gets is \"which states are soft, and is that real?\"",
        click: "Open the Planning Investigator from the page link.",
      },
      {
        title: "Mix, not performance",
        route: `/hop/investigate?q=${q("Why does QLD plan weaker like-for-like than the rest of the business?")}`,
        show: "The Planning Investigator separates store mix from rate: QLD is weakest mostly because of which stores it has.",
        say: "QLD isn't underperforming store for store. It has more of the regional standard stores that plan lower everywhere. And VIC isn't weak at all: two stores with a recorded refurbishment and a cannibalisation are dragging its average.",
        click: "Click Build it in a sandbox on the action.",
        proof: ["QLD plans about 3.85% like-for-like, and most of the gap is store mix"],
      },
      {
        title: "Try it safely",
        route: `/hop/sandbox?q=${q("What if the QLD Metro Standard stores planned at their peer rate?")}`,
        show: "The Sandbox builder's options, with guardrails: above the best store, overriding a recorded reason, or moving the plan off the approved total.",
        say: "Each option is costed against the approved plan. It warns before you plan a store above the best performer, or overwrite a reason someone recorded. Open one and it becomes a real sandbox; the live plan doesn't change.",
        click: "Open as sandbox. It opens the store plan with the sandbox loaded.",
      },
      {
        title: "Governance",
        route: "/hop/approve",
        show: "Approve & lock: the approved baseline, the live plan, every edit since approval with its owner and reason, and the one failing the rules.",
        say: "Eight edits since the plan was locked, each with an owner and a reason. One failed the rules: S009's December like-for-like went from 7.9% to 8.9% through a spreadsheet import, with no escalation, and the system caught it. That's the control the board actually cares about.",
        proof: ["8 edits since approval, 1 failing the rules", "S009 Dec LFL 7.90% to 8.90%, spreadsheet-import, post-lock without escalation"],
      },
    ],
    close:
      "You can tell the board where the plan is soft and why, show a costed fix in a sandbox, and prove every change to the locked plan has an owner, in one place instead of three workbooks.",
    snowflake: [
      "Governed planning model in Snowflake (views tie store plan, MFP and WSSI)",
      "Transactional writes with an audit trail",
      "Cortex Agents (Planning Investigator, Sandbox builder)",
      "AI insights with guardrails on every figure",
    ],
    prep: [
      "Sandbox builder: proposals are kept, and opened sandboxes create PLAN_SCENARIO rows. Delete your test sandboxes afterwards.",
      "Leave other users' sandboxes alone.",
    ],
  },
  {
    id: "campaign",
    role: "Campaign Manager",
    minutes: 9,
    hook:
      "Imagine you wake up tomorrow and your best-performing loyalty campaign is quietly making customers angry, because it's sending them to stores with empty shelves.",
    stakes:
      "The campaign dashboard says it's working. The voice of the customer says it's backfiring. You need to know which before you spend the rest of the budget.",
    today: [
      "Campaign results in one tool, stock in another, complaints in a third",
      "Audiences built by gut feel, offers sent to people who'd have bought anyway",
      "Post-campaign reports with no causal read",
    ],
    withIt: [
      "Measured lift against a holdout, with an investigator that reads stock and customer voice",
      "A campaign builder that sizes the audience, checks stock and guardrails, and estimates lift before you spend",
      "Learnings that feed the next brief",
    ],
    steps: [
      {
        title: "The portfolio",
        route: "/campaigns",
        show: "Overview: lift against a randomised holdout, and Needs attention. Crawler Nappies Surge – Loyalty Push (camp-001) has four alerts, one of them a stock conflict.",
        say: "Every campaign is measured against a holdout, so last-touch can't claim sales that would have happened anyway. camp-001 is live, but it shows no lift, the replies are negative, and thousands of its members shop at stores that are short of the product it promotes.",
        click: "Click Open on the stock alert, then Investigate.",
        proof: ["3,374 treated members shop at a store short of Rascal + Friends", "No lift over the holdout after 10 days (-0.40 pts)", "83% of 329 replies negative"],
      },
      {
        title: "Why it's backfiring",
        route: "/campaigns/performance/camp-001?investigate=1",
        show: "The Campaign Investigator: lift by stock position, out-of-stock replies, and the root cause.",
        say: "Members at short stores did worse than the holdout, and the replies are about empty shelves. The campaign isn't failing; supply is, and the campaign is amplifying it.",
        click: "Click Ask Supply to recover stock. It hands off to the Supply Chain Planner's recovery agent.",
        proof: ["About 263 out-of-stock replies from short stores"],
      },
      {
        title: "Build the next one properly",
        route: `/campaigns/builder?q=${q("We are carrying too much Bugaboo stock. Who should we tell, and is it worth an offer?")}`,
        show: "The Campaign Builder card: audience sized from real customers, persuadables vs sure things, guardrails (stock, consent, contact pressure), an estimated incremental lift and a recommended offer.",
        say: "Bugaboo is overstocked and down on last year, so this is a clearance problem. The builder sizes who's persuadable, checks we actually have the stock, and tells us whether an offer pays for itself before we send anything.",
        click: "Save it as a draft brief.",
      },
      {
        title: "Ideas from the data",
        route: "/campaigns/ideas",
        show: "The ideas board: campaign ideas generated from customer signals, each re-sized and guardrail-checked in code.",
        say: "The ideas aren't free text from a model. Every number on a card is re-computed by the app before you see it.",
      },
      {
        title: "Close the loop",
        route: "/campaigns/learnings",
        show: "Learnings: templated from treated-vs-holdout numbers, not written by a model. Empty until a measured campaign's learnings are published from Performance.",
        say: "When a campaign is measured, you publish what it taught you, and the next ideas and audiences read it. Nothing here is a model's opinion; it's the holdout result.",
      },
    ],
    close:
      "Before you spend another dollar, you know camp-001 is amplifying a stockout, Supply is already fixing it, and the next campaign is sized, checked and costed.",
    snowflake: [
      "Cortex Agents (Campaign Builder, Campaign Investigator)",
      "AI_SENTIMENT and AI_CLASSIFY on customer voice",
      "Cortex Search over verbatims",
      "Semantic views",
      "Tools built from the same TypeScript as the app",
    ],
    prep: [
      "Supply's Stockout Recovery must be RESET, or camp-001's stock conflict will already be resolved.",
      "Saving a builder draft writes a BRIEF campaign and a DRAFT audience. Delete them after the demo.",
    ],
    connects: "The stock conflict on camp-001 is the same NSW Rascal + Friends stockout Supply recovers and the NPS Analyst finds.",
  },
  {
    id: "nps",
    role: "NPS Analyst",
    minutes: 8,
    hook:
      "Imagine you wake up tomorrow and NSW's NPS has fallen 25 points in three weeks, from +15.6 to -9.6, and the CEO wants to know why by lunch.",
    stakes:
      "Guess wrong and you'll retrain store staff for a problem that is actually an empty shelf and a campaign shouting about it.",
    today: [
      "Survey exports, a word cloud and a guess",
      "No link from a complaint to stock, campaigns or deliveries",
      "Find out about the next break when it has already happened",
    ],
    withIt: [
      "Every verbatim read by AI for sentiment and theme",
      "An investigator that splits the fall exactly and tests stock, campaigns, delivery, price and app",
      "A risk radar that predicts the next store to break",
    ],
    steps: [
      {
        title: "The pulse",
        route: "/sentiment",
        show: "Pulse: national NPS for the focus week, out-of-stock complaints against their baseline, the AI sentiment index, and the sentiment-break banner for NSW.",
        say: "Every survey comment, review, care email, social post and campaign reply is read by AI for sentiment and theme. NPS is always rebuilt from promoter and detractor counts, never averaged. And it has already spotted the break: NSW, with out-of-stock complaints up more than twenty-fold.",
        click: "Click Open the state map.",
        proof: ["NSW NPS -12.2 in the week of 27 Apr, -18.6 pts on the four weeks before", "Out-of-stock complaints 24.2x their weekly baseline"],
      },
      {
        title: "Find it",
        route: "/sentiment/map",
        show: "The state map for the week of 27 April: NSW is lowest and falling, and its top theme is out of stock. States with fewer than 20 surveys are greyed out.",
        say: "It's not national, it's NSW, and NSW customers are telling us the shelves are empty.",
        click: "Click NSW, then Investigate NSW.",
        proof: ["NSW NPS -12.2 in the week of 27 Apr, -18.6 vs the four weeks before", "342 out-of-stock mentions"],
      },
      {
        title: "Explain it",
        route: `/sentiment/investigate?q=${q("Why did NSW NPS fall in late April?")}`,
        show: "The NPS Investigator: the exact split of the fall by category, the stock test, the campaign test, supplier DIFOT, and the root cause at High confidence.",
        say: "Nappies & Wipes is almost 80% of the fall. Rascal + Friends is short in 12 of 15 stores, and it's DC-wide, not one store. And camp-001 has been pointing loyalty members straight at those stores. It hands off to Supply's recovery agent.",
        click: "Click Build a recovery plan on the stock action.",
        proof: ["NSW NPS 15.6 to -9.6 (-25.2 pts)", "Nappies & Wipes 77.8% of the fall", "Rascal + Friends short in 12 of 15 stores", "263 of 267 out-of-stock replies from short stores"],
      },
      {
        title: "One store, 360",
        route: "/sentiment/store",
        show: "Store 360: pick an NSW store to see its NPS, themes, supply status and verbatims side by side.",
        say: "Every store gets the same view: is it this store, or something its whole state shares?",
      },
      {
        title: "Predict the next one",
        route: "/sentiment/risk",
        show: "Risk radar: a Snowflake ML classification model scores every store for the six weeks after the voice clock. It shows the stores at HIGH or CRITICAL risk, the share of each state's stores at risk by week, the drivers, and the holdout AUC.",
        say: "Most of the flagged stores are short of a brand, so a recovery plan can stop the break before it happens. SA lights up next: Uppababy is short there, and customers haven't complained yet.",
        click: "Re-score with live supply: after Supply approves a recovery, the risk moves.",
        proof: ["16 stores at HIGH or CRITICAL, 14 of them short of a brand", "SA 50% of stores at risk in the week of 25 May", "Holdout AUC 0.79"],
      },
    ],
    close:
      "By lunch the CEO hears it's a supply problem made louder by a campaign, not a service problem. Supply is already moving stock, and you've named the next stores at risk.",
    snowflake: [
      "AI_SENTIMENT and AI_CLASSIFY",
      "Cortex Search over customer voice",
      "Cortex Agent with exact decomposition tools",
      "Snowflake ML classification",
      "Semantic view",
    ],
    prep: [
      "Supply's Stockout Recovery should be RESET so NSW still shows the shortage in the current supply view.",
      "Second story if there's time: \"What has driven the national NPS decline since February?\" (Gold & Platinum members, on price).",
    ],
    connects: "The NSW break is the Supply Chain Planner's stockout and the Campaign Manager's camp-001 seen from the customer's side.",
  },
];

export const trackById = (id: string | null | undefined): DemoTrack | undefined =>
  DEMO_TRACKS.find((t) => t.id === id);

/** The path a step's route points at, decoded, without its query. */
export function stepPath(route: string): string {
  const p = route.split("?")[0].split("#")[0];
  try { return decodeURIComponent(p); } catch { return p; }
}

/** The step of `track` a page is on: the current step if it matches, else the
 *  first step whose path is this page. -1 when the page is not in the track. */
export function stepForPath(track: DemoTrack, pathname: string, current = -1): number {
  let path = pathname;
  try { path = decodeURIComponent(pathname); } catch { /* keep raw */ }
  path = path.replace(/\/+$/, "") || "/";
  if (current >= 0 && stepPath(track.steps[current]?.route ?? "") === path) return current;
  return track.steps.findIndex((s) => stepPath(s.route) === path);
}

/** A step's route with the persona tag, so a shared page (/agent) keeps the
 *  track's sidebar across the full-page reload. */
export function stepHref(track: DemoTrack, step: DemoStep): string {
  if (!/^\/(agent|assessment|settings|demo)(\/|\?|$)/.test(step.route)) return step.route;
  return step.route + (step.route.includes("?") ? "&" : "?") + `persona=${track.id}`;
}
