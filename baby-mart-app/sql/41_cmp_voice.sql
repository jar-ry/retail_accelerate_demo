-- ============================================================
-- Campaign & CRM — customer voice (SYNTHETIC)
--
-- Baby Mart holds no customer free text, so it is synthesised here: post-purchase
-- surveys, product reviews, customer-care emails and social posts. Surveys and
-- reviews hang off REAL purchases -- the customer, store, product and date of an
-- actual transaction line -- so a review is always of something the reviewer
-- bought. Campaign replies are added in sql/43, once there are campaigns.
--
-- HOW THE TEXT IS BUILT. Each item is a core phrase for its theme and polarity,
-- optionally followed by a clause naming the child's age and one naming what the
-- parent plans to buy next. Built from whole clauses rather than word salad, so it
-- reads like a parent wrote it, and so the number of DISTINCT texts -- which is
-- what the AI enrichment in sql/42 pays for -- stays in the low thousands.
-- The components each item was built from are kept (TRUE_*): the gate scores the
-- AI's reading of the text against them.
--
-- STORYLINES, planted deterministically (HASH draws, no RANDOM()):
--   RF_SHORT        Rascal + Friends out of stock in NSW stores, rising from
--                   20 Apr 2026 and spiking after 28 Apr -- the day the crawler
--                   nappy campaign (camp-001) started promoting it.
--   UPPA_SHORT      Uppababy prams unavailable from 25 Apr (ALT-002).
--   BUGABOO_QUALITY wheel and fold complaints on Bugaboo -- a caution against
--                   clearing its overstock with a campaign.
--   GOLD_PRICE      Gold and Platinum members complaining about price, Feb-Apr
--                   2026 -- the sleeping dogs the early-access campaign woke.
--   FITTING         praise for free car-seat fitting -- the angle for the
--                   capsule-to-convertible campaign.
--   UPGRADE_ASK     parents whose capsule is nearly outgrown asking about the
--                   next seat -- the demand signal behind that campaign.
--   Red herrings the investigator should rule out: WA_DELIVERY (late deliveries
--   in WA, Mar-Apr 2026) and APP_OUTAGE (website down 9-15 Mar 2026).
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.CAMPAIGN;

-- ---------- 1. Phrase library ----------
-- {brand}, {store} and {class} are filled from the item. Avoid writing a schema
-- name followed by a full stop in these phrases: the Snowhouse retargeter would
-- rewrite it as a table reference.
CREATE OR REPLACE TABLE VOICE_PHRASE (
  PHRASE_ID  NUMBER,
  STORYLINE  VARCHAR,
  THEME      VARCHAR,
  POLARITY   VARCHAR,
  CATEGORY   VARCHAR,
  SOURCES    VARCHAR,
  TEXT       VARCHAR
) COMMENT = 'Core phrases the synthetic customer voice is built from.';

INSERT INTO VOICE_PHRASE (PHRASE_ID, STORYLINE, THEME, POLARITY, CATEGORY, SOURCES, TEXT)
SELECT ROW_NUMBER() OVER (ORDER BY column1, column2, column3, column4, column6), column1, column2, column3, column4, column5, column6 FROM VALUES
  -- Storyline: Rascal + Friends short in NSW
  ('RF_SHORT', 'Out of stock', 'NEG', 'Nappies & Wipes', 'SURVEY,CARE,SOCIAL', 'Got the email about the {brand} crawler nappies deal, drove to {store} and the shelf was empty.'),
  ('RF_SHORT', 'Out of stock', 'NEG', 'Nappies & Wipes', 'SURVEY,CARE,SOCIAL', 'Second week in a row {store} has had no {brand} crawler nappies. Why advertise what you do not have?'),
  ('RF_SHORT', 'Out of stock', 'NEG', 'Nappies & Wipes', 'SURVEY,CARE,REVIEW', 'The {brand} nappies on special were sold out online and at {store}, so I bought another brand elsewhere.'),
  ('RF_SHORT', 'Out of stock', 'NEG', 'Nappies & Wipes', 'SURVEY,SOCIAL,REVIEW', 'Empty shelves again at {store} for {brand}. We go through a pack every few days.'),
  ('RF_SHORT', 'Out of stock', 'NEG', 'Nappies & Wipes', 'CARE,SURVEY', 'I was told the {brand} crawler nappies would be back on Tuesday. It is Friday and still nothing at {store}.'),
  ('RF_SHORT', 'Out of stock', 'NEG', 'ANY',             'SOCIAL', 'Third Baby Mart in Sydney this week with no {brand} nappies. Do not bother with the promo.'),
  ('RF_SHORT', 'Out of stock', 'NEG', 'ANY',             'SOCIAL', 'Baby Mart {store} is sold out of the {brand} nappies they keep advertising.'),
  -- Storyline: Uppababy short
  ('UPPA_SHORT', 'Out of stock', 'NEG', 'Prams & Strollers', 'SURVEY,CARE,REVIEW', 'Wanted to buy the {brand} pram we tested last week but {store} has none in stock and cannot say when.'),
  ('UPPA_SHORT', 'Out of stock', 'NEG', 'Prams & Strollers', 'SURVEY,CARE,REVIEW', 'Waiting three weeks for a {brand} stroller to arrive. Baby is due soon and we are getting nervous.'),
  ('UPPA_SHORT', 'Out of stock', 'NEG', 'ANY',               'SOCIAL', 'Every store we tried is out of {brand} prams. Not great when you are 36 weeks along.'),
  -- Storyline: Bugaboo quality
  ('BUGABOO_QUALITY', 'Product quality and safety', 'NEG', 'Prams & Strollers', 'SURVEY,REVIEW,CARE', 'The front wheel on our {brand} pram started squeaking after a month.'),
  ('BUGABOO_QUALITY', 'Product quality and safety', 'NEG', 'Prams & Strollers', 'SURVEY,REVIEW,CARE', 'The fold mechanism on our {brand} jams most days. Disappointing at this price.'),
  ('BUGABOO_QUALITY', 'Product quality and safety', 'NEG', 'Prams & Strollers', 'REVIEW,CARE', 'Had to send our {brand} stroller back twice for the same brake fault.'),
  ('BUGABOO_QUALITY', 'Product quality and safety', 'MIXED', 'Prams & Strollers', 'REVIEW,SURVEY,CARE', 'Love how the {brand} pushes, but the wheels rattle on footpaths already.'),
  -- Storyline: Gold and Platinum members on price
  ('GOLD_PRICE', 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE,REVIEW', 'As a loyalty member I expected better prices. I found the same {class} cheaper at Big W.'),
  ('GOLD_PRICE', 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE', 'Even with my member tier I am paying more here than at Big W for the same things.'),
  ('GOLD_PRICE', 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE', 'I keep getting emails about member deals but the prices are still higher than online.'),
  ('GOLD_PRICE', 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE', 'Prices have crept up again and loyalty points do not make up for it.'),
  ('GOLD_PRICE', 'Price and value', 'NEG', 'ANY', 'SURVEY,REVIEW', 'Checked Amazon after buying and it was twenty dollars cheaper. Not happy as a long-time member.'),
  ('GOLD_PRICE', 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE', 'Member pricing used to mean something. Now it is the same as everyone else.'),
  -- Storyline: car-seat fitting praise
  ('FITTING', 'Staff and expert advice', 'POS', 'Car Seats', 'SURVEY,REVIEW,SOCIAL', 'The team at {store} fitted our {brand} capsule in ten minutes and showed us how to adjust the harness.'),
  ('FITTING', 'Staff and expert advice', 'POS', 'Car Seats', 'SURVEY,REVIEW,SOCIAL', 'Free car seat fitting at {store} was brilliant. Our installer explained every strap.'),
  ('FITTING', 'Staff and expert advice', 'POS', 'Car Seats', 'SURVEY,REVIEW', 'Staff at {store} spent half an hour helping us compare capsules. No pressure at all.'),
  ('FITTING', 'Staff and expert advice', 'POS', 'Car Seats', 'SURVEY,CARE', 'Booked the car seat check and they found our seat was installed wrong. So grateful.'),
  ('FITTING', 'Staff and expert advice', 'POS', 'ANY',       'SOCIAL', 'Shout out to the fitting team at Baby Mart {store}. Patient, thorough and free.'),
  -- Storyline: parents asking about the next car seat
  ('UPGRADE_ASK', 'Staff and expert advice', 'POS', 'Car Seats', 'CARE,SURVEY', 'Loved the capsule fitting last time, so we are coming back to {store} for the next seat.'),
  ('UPGRADE_ASK', 'Staff and expert advice', 'NEU', 'Car Seats', 'CARE,SURVEY', 'Can I book a fitting for a convertible car seat at {store}?'),
  ('UPGRADE_ASK', 'Range and choice', 'NEU', 'Car Seats', 'CARE,SURVEY', 'Our capsule is nearly outgrown. Which convertible seats fit a small hatchback?'),
  ('UPGRADE_ASK', 'Range and choice', 'NEU', 'Car Seats', 'CARE', 'Do you have convertible seats that can stay rear facing for longer?'),
  -- Red herring: WA deliveries
  ('WA_DELIVERY', 'Delivery and click and collect', 'NEG', 'ANY', 'SURVEY,CARE,SOCIAL', 'My click and collect order at {store} was three days late.'),
  ('WA_DELIVERY', 'Delivery and click and collect', 'NEG', 'ANY', 'SURVEY,CARE', 'Home delivery to Perth took nearly two weeks.'),
  ('WA_DELIVERY', 'Delivery and click and collect', 'NEG', 'ANY', 'CARE,SOCIAL', 'Delivery kept getting pushed back with no explanation.'),
  -- Red herring: website outage
  ('APP_OUTAGE', 'App and website', 'NEG', 'ANY', 'SURVEY,CARE,SOCIAL', 'The website kept logging me out at checkout.'),
  ('APP_OUTAGE', 'App and website', 'NEG', 'ANY', 'SURVEY,CARE,SOCIAL', 'Could not place an order online all week because the website was down.'),
  ('APP_OUTAGE', 'App and website', 'NEG', 'ANY', 'SURVEY,CARE', 'The Baby Mart app kept crashing every time I scanned my card at the register.'),
  -- General: out of stock
  (NULL, 'Out of stock', 'NEG', 'ANY', 'SURVEY,CARE,SOCIAL', 'The size I needed was out of stock.'),
  (NULL, 'Out of stock', 'NEG', 'ANY', 'SURVEY,CARE,SOCIAL', 'Half the shelf was empty when I visited.'),
  (NULL, 'Out of stock', 'NEG', 'ANY', 'CARE', 'My online order was cancelled because the item was out of stock.'),
  (NULL, 'Out of stock', 'NEG', 'Nappies & Wipes', 'SURVEY,REVIEW', 'Could not find {brand} {class} in our size again.'),
  -- General: product quality
  (NULL, 'Product quality and safety', 'POS', 'Nappies & Wipes',   'SURVEY,REVIEW', '{brand} nappies never leak, even overnight.'),
  (NULL, 'Product quality and safety', 'POS', 'Nappies & Wipes',   'SURVEY,REVIEW', 'Gentle on sensitive skin and no rashes since we switched to {brand}.'),
  (NULL, 'Product quality and safety', 'POS', 'Prams & Strollers', 'SURVEY,REVIEW', 'Our {brand} pram handles gravel and the beach like a dream.'),
  (NULL, 'Product quality and safety', 'POS', 'Prams & Strollers', 'SURVEY,REVIEW', 'The {brand} folds with one hand, which is everything when you are holding a baby.'),
  (NULL, 'Product quality and safety', 'POS', 'Feeding',           'SURVEY,REVIEW', '{brand} bottles are easy to clean and our baby took to them straight away.'),
  (NULL, 'Product quality and safety', 'POS', 'Feeding',           'SURVEY,REVIEW', 'Really happy with the {brand} {class} we bought.'),
  (NULL, 'Product quality and safety', 'POS', 'Car Seats',         'SURVEY,REVIEW', 'The {brand} seat feels really solid and the padding is lovely.'),
  (NULL, 'Product quality and safety', 'POS', 'Car Seats',         'SURVEY,REVIEW', 'Easy to clip in and out of the car, and our baby sleeps in it every trip.'),
  (NULL, 'Product quality and safety', 'POS', 'Clothing',          'SURVEY,REVIEW', '{brand} sleepsuits are so soft and wash beautifully.'),
  (NULL, 'Product quality and safety', 'POS', 'Clothing',          'SURVEY,REVIEW', 'Great quality {class} that still look new after months of washing.'),
  (NULL, 'Product quality and safety', 'NEG', 'Nappies & Wipes',   'SURVEY,REVIEW,CARE', 'The {brand} nappies leaked overnight two nights running.'),
  (NULL, 'Product quality and safety', 'NEG', 'Feeding',           'SURVEY,REVIEW,CARE', 'The bottle teats split after a week.'),
  (NULL, 'Product quality and safety', 'NEG', 'Feeding',           'SURVEY,REVIEW,CARE', 'The highchair tray does not clip in properly.'),
  (NULL, 'Product quality and safety', 'NEG', 'Clothing',          'SURVEY,REVIEW,CARE', 'The zip on the sleeping bag broke on the second wash.'),
  (NULL, 'Product quality and safety', 'NEG', 'Car Seats',         'SURVEY,REVIEW,CARE', 'The {brand} buckle is very stiff and hard to release one-handed.'),
  (NULL, 'Product quality and safety', 'NEG', 'Prams & Strollers', 'SURVEY,REVIEW,CARE', 'The canopy on our {brand} pram tore within a few weeks.'),
  (NULL, 'Product quality and safety', 'NEG', 'ANY',               'SURVEY,CARE,SOCIAL', 'The product broke far sooner than it should have.'),
  (NULL, 'Product quality and safety', 'MIXED', 'Prams & Strollers', 'SURVEY,REVIEW', 'Love the {brand} pram, but the basket is too small for a nappy bag.'),
  (NULL, 'Product quality and safety', 'MIXED', 'Nappies & Wipes',   'SURVEY,REVIEW', 'Great nappies, though the packs seem to have shrunk.'),
  (NULL, 'Product quality and safety', 'MIXED', 'ANY',               'SURVEY,REVIEW,CARE', 'Good product overall, but the instructions were confusing.'),
  (NULL, 'Product quality and safety', 'NEU', 'ANY',                 'REVIEW,SURVEY', 'Does the job. Nothing special but no complaints.'),
  (NULL, 'Product quality and safety', 'NEU', 'ANY',                 'REVIEW', 'As described and does what it should.'),
  (NULL, 'Product quality and safety', 'NEU', 'Car Seats',           'REVIEW', 'Fine seat, a bit heavy to carry around.'),
  -- General: price and value
  (NULL, 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE,SOCIAL,REVIEW', 'Expensive compared with other baby stores.'),
  (NULL, 'Price and value', 'NEG', 'ANY', 'SURVEY,CARE', 'The price on the shelf was different at the register.'),
  (NULL, 'Price and value', 'NEG', 'ANY', 'SURVEY,SOCIAL', 'Everything has gone up in price since last year.'),
  (NULL, 'Price and value', 'POS', 'ANY', 'SURVEY,REVIEW,SOCIAL', 'Great value on the bulk nappy packs.'),
  (NULL, 'Price and value', 'POS', 'ANY', 'SURVEY,REVIEW', 'They price matched a competitor without any fuss.'),
  (NULL, 'Price and value', 'POS', 'ANY', 'SURVEY,REVIEW', 'The bundle saved us a lot on the nursery setup.'),
  (NULL, 'Price and value', 'POS', 'ANY', 'REVIEW', 'Worth every cent for how much we use it.'),
  -- General: staff
  (NULL, 'Staff and expert advice', 'POS', 'ANY', 'SURVEY,SOCIAL', 'Staff were friendly and really knew their products.'),
  (NULL, 'Staff and expert advice', 'POS', 'ANY', 'SURVEY', 'The lady in the feeding aisle gave us great advice on bottles.'),
  (NULL, 'Staff and expert advice', 'POS', 'ANY', 'SURVEY,SOCIAL', 'Really patient staff with a nervous first-time dad.'),
  (NULL, 'Staff and expert advice', 'POS', 'Prams & Strollers', 'SURVEY,REVIEW', 'The pram demo at {store} helped us choose the {brand} with confidence.'),
  (NULL, 'Staff and expert advice', 'POS', 'ANY', 'CARE,SURVEY', 'I wanted to thank the team at {store} for going out of their way to help us.'),
  (NULL, 'Staff and expert advice', 'NEG', 'ANY', 'SURVEY,SOCIAL', 'Could not find anyone to help in the pram section.'),
  (NULL, 'Staff and expert advice', 'NEG', 'ANY', 'SURVEY', 'The staff member did not know anything about car seats.'),
  (NULL, 'Staff and expert advice', 'NEG', 'ANY', 'SURVEY,CARE', 'Felt rushed by staff when choosing a pram.'),
  -- General: delivery and click and collect
  (NULL, 'Delivery and click and collect', 'NEG', 'ANY', 'SURVEY,CARE', 'Click and collect was ready but nobody could find my order.'),
  (NULL, 'Delivery and click and collect', 'NEG', 'ANY', 'CARE', 'The parcel arrived with the box crushed.'),
  (NULL, 'Delivery and click and collect', 'POS', 'ANY', 'SURVEY,SOCIAL', 'Click and collect was ready in two hours. So easy with a newborn.'),
  (NULL, 'Delivery and click and collect', 'POS', 'ANY', 'SURVEY,REVIEW,CARE', 'Delivery was quick and the driver carried it inside for us.'),
  -- General: returns
  (NULL, 'Returns and refunds', 'NEG', 'ANY', 'SURVEY,CARE', 'Returning a faulty steriliser took three visits.'),
  (NULL, 'Returns and refunds', 'NEG', 'ANY', 'CARE', 'The refund took weeks to come through.'),
  (NULL, 'Returns and refunds', 'NEG', 'ANY', 'SURVEY,CARE', 'I was told I could not return an opened pack of nappies even though it was the wrong size.'),
  (NULL, 'Returns and refunds', 'POS', 'ANY', 'SURVEY', 'Swapped the wrong size with no fuss at all.'),
  (NULL, 'Returns and refunds', 'POS', 'ANY', 'SURVEY', 'Easy return, even without the receipt.'),
  -- General: range
  (NULL, 'Range and choice', 'POS', 'ANY', 'SURVEY,SOCIAL', 'Huge range of prams to try in store.'),
  (NULL, 'Range and choice', 'POS', 'ANY', 'SURVEY,REVIEW', 'Love that you stock eco nappies now.'),
  (NULL, 'Range and choice', 'POS', 'ANY', 'SURVEY', 'Great selection of winter baby clothes.'),
  (NULL, 'Range and choice', 'NEU', 'ANY', 'SURVEY', 'Found what I came in for.'),
  (NULL, 'Range and choice', 'NEU', 'ANY', 'SURVEY', 'Picked up the usual things.'),
  (NULL, 'Range and choice', 'NEU', 'ANY', 'CARE', 'Do you stock reusable swim nappies?'),
  (NULL, 'Range and choice', 'NEU', 'ANY', 'CARE', 'When will the new season clothing arrive in store?'),
  (NULL, 'Range and choice', 'NEG', 'ANY', 'SURVEY,SOCIAL', 'Wish you stocked more organic clothing.'),
  (NULL, 'Range and choice', 'NEG', 'ANY', 'SURVEY', 'Limited choice of double prams.'),
  (NULL, 'Range and choice', 'NEG', 'ANY', 'SURVEY,CARE', 'No reusable nappy options at this store.'),
  -- General: store experience
  (NULL, 'Store experience', 'POS', 'ANY', 'SURVEY,SOCIAL', 'Clean parents room and wide aisles for prams.'),
  (NULL, 'Store experience', 'POS', 'ANY', 'SURVEY', 'Plenty of parking and the store was calm.'),
  (NULL, 'Store experience', 'POS', 'ANY', 'SURVEY,SOCIAL', 'Loved the play corner, it kept our toddler busy.'),
  (NULL, 'Store experience', 'NEU', 'ANY', 'SURVEY', 'Quick visit, nothing to report.'),
  (NULL, 'Store experience', 'NEU', 'ANY', 'SOCIAL', 'Popped into {store} today for nappies and wipes.'),
  (NULL, 'Store experience', 'NEG', 'ANY', 'SURVEY,SOCIAL', 'Only one register open on a Saturday morning.'),
  (NULL, 'Store experience', 'NEG', 'ANY', 'SURVEY', 'Aisles too narrow to get a pram through.'),
  (NULL, 'Store experience', 'NEG', 'ANY', 'SURVEY,SOCIAL', 'The parents room was closed again.'),
  (NULL, 'Store experience', 'MIXED', 'ANY', 'SURVEY,SOCIAL', 'Nice store, but the queue was long.'),
  -- General: online
  (NULL, 'App and website', 'NEG', 'ANY', 'SURVEY,CARE', 'Hard to see stock levels for my store on the website.'),
  (NULL, 'App and website', 'POS', 'ANY', 'SURVEY', 'The website shows stock at my store, which saves a wasted trip.'),
  -- General: promotions
  (NULL, 'Promotions and offers', 'NEG', 'ANY', 'SURVEY,CARE', 'The discount code did not work at the register.'),
  (NULL, 'Promotions and offers', 'NEG', 'ANY', 'SURVEY,CARE', 'The offer in the email had already ended when I got to the store.'),
  (NULL, 'Promotions and offers', 'POS', 'ANY', 'SURVEY', 'The member offer was a nice surprise.'),
  (NULL, 'Promotions and offers', 'POS', 'ANY', 'SURVEY', 'Good deal on the toddler bundle from your email.'),
  -- Replies to campaign messages. Not used here: sql/43 draws them when a
  -- campaign's events are generated, by the member's situation.
  ('REPLY_STOCK', 'Out of stock', 'NEG', 'ANY', 'REPLY', 'Your message said {brand} was on special but {store} has none. Please stop promoting what you cannot supply.'),
  ('REPLY_STOCK', 'Out of stock', 'NEG', 'ANY', 'REPLY', 'Went to {store} straight after your text and the {brand} shelf was empty.'),
  ('REPLY_STOCK', 'Out of stock', 'NEG', 'ANY', 'REPLY', 'Sold out again at {store}. Third time this month I have been sent a deal I cannot use.'),
  ('REPLY_STOCK', 'Out of stock', 'NEG', 'ANY', 'REPLY', 'Is there any way to order {brand} online? {store} says it is out until June.'),
  ('REPLY_PRICE', 'Price and value', 'NEG', 'ANY', 'REPLY', 'Early access is pointless when your prices are still higher than Big W.'),
  ('REPLY_PRICE', 'Price and value', 'NEG', 'ANY', 'REPLY', 'Please stop sending me sale alerts. Your prices are not competitive any more.'),
  ('REPLY_PRICE', 'Promotions and offers', 'NEG', 'ANY', 'REPLY', 'Another message about a members sale that is not really a sale. Unsubscribe me.'),
  ('REPLY_PRICE', 'Price and value', 'NEG', 'ANY', 'REPLY', 'I complained about your pricing last month and now you send me this?'),
  ('REPLY_POS', 'Promotions and offers', 'POS', 'ANY', 'REPLY', 'Thanks for the reminder, just ordered online.'),
  ('REPLY_POS', 'Promotions and offers', 'POS', 'ANY', 'REPLY', 'Great deal, picked it up today at {store}.'),
  ('REPLY_POS', 'Promotions and offers', 'POS', 'ANY', 'REPLY', 'Love the member offers, thank you.'),
  ('REPLY_POS', 'Staff and expert advice', 'POS', 'Car Seats', 'REPLY', 'Booked our fitting at {store} for Saturday. Thank you!'),
  ('REPLY_POS', 'Staff and expert advice', 'POS', 'Car Seats', 'REPLY', 'Perfect timing, she has just outgrown the capsule. See you at {store}.'),
  ('REPLY_NEU', 'Promotions and offers', 'NEU', 'ANY', 'REPLY', 'Does this offer apply to online orders?'),
  ('REPLY_NEU', 'Promotions and offers', 'NEU', 'ANY', 'REPLY', 'Can I use the voucher with my loyalty points?'),
  ('REPLY_NEU', 'Promotions and offers', 'NEU', 'ANY', 'REPLY', 'Is the offer valid at {store}?'),
  ('REPLY_NEU', 'Staff and expert advice', 'NEU', 'Car Seats', 'REPLY', 'Do I need to book the fitting or can I just come in?'),
  ('REPLY_NEG', 'Promotions and offers', 'NEG', 'ANY', 'REPLY', 'Please stop texting me.'),
  ('REPLY_NEG', 'Promotions and offers', 'NEG', 'ANY', 'REPLY', 'Too many messages from you this month.'),
  ('REPLY_NEG', 'Promotions and offers', 'NEG', 'ANY', 'REPLY', 'The code in your email did not work at the register.')
;

-- Clauses appended to a core phrase. The child clause is the life-stage signal the
-- enrichment should pick up; the intent clause is what the parent will buy next.
CREATE OR REPLACE TABLE VOICE_CLAUSE (
  KIND      VARCHAR,
  CODE      VARCHAR,
  CLAUSE_NO NUMBER,
  TEXT      VARCHAR
) COMMENT = 'Child-age and purchase-intent clauses for the synthetic voice.';

INSERT INTO VOICE_CLAUSE VALUES
  ('CHILD', 'EXPECTING',      1, 'We are expecting our first in a few weeks.'),
  ('CHILD', 'EXPECTING',      2, 'Baby is due next month.'),
  ('CHILD', 'EXPECTING',      3, 'I am thirty-two weeks pregnant.'),
  ('CHILD', 'NEWBORN_0_3M',   1, 'Our daughter is three weeks old.'),
  ('CHILD', 'NEWBORN_0_3M',   2, 'We brought our son home last month.'),
  ('CHILD', 'NEWBORN_0_3M',   3, 'We have a newborn at home.'),
  ('CHILD', 'INFANT_3_12M',   1, 'Our little one is seven months old.'),
  ('CHILD', 'INFANT_3_12M',   2, 'My nine month old has just started crawling.'),
  ('CHILD', 'INFANT_3_12M',   3, 'Our son turned six months last week.'),
  ('CHILD', 'TODDLER_1_3Y',   1, 'Our toddler is nearly two.'),
  ('CHILD', 'TODDLER_1_3Y',   2, 'My eighteen month old is into everything.'),
  ('CHILD', 'TODDLER_1_3Y',   3, 'We have a busy two year old.'),
  ('CHILD', 'PRESCHOOL_3_5Y', 1, 'Our daughter is four.'),
  ('CHILD', 'PRESCHOOL_3_5Y', 2, 'My three year old has outgrown her seat.'),
  ('CHILD', 'SCHOOL_5_PLUS',  1, 'Our eldest has just started school.'),
  ('CHILD', 'MULTIPLE',       1, 'We have twins.'),
  ('CHILD', 'MULTIPLE',       2, 'With a toddler and a newborn at home, every minute counts.'),
  ('INTENT', 'CAR_SEAT_UPGRADE',    1, 'Next we need a convertible car seat.'),
  ('INTENT', 'CAR_SEAT_UPGRADE',    2, 'She has nearly outgrown her capsule, so a bigger seat is next.'),
  ('INTENT', 'CAR_SEAT_UPGRADE',    3, 'Can you fit a convertible seat for us soon?'),
  ('INTENT', 'PRAM_OR_STROLLER',    1, 'We will be back for a double pram.'),
  ('INTENT', 'PRAM_OR_STROLLER',    2, 'Looking at lighter strollers for travel.'),
  ('INTENT', 'FEEDING',             1, 'Looking for a highchair as we start solids.'),
  ('INTENT', 'FEEDING',             2, 'We will need more bottles soon.'),
  ('INTENT', 'NAPPY_STAGE_CHANGE',  1, 'Thinking about moving to pull-ups.'),
  ('INTENT', 'NAPPY_STAGE_CHANGE',  2, 'Time to go up a nappy size.'),
  ('INTENT', 'NURSERY_OR_CLOTHING', 1, 'Need winter clothes in the next size up.'),
  ('INTENT', 'NURSERY_OR_CLOTHING', 2, 'Setting up the nursery next.');

-- ---------- 2. The items ----------
-- Every voice item and what it was built from. VOICE_TEXT is NULL for a survey
-- answered with a score only.
CREATE OR REPLACE TABLE VOICE_ITEM (
  VOICE_ID       VARCHAR PRIMARY KEY,
  SOURCE         VARCHAR NOT NULL,
  EVENT_DATE     DATE NOT NULL,
  CUSTOMER_KEY   NUMBER,
  STORE_CODE     VARCHAR,
  PRODUCT_KEY    NUMBER,
  BRAND_NAME     VARCHAR,
  CATEGORY       VARCHAR,
  CLASS          VARCHAR,
  CAMPAIGN_ID    VARCHAR,
  PLATFORM       VARCHAR,
  NPS_SCORE      NUMBER,
  STAR_RATING    NUMBER,
  VOICE_TEXT     VARCHAR,
  TEXT_HASH      VARCHAR,
  TRUE_THEME     VARCHAR,
  TRUE_POLARITY  VARCHAR,
  TRUE_STAGE     VARCHAR,
  TRUE_INTENT    VARCHAR,
  STORYLINE      VARCHAR,
  PROVENANCE     VARCHAR NOT NULL
) COMMENT = 'SYNTHETIC customer voice: SURVEY, REVIEW, CARE, SOCIAL, and campaign REPLY (sql/43). TRUE_* columns are what the text was built from.';

-- Line-linked items: surveys and reviews on real purchases, plus care emails a few
-- days after one. The draws: U_PICK selects the line, U_STORY decides whether a
-- storyline applies, U_POL and U_THEME pick polarity and theme otherwise.
CREATE OR REPLACE TEMPORARY TABLE VOICE_STAGE AS
WITH lines AS (
  SELECT tl.TRANSACTION_LINE_KEY AS LK, tl.CUSTOMER_KEY, d.CALENDAR_DATE AS DT, s.STORE_CODE,
         REPLACE(s.STORE_NAME, 'Baby Mart ', '') AS SUBURB, s.STATE, p.PRODUCT_KEY, p.CATEGORY, p.CLASS, b.BRAND_NAME,
         c.LOYALTY_TIER,
         (ABS(HASH(tl.TRANSACTION_LINE_KEY, 'v_pick'))   % 100000) / 100000.0 AS U_PICK,
         (ABS(HASH(tl.TRANSACTION_LINE_KEY, 'v_story'))  % 100000) / 100000.0 AS U_STORY,
         (ABS(HASH(tl.TRANSACTION_LINE_KEY, 'v_pol'))    % 100000) / 100000.0 AS U_POL,
         (ABS(HASH(tl.TRANSACTION_LINE_KEY, 'v_theme'))  % 100000) / 100000.0 AS U_THEME,
         (ABS(HASH(tl.TRANSACTION_LINE_KEY, 'v_text'))   % 100000) / 100000.0 AS U_TEXT
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = tl.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_STORE s   ON s.STORE_KEY = tl.STORE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b   ON b.BRAND_KEY = p.BRAND_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ON c.CUSTOMER_KEY = tl.CUSTOMER_KEY
  WHERE tl.CUSTOMER_KEY IS NOT NULL AND d.CALENDAR_DATE <= CMP_AS_OF()
), picked AS (
  -- Which lines produce an item, and of what source. The Rascal + Friends window
  -- (NSW nappy purchases from 20 Apr) samples harder so its signal stands out of
  -- the background, as an incident does.
  SELECT l.*,
         CASE
           WHEN l.CATEGORY = 'Nappies & Wipes' AND l.STATE = 'NSW' AND l.DT >= '2026-04-20' AND l.U_PICK < 0.22 THEN 'SURVEY'
           WHEN l.U_PICK < 0.050 THEN 'SURVEY'
           WHEN l.U_PICK < 0.050 + IFF(l.CATEGORY IN ('Car Seats', 'Prams & Strollers', 'Feeding'), 0.030, 0.010) THEN 'REVIEW'
           WHEN l.U_PICK >= IFF(l.CATEGORY = 'Nappies & Wipes' AND l.STATE = 'NSW' AND l.DT >= '2026-04-20', 0.88, 0.990)
                AND l.U_PICK < 0.996 THEN 'CARE'
         END AS SOURCE
  FROM lines l
), storied AS (
  -- An out-of-stock complaint attaches to a purchase of something ELSE in the
  -- department -- the substitute the parent settled for -- and names the brand
  -- they could not get. A complaint on a purchase of the missing brand itself
  -- would contradict the receipt.
  SELECT p.*,
         CASE
           WHEN p.CATEGORY = 'Nappies & Wipes' AND p.BRAND_NAME <> 'Rascal + Friends' AND p.STATE = 'NSW' AND p.DT >= '2026-04-20'
                AND p.U_STORY < IFF(p.DT >= '2026-04-28', 0.75, 0.35)                                   THEN 'RF_SHORT'
           WHEN p.CATEGORY = 'Prams & Strollers' AND p.BRAND_NAME <> 'Uppababy' AND p.DT >= '2026-04-25' AND p.U_STORY < 0.40 THEN 'UPPA_SHORT'
           WHEN p.BRAND_NAME = 'Bugaboo' AND p.U_STORY < 0.28                                           THEN 'BUGABOO_QUALITY'
           WHEN p.LOYALTY_TIER IN ('Gold', 'Platinum') AND p.DT BETWEEN '2026-02-01' AND '2026-04-30'
                AND p.U_STORY < 0.10                                                                    THEN 'GOLD_PRICE'
           WHEN p.CLASS IN ('Capsule (0-6m)', 'Convertible (0-4y)') AND p.U_STORY < 0.40               THEN 'FITTING'
           WHEN p.STATE = 'WA' AND p.DT BETWEEN '2026-03-01' AND '2026-04-30' AND p.U_STORY < 0.25
                AND p.SOURCE <> 'REVIEW'                                                                THEN 'WA_DELIVERY'
           WHEN p.DT BETWEEN '2026-03-09' AND '2026-03-15' AND p.U_STORY < 0.30 AND p.SOURCE <> 'REVIEW' THEN 'APP_OUTAGE'
         END AS STORYLINE
  FROM picked p WHERE p.SOURCE IS NOT NULL
)
SELECT s.* EXCLUDE (BRAND_NAME),
       DECODE(s.STORYLINE, 'RF_SHORT', 'Rascal + Friends', 'UPPA_SHORT', 'Uppababy', s.BRAND_NAME) AS BRAND_NAME,
       COALESCE(DECODE(s.STORYLINE,
                  'RF_SHORT', 'NEG', 'UPPA_SHORT', 'NEG', 'BUGABOO_QUALITY', IFF(s.U_POL < 0.85, 'NEG', 'MIXED'),
                  'GOLD_PRICE', 'NEG', 'FITTING', 'POS', 'WA_DELIVERY', 'NEG', 'APP_OUTAGE', 'NEG'),
                CASE WHEN s.U_POL < 0.56 THEN 'POS' WHEN s.U_POL < 0.74 THEN 'NEU' WHEN s.U_POL < 0.80 THEN 'MIXED' ELSE 'NEG' END) AS POLARITY,
       COALESCE(DECODE(s.STORYLINE,
                  'RF_SHORT', 'Out of stock', 'UPPA_SHORT', 'Out of stock', 'BUGABOO_QUALITY', 'Product quality and safety',
                  'GOLD_PRICE', 'Price and value', 'FITTING', 'Staff and expert advice',
                  'WA_DELIVERY', 'Delivery and click and collect', 'APP_OUTAGE', 'App and website'), '') AS STORY_THEME
FROM storied s;

-- Base themes by source and polarity, for items no storyline claimed.
CREATE OR REPLACE TEMPORARY TABLE VOICE_THEME_MIX (SOURCE VARCHAR, POLARITY VARCHAR, THEME VARCHAR, LO FLOAT, HI FLOAT) AS
SELECT * FROM VALUES
  ('SURVEY', 'POS', 'Staff and expert advice', 0.00, 0.30), ('SURVEY', 'POS', 'Product quality and safety', 0.30, 0.50),
  ('SURVEY', 'POS', 'Range and choice', 0.50, 0.66),         ('SURVEY', 'POS', 'Store experience', 0.66, 0.80),
  ('SURVEY', 'POS', 'Price and value', 0.80, 0.90),          ('SURVEY', 'POS', 'Delivery and click and collect', 0.90, 0.95),
  ('SURVEY', 'POS', 'Promotions and offers', 0.95, 1.00),
  ('SURVEY', 'NEU', 'Range and choice', 0.00, 0.60),         ('SURVEY', 'NEU', 'Store experience', 0.60, 1.00),
  ('SURVEY', 'MIXED', 'Product quality and safety', 0.00, 0.55), ('SURVEY', 'MIXED', 'Store experience', 0.55, 1.00),
  ('SURVEY', 'NEG', 'Out of stock', 0.00, 0.18),             ('SURVEY', 'NEG', 'Price and value', 0.18, 0.36),
  ('SURVEY', 'NEG', 'Store experience', 0.36, 0.52),         ('SURVEY', 'NEG', 'Product quality and safety', 0.52, 0.66),
  ('SURVEY', 'NEG', 'Staff and expert advice', 0.66, 0.76),  ('SURVEY', 'NEG', 'Delivery and click and collect', 0.76, 0.83),
  ('SURVEY', 'NEG', 'Returns and refunds', 0.83, 0.90),      ('SURVEY', 'NEG', 'Promotions and offers', 0.90, 0.96),
  ('SURVEY', 'NEG', 'App and website', 0.96, 1.00),
  ('REVIEW', 'POS', 'Product quality and safety', 0.00, 0.75), ('REVIEW', 'POS', 'Price and value', 0.75, 0.90),
  ('REVIEW', 'POS', 'Range and choice', 0.90, 1.00),
  ('REVIEW', 'NEU', 'Product quality and safety', 0.00, 1.00),
  ('REVIEW', 'MIXED', 'Product quality and safety', 0.00, 1.00),
  ('REVIEW', 'NEG', 'Product quality and safety', 0.00, 0.75), ('REVIEW', 'NEG', 'Price and value', 0.75, 1.00),
  ('CARE', 'POS', 'Delivery and click and collect', 0.00, 0.50), ('CARE', 'POS', 'Staff and expert advice', 0.50, 1.00),
  ('CARE', 'NEU', 'Range and choice', 0.00, 1.00),
  ('CARE', 'MIXED', 'Product quality and safety', 0.00, 1.00),
  ('CARE', 'NEG', 'Delivery and click and collect', 0.00, 0.30), ('CARE', 'NEG', 'Returns and refunds', 0.30, 0.52),
  ('CARE', 'NEG', 'Product quality and safety', 0.52, 0.72),     ('CARE', 'NEG', 'Out of stock', 0.72, 0.86),
  ('CARE', 'NEG', 'Promotions and offers', 0.86, 0.94),          ('CARE', 'NEG', 'App and website', 0.94, 1.00),
  ('SOCIAL', 'POS', 'Staff and expert advice', 0.00, 0.35), ('SOCIAL', 'POS', 'Range and choice', 0.35, 0.60),
  ('SOCIAL', 'POS', 'Store experience', 0.60, 0.85),        ('SOCIAL', 'POS', 'Price and value', 0.85, 1.00),
  ('SOCIAL', 'NEU', 'Store experience', 0.00, 1.00),
  ('SOCIAL', 'MIXED', 'Store experience', 0.00, 1.00),
  ('SOCIAL', 'NEG', 'Out of stock', 0.00, 0.30), ('SOCIAL', 'NEG', 'Price and value', 0.30, 0.55),
  ('SOCIAL', 'NEG', 'Store experience', 0.55, 0.80), ('SOCIAL', 'NEG', 'Staff and expert advice', 0.80, 1.00)
AS t(SOURCE, POLARITY, THEME, LO, HI);

-- Social posts and the care emails asking about the next car seat are not tied to
-- a purchase line, so they are generated separately and unioned in.
CREATE OR REPLACE TEMPORARY TABLE VOICE_EXTRA AS
WITH days AS (
  SELECT DATEADD('day', SEQ4(), '2025-07-01'::DATE) AS DT FROM TABLE(GENERATOR(ROWCOUNT => 400))
), store_days AS (
  SELECT s.STORE_CODE, REPLACE(s.STORE_NAME, 'Baby Mart ', '') AS SUBURB, s.STATE, d.DT,
         (ABS(HASH(s.STORE_CODE, d.DT, 'soc_pick'))  % 100000) / 100000.0 AS U_PICK,
         (ABS(HASH(s.STORE_CODE, d.DT, 'soc_story')) % 100000) / 100000.0 AS U_STORY,
         (ABS(HASH(s.STORE_CODE, d.DT, 'soc_pol'))   % 100000) / 100000.0 AS U_POL,
         (ABS(HASH(s.STORE_CODE, d.DT, 'soc_theme')) % 100000) / 100000.0 AS U_THEME,
         (ABS(HASH(s.STORE_CODE, d.DT, 'soc_text'))  % 100000) / 100000.0 AS U_TEXT
  FROM BABY_MART_DEMO.CURATED.DIM_STORE s CROSS JOIN days d
  WHERE d.DT <= CMP_AS_OF()
), social AS (
  SELECT 'SOC-' || STORE_CODE || '-' || TO_CHAR(DT, 'YYYYMMDD') AS VOICE_ID, 'SOCIAL' AS SOURCE, DT, NULL::NUMBER AS CUSTOMER_KEY,
         STORE_CODE, SUBURB, STATE, NULL::NUMBER AS PRODUCT_KEY,
         IFF(STATE = 'NSW' AND DT >= '2026-04-28' AND U_STORY < 0.70, 'Rascal + Friends', NULL) AS BRAND_NAME,
         IFF(STATE = 'NSW' AND DT >= '2026-04-28' AND U_STORY < 0.70, 'Nappies & Wipes', NULL) AS CATEGORY, NULL AS CLASS,
         CASE
           WHEN STATE = 'NSW' AND DT >= '2026-04-28' AND U_STORY < 0.70 THEN 'RF_SHORT'
           WHEN STATE = 'WA' AND DT BETWEEN '2026-03-01' AND '2026-04-30' AND U_STORY < 0.30 THEN 'WA_DELIVERY'
           WHEN DT BETWEEN '2026-03-09' AND '2026-03-15' AND U_STORY < 0.40 THEN 'APP_OUTAGE'
           WHEN U_STORY > 0.93 THEN 'FITTING'
         END AS STORYLINE,
         U_POL, U_THEME, U_TEXT
  FROM store_days
  WHERE U_PICK < IFF(STATE = 'NSW' AND DT >= '2026-04-28', 0.65, 0.07)
     OR (STATE = 'WA' AND DT BETWEEN '2026-03-01' AND '2026-04-30' AND U_PICK < 0.20)
     OR (DT BETWEEN '2026-03-09' AND '2026-03-15' AND U_PICK < 0.25)
), upgrade AS (
  -- A quarter of the capsule-to-convertible cohort got in touch in the last 75 days.
  SELECT 'CARE-UP-' || f.CUSTOMER_KEY AS VOICE_ID, IFF(ABS(HASH(f.CUSTOMER_KEY, 'up_src')) % 3 = 0, 'SURVEY', 'CARE') AS SOURCE,
         DATEADD('day', -(ABS(HASH(f.CUSTOMER_KEY, 'up_day')) % 75), CMP_AS_OF()) AS DT, f.CUSTOMER_KEY,
         f.HOME_STORE_CODE AS STORE_CODE, REPLACE(f.HOME_STORE_NAME, 'Baby Mart ', '') AS SUBURB, f.HOME_STATE AS STATE,
         NULL::NUMBER AS PRODUCT_KEY, NULL AS BRAND_NAME, 'Car Seats' AS CATEGORY, 'Convertible (0-4y)' AS CLASS,
         'UPGRADE_ASK' AS STORYLINE,
         (ABS(HASH(f.CUSTOMER_KEY, 'up_pol'))  % 100000) / 100000.0 AS U_POL,
         (ABS(HASH(f.CUSTOMER_KEY, 'up_thm'))  % 100000) / 100000.0 AS U_THEME,
         (ABS(HASH(f.CUSTOMER_KEY, 'up_txt'))  % 100000) / 100000.0 AS U_TEXT
  FROM CUSTOMER_FEATURES f
  WHERE f.CAR_SEAT_LAST_CLASS = 'Capsule (0-6m)' AND f.CAR_SEAT_DUE_STATUS = 'DUE_NOW'
    AND (ABS(HASH(f.CUSTOMER_KEY, 'up_pick')) % 100) < 25
), gold AS (
  -- GOLD_PRICE, at a scale the early-access campaign can be measured against: one
  -- in eleven recently active Gold and Platinum members complained about price
  -- between February and the end of April 2026. Mostly by email to customer care:
  -- as survey answers they would sink national NPS for three months and bury the
  -- NSW stock problem in April under a pricing one.
  SELECT 'GOLD-' || f.CUSTOMER_KEY AS VOICE_ID, IFF(ABS(HASH(f.CUSTOMER_KEY, 'gp_src')) % 8 = 0, 'SURVEY', 'CARE') AS SOURCE,
         DATEADD('day', ABS(HASH(f.CUSTOMER_KEY, 'gp_day')) % 87, '2026-02-01'::DATE) AS DT, f.CUSTOMER_KEY,
         f.HOME_STORE_CODE AS STORE_CODE, REPLACE(f.HOME_STORE_NAME, 'Baby Mart ', '') AS SUBURB, f.HOME_STATE AS STATE,
         NULL::NUMBER AS PRODUCT_KEY, NULL AS BRAND_NAME, f.TOP_CATEGORY AS CATEGORY, NULL AS CLASS,
         'GOLD_PRICE' AS STORYLINE,
         (ABS(HASH(f.CUSTOMER_KEY, 'gp_pol')) % 100000) / 100000.0 AS U_POL,
         (ABS(HASH(f.CUSTOMER_KEY, 'gp_thm')) % 100000) / 100000.0 AS U_THEME,
         (ABS(HASH(f.CUSTOMER_KEY, 'gp_txt')) % 100000) / 100000.0 AS U_TEXT
  FROM CUSTOMER_FEATURES f
  WHERE f.LOYALTY_TIER IN ('Gold', 'Platinum') AND f.LAST_PURCHASE_DATE >= '2025-11-01'
    AND (ABS(HASH(f.CUSTOMER_KEY, 'gp_pick')) % 1000) < 90
)
SELECT x.*,
       COALESCE(DECODE(x.STORYLINE, 'RF_SHORT', 'NEG', 'WA_DELIVERY', 'NEG', 'APP_OUTAGE', 'NEG', 'FITTING', 'POS', 'GOLD_PRICE', 'NEG',
                                    'UPGRADE_ASK', IFF(x.U_POL < 0.35, 'POS', 'NEU')),
                CASE WHEN x.U_POL < 0.50 THEN 'POS' WHEN x.U_POL < 0.62 THEN 'NEU' WHEN x.U_POL < 0.68 THEN 'MIXED' ELSE 'NEG' END) AS POLARITY,
       COALESCE(DECODE(x.STORYLINE, 'RF_SHORT', 'Out of stock', 'WA_DELIVERY', 'Delivery and click and collect',
                                    'APP_OUTAGE', 'App and website', 'FITTING', 'Staff and expert advice', 'GOLD_PRICE', 'Price and value',
                                    'UPGRADE_ASK', IFF(x.U_POL < 0.35 OR x.U_THEME < 0.4, 'Staff and expert advice', 'Range and choice')), '') AS STORY_THEME
FROM (SELECT * FROM social UNION ALL SELECT * FROM upgrade UNION ALL SELECT * FROM gold) x;

-- Assemble: pick the theme, a core phrase, and the clauses; fill the slots.
INSERT INTO VOICE_ITEM
WITH base AS (
  SELECT IFF(v.SOURCE = 'SURVEY', 'SRV-', IFF(v.SOURCE = 'REVIEW', 'REV-', 'CARE-')) || v.LK AS VOICE_ID,
         v.SOURCE, IFF(v.SOURCE = 'CARE', DATEADD('day', 1 + ABS(HASH(v.LK, 'care_lag')) % 9, v.DT), v.DT) AS DT,
         v.CUSTOMER_KEY, v.STORE_CODE, v.SUBURB, v.STATE, v.PRODUCT_KEY, v.BRAND_NAME, v.CATEGORY, v.CLASS,
         v.STORYLINE, v.POLARITY, v.STORY_THEME, v.U_THEME, v.U_TEXT, NULL AS PLATFORM
  FROM VOICE_STAGE v
  UNION ALL
  SELECT x.VOICE_ID, x.SOURCE, x.DT, x.CUSTOMER_KEY, x.STORE_CODE, x.SUBURB, x.STATE, x.PRODUCT_KEY, x.BRAND_NAME, x.CATEGORY, x.CLASS,
         x.STORYLINE, x.POLARITY, x.STORY_THEME, x.U_THEME, x.U_TEXT,
         IFF(x.SOURCE = 'SOCIAL', DECODE(ABS(HASH(x.VOICE_ID, 'plat')) % 4, 0, 'Instagram', 1, 'Facebook', 2, 'TikTok', 'Google Reviews'), NULL)
  FROM VOICE_EXTRA x
  WHERE x.DT <= CMP_AS_OF()
), themed AS (
  SELECT b.*, COALESCE(NULLIF(b.STORY_THEME, ''), m.THEME) AS THEME
  FROM base b
  LEFT JOIN VOICE_THEME_MIX m ON NULLIF(b.STORY_THEME, '') IS NULL AND m.SOURCE = b.SOURCE AND m.POLARITY = b.POLARITY
   AND b.U_THEME >= m.LO AND b.U_THEME < m.HI
), worded AS (
  -- A score-only survey has no text: most neutral answers, some positive ones.
  SELECT t.*,
         t.SOURCE = 'SURVEY' AND t.STORYLINE IS NULL
           AND ((t.POLARITY = 'NEU' AND t.U_TEXT < 0.55) OR (t.POLARITY = 'POS' AND t.U_TEXT < 0.30) OR (t.POLARITY = 'NEG' AND t.U_TEXT < 0.08)) AS SCORE_ONLY
  FROM themed t
), phrased AS (
  SELECT w.*, ph.PHRASE_ID, ph.TEXT AS CORE
  FROM worded w
  JOIN VOICE_PHRASE ph
    ON EQUAL_NULL(ph.STORYLINE, w.STORYLINE) AND ph.THEME = w.THEME AND ph.POLARITY = w.POLARITY
   AND (ph.CATEGORY = 'ANY' OR ph.CATEGORY = w.CATEGORY)
   AND CONTAINS(ph.SOURCES, w.SOURCE)
   AND (NOT CONTAINS(ph.TEXT, '{brand}') OR w.BRAND_NAME IS NOT NULL)
   AND (NOT CONTAINS(ph.TEXT, '{store}') OR w.SUBURB IS NOT NULL)
   AND (NOT CONTAINS(ph.TEXT, '{class}') OR w.CLASS IS NOT NULL)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY w.VOICE_ID ORDER BY ABS(HASH(w.VOICE_ID, ph.PHRASE_ID, 'phr'))) = 1
), staged AS (
  -- The child stage the clause may state: the customer's stage, wound back to the
  -- item's date, or EXPECTING for an Expecting-segment customer with no signal.
  SELECT p.*,
         CASE
           WHEN f.MULTI_CHILD_OR_GIFT THEN 'MULTIPLE'
           WHEN f.EST_CHILD_AGE_M IS NULL THEN IFF(f.SEGMENT_NAME = 'Expecting', 'EXPECTING', NULL)
           WHEN f.EST_CHILD_AGE_M - DATEDIFF('day', p.DT, CMP_AS_OF()) / 30.44 < 0  THEN 'EXPECTING'
           WHEN f.EST_CHILD_AGE_M - DATEDIFF('day', p.DT, CMP_AS_OF()) / 30.44 < 3  THEN 'NEWBORN_0_3M'
           WHEN f.EST_CHILD_AGE_M - DATEDIFF('day', p.DT, CMP_AS_OF()) / 30.44 < 12 THEN 'INFANT_3_12M'
           WHEN f.EST_CHILD_AGE_M - DATEDIFF('day', p.DT, CMP_AS_OF()) / 30.44 < 36 THEN 'TODDLER_1_3Y'
           WHEN f.EST_CHILD_AGE_M - DATEDIFF('day', p.DT, CMP_AS_OF()) / 30.44 < 60 THEN 'PRESCHOOL_3_5Y'
           ELSE 'SCHOOL_5_PLUS'
         END AS STAGE_AT_DATE,
         CASE
           WHEN p.STORYLINE = 'UPGRADE_ASK' THEN 'CAR_SEAT_UPGRADE'
           WHEN f.CAR_SEAT_NEXT_CLASS = 'Convertible (0-4y)' THEN 'CAR_SEAT_UPGRADE'
           WHEN f.FEEDING_NEXT_CLASS = 'Highchairs' THEN 'FEEDING'
           WHEN f.NAPPY_NEXT_CLASS IN ('Toddler Nappies', 'Pull-Ups', 'Crawler Nappies') THEN 'NAPPY_STAGE_CHANGE'
           WHEN f.PRAM_NO_CAR_SEAT THEN 'PRAM_OR_STROLLER'
           ELSE 'NURSERY_OR_CLOTHING'
         END AS LIKELY_INTENT,
         (ABS(HASH(p.VOICE_ID, 'child'))  % 100000) / 100000.0 AS U_CHILD,
         (ABS(HASH(p.VOICE_ID, 'intent')) % 100000) / 100000.0 AS U_INTENT
  FROM phrased p
  LEFT JOIN CUSTOMER_FEATURES f ON f.CUSTOMER_KEY = p.CUSTOMER_KEY
), counts AS (
  SELECT KIND, CODE, COUNT(*) AS N FROM VOICE_CLAUSE GROUP BY KIND, CODE
), claused AS (
  SELECT s.*,
         IFF(s.STAGE_AT_DATE IS NOT NULL AND s.SOURCE IN ('SURVEY', 'REVIEW', 'CARE') AND s.U_CHILD < IFF(s.STORYLINE = 'UPGRADE_ASK', 0.50, 0.20),
             s.STAGE_AT_DATE, NULL) AS CHILD_CODE,
         IFF(s.SOURCE IN ('SURVEY', 'REVIEW', 'CARE') AND (s.STORYLINE = 'UPGRADE_ASK' AND s.U_INTENT < 0.60 OR s.U_INTENT < 0.07),
             s.LIKELY_INTENT, NULL) AS INTENT_CODE
  FROM staged s
), numbered AS (
  SELECT c.*,
         1 + ABS(HASH(c.VOICE_ID, 'cc')) % NULLIF(nc.N, 0) AS CHILD_NO,
         1 + ABS(HASH(c.VOICE_ID, 'ic')) % NULLIF(ni.N, 0) AS INTENT_NO
  FROM claused c
  LEFT JOIN counts nc ON nc.KIND = 'CHILD'  AND nc.CODE = c.CHILD_CODE
  LEFT JOIN counts ni ON ni.KIND = 'INTENT' AND ni.CODE = c.INTENT_CODE
), texted AS (
  SELECT n.*,
         IFF(n.SCORE_ONLY, NULL,
             TRIM(REPLACE(REPLACE(REPLACE(n.CORE, '{brand}', COALESCE(n.BRAND_NAME, '')), '{store}', COALESCE(n.SUBURB, '')),
                          '{class}', LOWER(COALESCE(n.CLASS, '')))
                  || COALESCE(' ' || cc.TEXT, '') || COALESCE(' ' || ic.TEXT, ''))) AS TXT
  FROM numbered n
  LEFT JOIN VOICE_CLAUSE cc ON cc.KIND = 'CHILD'  AND cc.CODE = n.CHILD_CODE  AND cc.CLAUSE_NO = n.CHILD_NO
  LEFT JOIN VOICE_CLAUSE ic ON ic.KIND = 'INTENT' AND ic.CODE = n.INTENT_CODE AND ic.CLAUSE_NO = n.INTENT_NO
)
SELECT c.VOICE_ID, c.SOURCE, c.DT, c.CUSTOMER_KEY, c.STORE_CODE, c.PRODUCT_KEY, c.BRAND_NAME, c.CATEGORY, c.CLASS, NULL, c.PLATFORM,
       IFF(c.SOURCE = 'SURVEY',
           CASE c.POLARITY WHEN 'POS' THEN 9 + ABS(HASH(c.VOICE_ID, 'nps')) % 2 WHEN 'NEU' THEN 7 + ABS(HASH(c.VOICE_ID, 'nps')) % 2
                           WHEN 'MIXED' THEN 6 + ABS(HASH(c.VOICE_ID, 'nps')) % 3 ELSE ABS(HASH(c.VOICE_ID, 'nps')) % 7 END, NULL),
       CASE WHEN c.SOURCE = 'REVIEW' OR c.PLATFORM = 'Google Reviews' THEN
         CASE c.POLARITY WHEN 'POS' THEN IFF(ABS(HASH(c.VOICE_ID, 'star')) % 5 = 0, 4, 5) WHEN 'NEU' THEN 3 + ABS(HASH(c.VOICE_ID, 'star')) % 2
                         WHEN 'MIXED' THEN 3 ELSE 1 + ABS(HASH(c.VOICE_ID, 'star')) % 2 END END,
       c.TXT, IFF(c.TXT IS NULL, NULL, SHA2(c.TXT, 256)),
       c.THEME, c.POLARITY, c.CHILD_CODE, c.INTENT_CODE, c.STORYLINE, 'SYNTHETIC'
FROM texted c
-- A care email lands a few days after the purchase; none may postdate the clock.
WHERE c.DT <= CMP_AS_OF();

-- A score-only survey carries no stage or intent: there is no text to state them.
UPDATE VOICE_ITEM SET TRUE_STAGE = NULL, TRUE_INTENT = NULL WHERE VOICE_TEXT IS NULL;

-- ---------- 3. Distinct texts: what the enrichment reads ----------
CREATE OR REPLACE TABLE VOICE_TEXT (
  TEXT_HASH      VARCHAR PRIMARY KEY,
  VOICE_TEXT     VARCHAR NOT NULL,
  TRUE_THEME     VARCHAR,
  TRUE_POLARITY  VARCHAR,
  TRUE_STAGE     VARCHAR,
  TRUE_INTENT    VARCHAR,
  ITEMS          NUMBER,
  FIRST_SEEN     DATE
) COMMENT = 'One row per distinct voice text. AI enrichment runs once per row here, not once per item.';

MERGE INTO VOICE_TEXT t
USING (
  SELECT TEXT_HASH, ANY_VALUE(VOICE_TEXT) AS VOICE_TEXT, ANY_VALUE(TRUE_THEME) AS TRUE_THEME, ANY_VALUE(TRUE_POLARITY) AS TRUE_POLARITY,
         ANY_VALUE(TRUE_STAGE) AS TRUE_STAGE, ANY_VALUE(TRUE_INTENT) AS TRUE_INTENT, COUNT(*) AS ITEMS, MIN(EVENT_DATE) AS FIRST_SEEN
  FROM VOICE_ITEM WHERE TEXT_HASH IS NOT NULL GROUP BY TEXT_HASH
) s ON t.TEXT_HASH = s.TEXT_HASH
WHEN MATCHED THEN UPDATE SET ITEMS = s.ITEMS, FIRST_SEEN = s.FIRST_SEEN
WHEN NOT MATCHED THEN INSERT VALUES (s.TEXT_HASH, s.VOICE_TEXT, s.TRUE_THEME, s.TRUE_POLARITY, s.TRUE_STAGE, s.TRUE_INTENT, s.ITEMS, s.FIRST_SEEN);
