// ─── OneDigital Campaign Manager: brand voice and claims rules ──────────────
//
// What every AI call that writes for a customer, or about the business, is told.
// Versioned here because there is no settings page for prose yet: a change is a
// code change, reviewed like one, and the version is logged on every AI run.

export const DOCTRINE_VERSION = 1;

export const BRAND_VOICE = `Officeworks talks like a helpful expert in the aisle: practical, straightforward and on the
customer's side. Australian English (organise, colour, ute). Short sentences. Lead with what the customer gets done,
then the detail. One clear call to action. No exclamation marks in email subjects. Speak to the job in front of them
(setting up a new business, getting the kids ready for school) and never to what they bought at another banner: no
"we noticed you bought...", no mention of Bunnings or Kmart purchases.`;

export const CLAIMS_RULES = `Prices, savings and offer terms may only be quoted exactly as supplied. Do not claim "lowest price",
"cheapest" or "best price guaranteed". Do not invent stock levels, deadlines or scarcity ("only 3 left", "ends tonight")
that are not in the brief. Do not promise approval of a business account or credit terms: terms are "subject to
approval". Do not make performance claims for technology ("fastest", "never breaks down"). Never reveal or imply what a
member bought at Bunnings or Kmart, or that their purchases were analysed.`;

export const BANNED_PHRASES = [
  "lowest price", "cheapest", "best price guaranteed", "only a few left", "ends tonight", "don't miss out", "act now",
  "we noticed you bought", "you recently bought", "at bunnings", "at kmart", "your purchases", "guaranteed approval", "fastest",
];

export const INSIGHT_METHOD = `How the Campaign Manager judges a campaign:
1. Incremental beats reported. A conversion counts only as the lift over the holdout: treated rate minus holdout rate,
   in points, times the treated members. Never quote conversions over clicks as success.
2. A lift whose 95% interval spans zero is not a result yet. Say so and say how much more data it needs.
3. Money: incremental margin minus send and offer cost. An offer given to someone who would have bought anyway is cost.
4. Who to leave alone matters as much as who to target: members whose lift is negative (sleeping dogs) and members
   whose store cannot supply the promoted product.
5. Every recommendation names who acts: CRM (the campaign team), MERCHANDISING, SUPPLY or DATA (the OneDigital data team).`;
