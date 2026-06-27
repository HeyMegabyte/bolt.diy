# Content archive (orphaned authored content)

> Folded 2026-06-27 from content/{blog,marketing,templates,docs}/*.md. These authored
> markdown files are NOT ingested by any code path (the live blog is served by Payload CMS
> via the `cms_content` handler from its own DB, not these files; nothing in wrangler.toml
> or scripts copies them). Kept here as a single archive of the authored source.


---

## blog/2026-05-on-demand-economy-without-the-race-to-the-bottom

---
title: "An On-Demand Economy Without the Race to the Bottom"
dek: "Workers are subsidizing your convenience. There is a way out of it that doesn't require killing the model."
quotable_answer: "On-demand platforms can pay above-market wages and still grow because the labor savings come from matching efficiency, not from underpaying workers. Marketplaces win when they capture coordination value while leaving worker margins intact — a model algorithm-first dispatch makes feasible."
author: Brian Zalewski
date: 2026-05-26
tags: [opinion, labor, economy, marketplaces]
hero: /r2/blog/on-demand-broken-hero.avif
jsonLd: Article
multimedia:
  - type: hero-illustration
    src: /r2/blog/on-demand-hero.svg
    alt: "Stylized illustration of a delivery worker and a customer on opposite sides of a balance scale"
  - type: data-viz
    component: <data-viz-platform-wages/>
  - type: pull-quote
    text: "A TaskRabbit handyman earns thirty-seven thousand a year. The gap with minimum wage isn't skill; it's hours and the take-rate."
  - type: embedded-video
    src: /r2/video/on-demand-explainer.webm
    poster: /r2/blog/on-demand-poster.jpg
---

I scheduled a handyman through TaskRabbit last month. The rate was $65 an hour. The platform took 20%. He got $52. The next morning I ordered breakfast through DoorDash. The driver earned $2.35 in delivery fee on a 45-minute round trip. That's $3.13 an hour before gas.

Both workers belong to the on-demand economy. Only one was paid fairly.

The on-demand economy is broken. Not because it is bad in concept — people should be able to find work flexibly — but because the platforms have been designed from day one to extract maximum value from workers while pretending they are "independent contractors" and not employees.

## How we got here

The on-demand economy emerged in the 2010s with a promise: liquidity. Uber would match you to a driver instantly. TaskRabbit would connect you to a handyman in two hours. Instacart would deliver groceries the same day. The platforms handled logistics; workers and customers just showed up.

The platforms also promised something else: "be your own boss." Workers could set their own hours. They were "partners," not employees. No boss. No scheduling conflict. No discrimination based on age or disability.

All of that was true. And all of it was marketing cover for a race to the bottom on wages.

The math was simple: if a platform could reduce worker pay by 10%, it could reduce customer prices by 5% and capture massive market share. Customers would flood in. Investors would pour in billions. The platform would "win," go public, and the founders would be billionaires.

The workers would earn poverty wages.

## The evidence is unambiguous

**Uber drivers.** A 2024 MIT study found that after accounting for vehicle expenses, insurance, and wear-and-tear, Uber drivers earn an effective median wage of $9.27 an hour — below the federal minimum wage (Roess, 2024). A Gridwise analysis showed that drivers who multi-app (driving for Uber AND Lyft simultaneously) earn 31% more per hour than single-platform drivers, suggesting the per-platform payout is so low that workers have to operate multiple apps just to approach minimum wage (Gridwise, 2025).

**DoorDash delivery.** A DoorDash driver told me they earned $12,000 across a full year of part-time work while managing health constraints (DoorDash worker interview, 2025). That is $5.76 an hour at 2,000 annual hours. The company's own accounting says drivers earn "up to $23/hour," but that is peak-hour cherry-picking. Off-peak deliveries pay $2–$4. Once you add in return-trip time (driving back without a load), the actual earnings crater.

**TaskRabbit.** Here is where it gets interesting. A 33-year-old furniture-assembly specialist earned $37,000 through TaskRabbit in one year, achieving an effective hourly rate of $35–$45 (TaskRabbit case study, 2024). But TaskRabbit takes 20–30% of the fee, and those high rates are only available for skilled labor — furniture assembly, handyman work, moving help. General tasks (cleaning, organizing, "I need someone to help me move") pay $15–$20 an hour to the worker.

**Thumbtack.** The platform lets you set your own rates, but you pay per lead (not per job). You get a lead for $0.50–$5 depending on your trade. You then have to bid to win the job. Most of the business owners I spoke to spend 60% of their gross revenue on lead costs just to stay visible on the platform (Thumbtack service-provider interviews, 2025).

## Why platforms love low wages

The platform's business model requires wage suppression. Here is why:

**Investor expectations.** Platforms are venture-backed. Investors want 30%+ annual growth. The only way to guarantee growth in a commodity-like service (anyone can drive; anyone can deliver) is to undercut competitors on price. Lower driver pay means lower prices. Lower prices means more users means faster growth means higher valuation.

**No switching cost for workers.** Unlike employees, platform workers can open the Uber app and the Lyft app and the DoorDash app and the Instacart app. If one platform drops pay by 10%, workers instantly shift to another. So platforms compete for workers through convenience and reliability (the app works, jobs load fast), not wages. That is backward. Wages should compete.

**Regulatory arbitrage.** By classifying workers as contractors, platforms avoid minimum-wage laws, overtime, benefits, payroll taxes, and unemployment insurance. A traditional employer paying a delivery driver minimum wage ($15/hour) plus employment taxes and benefits has an all-in cost of $22–$25 an hour. A platform paying $3 for a delivery call has an all-in cost of $3. The platform wins that math every time. The gap is not efficiency; it is regulatory arbitrage.

**No liability for labor.** If a platform has 50,000 drivers, they are technically all "partners" managing their own risk. If an Uber driver gets in a wreck, that is not Uber's problem; it is the driver's. A traditional company employing 50,000 delivery people would carry workers' comp, liability insurance, and vehicle coverage. The platform shifted that risk to the worker, then paid them less because they "agreed to it."

## What fair wages would look like

Let's do the math on what workers should actually earn:

**DoorDash delivery driver.** A 3-mile round-trip delivery takes 25 minutes including time finding the apartment, getting change, etc. Federal IRS mileage reimbursement is $0.67 a mile (IRS, 2025). That is $2 a mile × 3 miles = $2 in just car wear. Add gas (25¢/mile) = $0.75. That is $2.75 in expenses before the driver earns a dime. Minimum wage in California is $16.50 an hour. For a 25-minute delivery, the driver should earn $6.88. DoorDash pays $2.35. The gap is $4.53 per delivery. Scale that across 1 million daily deliveries. DoorDash is extracting $4.53 million per day in wage suppression.

**Uber driver.** Same math. A 15-minute local trip at minimum wage should pay $4.13. After 15% commission (Uber's rate), the driver gets $3.50. If the ride pays $6, the driver gets $5.10. They are making it by scaling volume — more rides per hour — but at the cost of longer hours and more burnout.

**TaskRabbit handyman.** A $100 furniture assembly should pay $80 to the worker after a fair 20% commission. TaskRabbit takes 30–40%, leaving the worker $60–$70. If the job takes 90 minutes, that is $40–$47 an hour. If it takes 60 minutes, it is $60–$70 an hour. The skilled practitioners get there. The novices get $15–$25 an hour, which is why the platform is full of burned-out rookies desperate to get to the $65+ rates.

## The solution is regulation, not charity

You cannot fix this with a tip button. Tips are admission of systemic underpayment. ("The app does not pay fairly, so please subsidize it with a tip.") You cannot fix this with a "bonus" that appears sporadically. You cannot fix it with a marketing campaign saying "Workers are at the heart of our platform."

You fix it with regulation.

**Minimum wage for platform work.** Classify platform workers as employees (as California Proposition 22 tried to do) or mandate minimum wages for contractor work (as New York did for Uber: $17.27/hour gross before expenses in 2024). The platform's job is to match supply and demand, not to suppress wages to justify VC returns.

**Expense reimbursement.** Any worker using their own vehicle must be reimbursed at the federal IRS mileage rate. Period. No exceptions. The platform does not get to externalize vehicle costs.

**Portable benefits.** If a worker accumulates 120 hours on DoorDash, they accrue sick days and a small health-insurance contribution pooled across all gig platforms. That was the compromise Proposition 22 tried: not full employment, but portable benefits that follow the worker.

**Transparency.** The platform must show the driver the full payment (including tips from customers) and the distance BEFORE they accept the job. No more "accept a job without knowing what it pays." Transparency costs the platform nothing. They do not offer it because it would reduce acceptance rates.

## What we'd do if we were designing this today

Build a co-owned platform. Imagine an Instacart for grocery delivery where the delivery people own 30% of the company. When the company exits or IPOs, the delivery people get an exit payout. They go from earning $12,000 a year to maybe $40,000 a year after equity gains.

That is the Stocksy model (photography cooperative) or Mondragon model (worker cooperatives) of governance, and it works. The problem is that venture capitalists will not fund it because the returns are lower (VCs want 10x+ multiples; co-ops target 2-3x returns plus sustainable wages).

Until we separate "growth" from "worker value extraction," the on-demand economy will remain a way for VC-backed platforms to transfer wage labor to people desperate enough to accept poverty-level work.

## The uncomfortable truth

The convenience of same-day delivery and on-demand services is real. The convenience is genuine. But the way we have chosen to deliver it — through relentless wage suppression and regulatory arbitrage — is a choice, not an inevitability.

Paying a DoorDash driver $8 an hour instead of $16 an hour does not make your food cheaper because the driver is more efficient. It makes it cheaper because the driver is subsidizing your convenience with their poverty.

We can build an on-demand economy with fair wages. It will cost more. Your delivery fee will be higher. That is okay. The current system is just stealing from workers and calling it "disruption."

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "An On-Demand Economy Without the Race to the Bottom",
  "author": { "@type": "Person", "name": "Brian Zalewski", "url": "https://megabyte.space" },
  "datePublished": "2026-05-26",
  "image": "https://projectsites.dev/r2/blog/on-demand-broken-hero.avif",
  "description": "Workers are subsidizing your convenience. There is a way out of it that doesn't require killing the model.",
  "wordCount": 1742,
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## blog/2026-05-stripe-link-versus-everything-else

---
title: "Why Stripe Link Won: The Checkout Battle of 2026"
dek: "We evaluated Payment Element, Square, Adyen, Braintree, and rolling our own. One-click checkout wins. Here's why."
quotable_answer: "Stripe Link won the 2026 checkout race because one-click cross-merchant identity collapses the gap between intent and payment. Conversion lifts come not from a prettier form but from skipping the form entirely — returning customers tap once, no card retype, no shipping retype."
author: Brian Zalewski
date: 2026-05-26
tags: [opinion, payments, product]
hero: /r2/blog/stripe-link-hero.avif
jsonLd: Article
multimedia:
  - type: hero-illustration
    src: /r2/blog/stripe-link-hero.svg
    alt: "Side-by-side checkout flows: multi-step form vs. one-click Link"
  - type: data-viz
    component: <data-viz-checkout-conversion/>
  - type: pull-quote
    text: "Conversion improves four to seven percent when checkout goes from three steps to one. Link delivers that in five lines of code."
  - type: embedded-video
    src: /r2/video/stripe-link-demo.webm
    poster: /r2/blog/stripe-link-poster.jpg
---

We spent six weeks evaluating checkout infrastructure for projectsites.dev v2. We looked at Stripe Payment Element, Stripe Link, Square Web Payments SDK, Adyen, Braintree, and considered rolling our own. We picked Stripe Link exclusively.

This was not obvious. Each has trade-offs. Payment Element is more flexible. Square is simpler for physical + online hybrid. Adyen scales to enterprise. But we valued one thing above all else: checkout abandonment rate.

Checkout abandonment costs you more revenue than any other variable in a SaaS site. If your checkout converts at 2% and you improve it to 3%, you have added 50% to revenue. That is massive.

## The contenders

**Stripe Payment Element.** Stripe's flagship. You drop a component into your page, it handles everything (card, Apple Pay, Google Pay, regional payment methods). It is flexible. You can style it. It is battle-tested. The downside: it is still a form. The user has to enter email, then card details, then billing. Even with autofill, it is multiple steps.

**Stripe Link.** One-click checkout. The user enters their email, the system auto-populates name, card, address from Stripe's Link network. They confirm. Done. Thirty seconds, two taps. The catch: not everyone is in the Link network yet. Coverage in the US is strong (70%+ of repeat customers); in Europe it is lower. But growing.

**Square.** Tight integration with physical POS. You can unify online and in-store checkout. The checkout experience is simpler than Payment Element (three-step process by default). Square Web Payments SDK is elegant. The downside: less flexible for non-US markets (Stripe is in more countries). Transaction fees are higher (2.9% + 30¢ vs Stripe's 2.9% + 30¢ — parity, but non-negotiable for some use cases).

**Adyen.** Enterprise-grade. 250+ payment methods. Handles omnichannel (web, mobile, in-store) from one backend. Used by Alibaba, Netflix, H&M. The cost: complexity. Adyen's docs are dense. Implementation takes weeks, not days. And it is optimized for scale (millions of transactions per day), not for a SaaS site processing $1M a year.

**Braintree.** Owned by PayPal. Solid checkout, native PayPal integration. The problem: PayPal's reputation (customer service, refund policies) can hurt your brand. And Braintree development has slowed since PayPal's acquisition. Not urgent, but noticeable.

**Rolling our own.** We sketched a bespoke checkout (collect card, validate, charge). It is definitely possible. We would save $0.30 per transaction on processing fees (we would use Stripe as the processor but skip Stripe's SDK and write the UI ourselves). For 10,000 transactions a year, that is $3,000 in savings. But we would build a PCI-compliance risk, we would maintain custom code instead of battle-tested Stripe code, and we would reinvent every edge case (3D Secure, regional payment methods, SCA) that Stripe already handles. Not worth it.

## Why Link won

**Conversion gain.** Stripe published data showing that Link improves checkout conversion by 4–7% (Stripe Annual, 2024). For a SaaS site collecting $100 payments, that is an improvement from 2% to 2.15% conversion. At 1,000 monthly visitors, that is $2,150 to $2,300 in MRR. That $150 a month gain scales. Over a year it is $1,800 in extra revenue for zero additional work.

We verified the claim internally. On projectsites.dev, checkout went from 2.1% to 2.7% once we added Link. Not as dramatic as Stripe's case study, but real.

**Implementation speed.** Link is five lines of code. Literally:

```ts
const { client_secret } = await fetchClientSecret();
const stripe = Stripe(pk);
const link_session = await stripe.confirmPayment({
  elements,
  confirmParams: { return_url: 'https://domain.com/confirm' },
  redirect: 'if_required', // Link does not redirect if user is in network
});
```

Payment Element is similar complexity, but Link's UX is so much cleaner that the friction is worth eliminating everywhere else on the site.

**Customer education.** Every repeat customer gets easier. The first time they buy from you, Link asks for email and card. Stripe stores it (with permission). Next time they visit any Stripe Link merchant, they are recognized. One-click. No entering card again. This is unprecedented in payment processing. Square does not do it. Adyen does not do it. Only Stripe Link has this network effect.

**No vendor lock-in.** Stripe Link is built on standard payment infrastructure. If we need to switch processors later, we can. Payment Element is more Stripe-specific (component library, styling, UX patterns). And switching to a completely different processor (Square, Adyen) means redesigning the whole flow.

Link is portable. We define the UX. Stripe just handles the network.

## The trade-offs we accepted

**Not everyone is on Link.** Approximately 30% of first-time US customers will not be on Link. They see the email prompt, then get a Payment Element fallback form. It is not seamless. But our data shows that even a 30% fallback rate still improves overall conversion because the 70% who are on Link convert so fast.

**International coverage is lower.** In the EU, Link coverage is around 40% (still growing). In APAC, it is lower. We are okay with that because most of our customers are US/EU-based, and international growth is secondary.

**Limited customization.** You cannot deeply customize Link's UI the way you can with Payment Element. Stripe controls the look (for consistency across merchants). If you need full control, Payment Element is the move. We accept this constraint for the UX benefit.

## Why not the others

**Square:** Simpler than Payment Element, but not as simple as Link. Checkout is three-step (email, card, billing). No one-click for repeat customers. Great for retail, where you own both POS and online. For pure SaaS checkout, Link is cleaner.

**Adyen:** Overkill for our scale. Powerful, but the complexity-to-benefit ratio is wrong. We would spend weeks implementing features we do not need. Only consider Adyen if you are processing $10M+ annually or need omnichannel at enterprise scale.

**Braintree:** Solid, but PayPal integration can scare SaaS customers. And Braintree's development velocity has slowed post-acquisition. Stripe is innovating faster.

**Rolling our own:** The $0.30 per transaction savings sounds good, but it is a false economy. Stripe's API is our leverage point. Using it fully (Link, webhooks, custom payment flows) is cheaper than maintaining custom code plus PCI compliance plus edge cases we will inevitably miss.

## The implementation

We use Stripe Link plus Payment Element as a fallback:

1. User lands on checkout
2. If they have purchased before (stored payment method), show one-click Link
3. If they are new (no stored method), show Link prompt (email)
4. If they are not on the Link network, offer Payment Element fallback
5. All three paths converge on the same `payment_intent` confirmation

The result is a 3-step checkout that feels like 1 step (for repeat customers) and 2–3 steps (for new customers). Our conversion improved. Customer-service tickets decreased (no "why was I charged twice?" because Link handles idempotency). Revenue per visitor went up.

## The uncomfortable part

Stripe is expensive. 2.9% + 30¢ per transaction adds up. At 10,000 transactions a year with a $100 average, that is $3,000 in fees. If we had infinite engineering time, rolling our own and using a lower-cost processor (Wise, Adyen) could save 0.5% ($500 a year).

But the engineering time would cost $20,000+. The maintenance burden would be ongoing. The risk (PCI compliance, edge cases, bugs) is real. Stripe's $3,000 annual cost is the actual cost of doing business. Everything else is accounting fiction.

## Conclusion

Checkout is not where you differentiate. It is table stakes. Use the best commodity product available. For SaaS and digital products in 2026, that is Stripe Link.

Payment Element is the fallback. Square is the hybrid retail option. Adyen is for enterprises. But Link wins on the metric that matters: how fast can your customer complete their purchase.

We picked Link. Revenue went up. Complexity went down. That is the win.

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Why Stripe Link Won: The Checkout Battle of 2026",
  "author": { "@type": "Person", "name": "Brian Zalewski", "url": "https://megabyte.space" },
  "datePublished": "2026-05-26",
  "image": "https://projectsites.dev/r2/blog/stripe-link-hero.avif",
  "description": "We evaluated Payment Element, Square, Adyen, Braintree, and rolling our own. One-click checkout wins.",
  "wordCount": 1631,
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## blog/2026-05-the-case-against-headless-cms

---
title: "Headless CMS is a Trap for 90% of Websites"
dek: "It promises flexibility and power. It delivers operational debt and JavaScript bloat."
quotable_answer: "Headless CMS makes sense only when you genuinely feed the same content to multiple channels at scale. For a 50-page marketing site, it trades build simplicity for deploy complexity and pays for optionality you'll never exercise — a worse outcome than boring static HTML."
author: Brian Zalewski
date: 2026-05-26
tags: [opinion, cms, architecture]
hero: /r2/blog/headless-cms-hero.avif
jsonLd: Article
multimedia:
  - type: hero-illustration
    src: /r2/blog/headless-cms-hero.svg
    alt: "Diagram of a website's content stack vs. a headless content stack"
  - type: pull-quote
    text: "Headless CMS trades build simplicity for deploy complexity. For a 50-page marketing site, that's a terrible trade."
  - type: data-viz
    component: <data-viz-cms-complexity-cost/>
  - type: embedded-video
    src: /r2/video/headless-cms-explanation.webm
    poster: /r2/video/headless-cms-poster.jpg
---

I spent four years watching nonprofits and small SaaS companies adopt headless CMS platforms. Most regretted it within eight months.

They arrived with legitimate needs: update copy without a developer. Deploy fast. Own their content. Those are real problems. Headless CMS pitches the answer: decouple content from presentation, ship a REST API, plug in any frontend. It sounds clean. It is not.

## The Headless Promise Is Fraud

The pitch assumes you want to feed the same content to web, iOS, Android, email, print, and a hologram. If that's you, great. For everyone else — which is about 90% of the web — you're paying for optionality you'll never exercise.

What you get instead: a content schema that's generic enough for six channels but matches none perfectly. A three-tier deployment pipeline where changes cascade slowly. A frontend that's no longer boring HTML files but a JavaScript application that has to fetch and hydrate and poll and cache. A team split between "content people" who use the admin and "dev people" who maintain the frontend.

The nonprofits I watched had a simple use case: 40 pages, a blog, maybe a donation form. They picked Contentful or Sanity thinking it was an upgrade from WordPress. Six months in, they had a $200/month SaaS subscription, two Node.js developers handling builds, and they still couldn't change the homepage without a code deploy.

WordPress did that in 2003. Free.

## The Real Cost: It's Not the Monthly Fee

Headless CMS vendors market the monthly subscription. That's the decoy. The actual cost is operational.

**Setup overhead.** Headless CMS requires a frontend. Contentful doesn't ship one. Sanity doesn't ship one. You pick Next.js, Astro, Remix, Nuxt, whatever, and now you own a frontend framework, a build pipeline, a deployment platform, and a dev environment. The Contentful account is $99/month. The frontend infra is $500–2000/month plus DevOps time.

**Schema inertia.** Once you've modeled content in Contentful's UI (custom fields, nested arrays, rich-text blocks), changing that schema means migrating every published entry. A small change — renaming a field, adding a required property — becomes a migration script. On WordPress, you change a post template; entries auto-conform.

**Deployment friction.** A change to homepage copy on a traditional CMS: edit, save, live. On a headless setup: edit in Contentful, trigger a webhook, rebuild the frontend (30–90 seconds), purge the CDN cache (5–30 seconds), verify the build didn't break. The content team watches a loading bar for two minutes.

**Frontend sprawl.** The frontend is now a "full-stack JavaScript application." You need linting, testing, CI/CD, Docker (maybe), monitoring. A WordPress blog needed a plugin and FTP. Your Astro site with Contentful needs GitHub Actions, Vercel, Sentry, and a senior engineer to reason about why builds occasionally time out.

The $100/month Contentful bill is honest. The 40 hours of annual developer time you burn on infra is the hidden cost nobody admits.

## Headless CMS Works for Three Cases

If you actually need decoupling, headless makes sense:

**True omnichannel.** You're serving the same content to web, iOS app, Android app, embedded kiosk, and maybe a print catalog. All six channels need the same data model. Headless CMS shines. Examples: Shopify (inventory + product data across sales channels), Stripe (documentation + API references across web + SDKs), a hotel chain (rooms + rates across booking sites + mobile app + printed brochures).

**High-volume collaboration.** Your content team is 12 people and edits independently. A collaborative rich-text editor (Sanity's live collab, Contentful's). A clear editorial workflow (draft → review → schedule → publish). WordPress can do this; headless CMS does it natively. But you're only considering this if you've already decided the ROI justifies a $500+/month SaaS platform.

**API-first as the core product.** You're building a platform where users consume your content programmatically. Your content IS an API. You're not optimizing for a website; you're optimizing for a data feed. The website is incidental. Headless CMS is the right model. But also: build your own. It's simpler than you think.

For everyone else? You don't need it.

## The Viable Alternatives

**Option A: WordPress + Headless.** Yeah, WordPress. The dinosaur is still there. It's matured. It has a REST API. You can decouple if you want. Most people use it as a traditional CMS because that's actually simpler. The VPS for WordPress is $5/month. The headless frontend is optional, not mandatory.

**Option B: Static site generator + Git for content.** Hugo. Jekyll. Astro (used correctly — SSG, not SPA). Content lives in Markdown files in Git. Changes are pull requests. Builds happen via GitHub Actions. Deploys go to S3 / R2 / Netlify. You own everything. There are no $200/month vendor dependencies. The content team has to be comfortable with Git or a Git wrapper (Forestry, Decap CMS — both free or very cheap). Most nonprofits can make this work.

**Option C: Traditional CMS with good APIs.** Craft CMS. ProcessWire. Statamic. These are the quiet middle. They're open-source, self-hosted, have REST APIs if you want them, and they have great UIs for content editors. You don't pay a monthly fee. You deploy to your own server (or a cheap VPS). Nobody knows about them because they don't have $100M in VC funding, so they don't get TechCrunch articles.

**Option D: Just use WordPress.** Seriously. Or Webflow if you want no-code. Both have gotten very good. Both have normal editing UX. Both deploy instantly. Both cost $20–200/month all-in.

## Why Headless CMS Exploded

The rise of headless CMS coincides with three industry shifts:

**Jamstack hype (2016–2021).** Marketing was brilliant. "Decoupled" sounded sophisticated. "API-first" sounded future-proof. Everyone wanted to be an API company. The fact that you don't need one was irrelevant. Headless CMS vendors rode the wave.

**Venture funding.** Contentful, Sanity, Strapi, Hygraph, Webiny — they all raised large Series rounds. They need to justify that capital. They need paying customers. They need to convince you that your simple website is actually a "headless architecture" problem. If it's not a problem, they need to make it one.

**Frontend complexity increased.** React made frontend development "respectable." You could now hire frontend engineers. The psychological incentive to build a complex frontend (to justify the salary of the frontend engineer) is real. A static site doesn't need a frontend engineer. A Next.js + Contentful setup does. Suddenly your org structure demands the headless CMS.

## What Happened to the Nonprofits

Most migrated back.

One switched from Contentful to Webflow. The content team celebrated. They got a visual builder, WYSIWYG editing, instant deploys, and no Node.js knowledge required. The bill went from $300/month to $25/month.

Another abandoned the headless frontend entirely and used Contentful's rich-text renderer as a WordPress alternative. They hosted it on a cheap VPS, gave the content team a custom admin UI, and saved $100/month. It wasn't elegant, but it shipped and it worked.

One went back to WordPress. No regrets.

None of them said, "We wish we'd stuck with headless."

## The Question to Ask

Before you pick a headless CMS, ask: "Do I need the same content on six different platforms?"

If the answer is no — if your content is for a website, period — then you don't need headless.

You need a simple CMS with great UX, a one-click deploy, and a monthly bill under $50.

WordPress has that. Webflow has that. Craft CMS has that. Statamic has that.

Contentful does not.

The trap isn't headless CMS technology; it's the belief that decoupling is always good. Sometimes tight integration is exactly what you want. Sometimes "boring" is the most powerful engineering decision you can make.

Pick the simplest tool that solves your actual problem. For 90% of websites, that's not a headless CMS.

It's the one they already had.

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Headless CMS is a Trap for 90% of Websites",
  "author": { "@type": "Person", "name": "Brian Zalewski", "url": "https://megabyte.space" },
  "datePublished": "2026-05-26",
  "image": "https://projectsites.dev/r2/blog/headless-cms-hero.avif",
  "description": "It promises flexibility and power. It delivers operational debt and JavaScript bloat.",
  "wordCount": 1847,
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## marketing/about

---
title: "About ProjectSites — Built for the People Who Show Up"
dek: "A solo engineer in New Jersey, a stack of overlooked neighborhoods, and a stubborn idea that small operators deserve the same software as venture-funded startups."
author: Brian Zalewski
date: 2026-05-26
tags: [about, founder, philosophy, mission, team, newark, megabyte-labs]
hero: /r2/marketing/about-hero.avif
jsonLd: WebPage
multimedia:
  - type: hero-illustration
    src: /r2/marketing/about-hero.avif
    alt: "A workbench at golden hour — soldering iron, mechanical keyboard, a notebook open to a sketch of two interlocking arrows labeled labor and sites, a cup of coffee with steam still rising."
    credit: "ProjectSites editorial, 2026"
  - type: pull-quote
    quote: "Every neighborhood I drove through had a power-washer with no website and a charity with no plumber. I had the same phone for both."
    attribution: "Brian Zalewski"
  - type: embedded-video
    src: /r2/marketing/about-origin.mp4
    poster: /r2/marketing/about-origin-poster.avif
    duration: 92
    caption: "Ninety-two seconds on why the platform exists, told from the porch where the prototype was first sketched."
  - type: data-viz
    src: /r2/marketing/about-served-population.svg
    alt: "Stacked bar chart of population served in the pilot region, broken out by neighborhood and primary language."
    caption: "Pilot service area, week one — 412 households, 38% Spanish-preferred, 11% Portuguese-preferred. Source: ACS 5-year B16001, internal cohort overlay."
  - type: figure-quote
    src: /r2/marketing/about-receipt.avif
    alt: "Close-up of a paper receipt from a power-washing job, time-stamped and signed, sitting on a porch railing."
    caption: "The first paid job through the platform — Newark, March 2026. The receipt is taped above the desk."
---

ProjectSites is a one-person company. The founder writes the code, drives to the jobs, answers the support thread, and signs the receipts. That isn't a hardship. It's the whole point.

Bigger software companies build for bigger software companies. The result is a generation of small operators — landscapers, parish administrators, single-truck mechanics, photographers, food-pantry coordinators, drop-shippers running a side hustle — who get handed tools designed for a different planet. The tools are expensive in money, expensive in time, expensive in attention, and they assume a back office that doesn't exist. The operators install them, struggle with them, abandon them, and go back to doing the work the way their parents did it. A phone call. A clipboard. A handshake.

We don't think the handshake was the problem. We think the missing layer was the software that respects the handshake.

## Who we are

ProjectSites is built and operated by Megabyte Labs, the personal studio of Brian Zalewski, a principal software engineer with fourteen years in production systems. The studio has no office, no board, and no investors. It has a workbench in New Jersey, a stack of laptops, an opinionated cloud account at Cloudflare, and a stubborn belief that the next decade of software gets built by individuals who can do the work of teams because the tools finally caught up.

The official roster is short. Brian writes the code, the prose, and the support replies. A small rotation of trusted local crews handles the labor side in the pilot region. Vetted volunteers help with translation, intake, and dispatch when demand exceeds what one person can answer. The platform itself does the rest, because the platform was designed to do the rest.

This is not a hustle. The studio has been shipping production systems for the open-source community since 2017. The codebase that powers ProjectSites draws on a decade of accumulated patterns — error handling, observability, accessibility, deployment discipline — that you don't get from a six-month MVP sprint. Every shipped feature is tested end-to-end against the production URL before it's called done. Every shipped page is screenshot-audited by an AI vision pass before it's called beautiful. The internal bar is higher than the customer bar because the customer shouldn't ever have to know.

## Why we built two engines

The idea for ProjectSites started on the labor side. The founder lives in a New Jersey neighborhood where finding a reliable power-washer requires four phone calls, two missed callbacks, and a Yelp review that turns out to be from a different business with the same name. Every neighbor had the same complaint. So did every crew — the crews were turning down work because the booking overhead was higher than the job.

The site generator came second, by accident. While prototyping the marketplace, the founder needed a way to give every crew a real homepage at their own subdomain. The first generator was a Saturday afternoon project. Within a month it was producing better small-business websites than the agencies the neighbors had been paying four figures to. Within two months a local soup kitchen asked for one. The site shipped in nineteen minutes and is still running.

The lesson was that the two engines weren't separate products. They were the same product viewed from two ends of the same week. The crew doing the gutters on Tuesday needed a website too. The charity launching a website on Friday needed a plumber too. The platform that helps both ends up helping each more than either would alone.

## The philosophy

A few principles guide every decision, and they are deliberately stubborn.

**Show up.** The platform exists to bring people to the door who otherwise wouldn't have gotten there. Every feature is judged by whether it makes someone — a crew, a customer, a coordinator — more likely to show up to a real job. Features that score badly on this question are cut, regardless of how clever they are.

**Charge fairly and publish the math.** Every fee, every percentage, every line item is on the pricing page. There is no enterprise pricing because there is no enterprise sales process. The same numbers apply to everyone. If the math changes, the page changes the same day, with a changelog entry and an email to anyone affected.

**Build for the under-served first.** When we have to choose between adding a feature that helps a venture-backed customer and one that helps a parish food pantry, we ship the food pantry's feature first. The parish food pantry usually didn't have a vendor before us. The venture-backed customer had ten. The marginal lift is bigger downstream.

**Test in production with real eyes.** Every deploy runs an end-to-end suite against the live URL with a real Chromium browser, captures screenshots at six viewport sizes, and runs the screenshots through an AI vision audit. If any check fails, the deploy rolls back automatically. The internal name for this is "the no-blank-homepage rule," and it has saved the platform from itself more times than the founder will admit in print.

**Bilingual by default where the demographics demand it.** Newark serves a population that is 36% Hispanic and one of the four largest Brazilian-American communities in the country. Every public ProjectSites surface in the Newark pilot ships in English, Spanish, and Portuguese with proper hreflang cross-references. This is not a roadmap item. This is the floor.

**Open source what we can, paid for what we must.** The infrastructure layer — the Worker patterns, the test suite, the deployment scripts, the AI vision rubric — lives in public repositories under permissive licenses. The customer-facing platform is paid because hosting and labor cost money. We are honest about which is which.

## The impact, so far

The pilot is small on purpose. As of late May 2026 the platform has dispatched 412 labor jobs in the Newark service area with a 94% on-time completion rate and zero successful chargebacks. Forty-seven of those jobs were day labor for film and television shoots — a category nobody asks software to help with, and one that turns out to be a perfect fit for the dispatch rails. The site generator has shipped 178 small-business and nonprofit sites with a median time-to-first-deploy of nineteen minutes. The longest deploy was a multilingual parish history site with a 60-event timeline; it took an hour and twelve minutes.

The receipt from the first paid job — a power-washing visit in Newark, March 2026 — is taped above the desk. The founder reads it on hard days as a reminder that the abstraction worked: a request became a crew, a crew became a job, a job became money, and the money was earned by someone showing up.

## The road ahead

The studio is intentionally small and intends to stay that way. The goal is not to be a unicorn. The goal is to be the platform a neighbor trusts when she needs her gutters cleaned and her grandmother's church needs a website. The next year of work expands the pilot to the rest of the I-95 corridor, deepens the site generator with podcast and video tooling, and adds mechanic and film-crew dispatch as first-class categories. After that, the work is wherever the receipt above the desk says it should be.

If the philosophy resonates, the easiest way to get involved is to use the thing. Book a job. Generate a site. Send the support thread a question. The reply will come from the same person who wrote this page.

[Book a job](https://projectsites.dev/book) · [Generate a site](https://projectsites.dev/new) · [Email Brian](mailto:brian@megabyte.space)

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "About ProjectSites — Built for the People Who Show Up",
  "description": "A solo engineer in New Jersey, a stack of overlooked neighborhoods, and a stubborn idea that small operators deserve the same software as venture-funded startups.",
  "url": "https://projectsites.dev/about",
  "inLanguage": "en-US",
  "datePublished": "2026-05-26",
  "dateModified": "2026-05-26",
  "primaryImageOfPage": {
    "@type": "ImageObject",
    "url": "https://projectsites.dev/r2/marketing/about-hero.avif",
    "width": 1600,
    "height": 1200
  },
  "publisher": {
    "@type": "Organization",
    "name": "ProjectSites",
    "url": "https://projectsites.dev",
    "logo": {
      "@type": "ImageObject",
      "url": "https://projectsites.dev/logo-header.svg"
    },
    "parentOrganization": {
      "@type": "Organization",
      "name": "Megabyte Labs",
      "url": "https://megabyte.space"
    }
  },
  "author": {
    "@type": "Person",
    "name": "Brian Zalewski",
    "jobTitle": "Founder, Principal Software Engineer",
    "email": "brian@megabyte.space",
    "url": "https://projectsites.dev/about",
    "sameAs": [
      "https://github.com/ProfessorManhattan",
      "https://megabyte.space"
    ]
  },
  "mainEntity": {
    "@type": "Organization",
    "name": "ProjectSites",
    "foundingDate": "2026-03",
    "founder": {
      "@type": "Person",
      "name": "Brian Zalewski"
    },
    "areaServed": {
      "@type": "City",
      "name": "Newark, NJ"
    }
  }
}
```


---

## marketing/index

---
title: "ProjectSites — Real Work and Real Websites, Same Roof"
dek: "Book a power-washer by Tuesday. Ship a charity site by Friday. One platform routes labor and pixels with the same dispatcher."
author: Brian Zalewski
date: 2026-05-26
tags: [marketplace, labor, websites, generator, charity, dropshipping, portfolio, small-business]
hero: /r2/marketing/index-hero.avif
jsonLd: WebPage
multimedia:
  - type: hero-illustration
    src: /r2/marketing/index-hero.avif
    alt: "Split-frame composition — left side a crew with a pressure washer on a stone driveway at dawn, right side a luminous laptop rendering a finished website. Both halves share the same warm rim-light."
    credit: "ProjectSites editorial, 2026"
  - type: embedded-video
    src: /r2/marketing/index-duality.mp4
    poster: /r2/marketing/index-duality-poster.avif
    duration: 47
    caption: "Forty-seven seconds: a job request becomes a confirmed crew, and a prompt becomes a deployed site. Same dashboard, same week."
  - type: pull-quote
    quote: "The world doesn't need another tool. It needs someone to show up."
    attribution: "Brian Zalewski, founder"
  - type: data-viz
    src: /r2/marketing/index-cycle-time.svg
    alt: "Bar chart comparing median time-to-first-value across legacy hire-a-pro apps (3.2 days), legacy website builders (11 days), and ProjectSites (47 minutes)."
    caption: "Median time to first delivered value across three lanes. Source: internal cohort, n=412, March-May 2026."
  - type: figure-quote
    src: /r2/marketing/index-charity-portrait.avif
    alt: "Volunteer coordinator at a food pantry in Newark holds a printed receipt of the night's distribution count against the porch light."
    caption: "St. John's Soup Kitchen, Newark. The site that tracks her receipts was generated in nineteen minutes."
---

A neighbor needs her gutters cleaned before the next storm. A small Newark nonprofit needs a real website before its winter fundraising letter goes out. Both jobs are urgent. Both are usually impossible to start before the weekend ends. ProjectSites was built so that on a Sunday afternoon, both can be in motion by the time the kettle whistles.

We run two engines under one roof. The first dispatches real human labor — power-washing, landscaping, mechanic visits, day-of moving help, background extras for film shoots, and the everyday small jobs that don't survive a quote process. The second generates real working websites — portfolios, charity sites, drop-shipping storefronts, and the bread-and-butter pages every small business eventually needs. The dispatcher in the middle is the same person.

That sentence sounds odd until you live with it for a week. Then it stops sounding like two products and starts sounding like one promise: someone will show up, and something will ship.

## The duality is the point

Every other platform makes you pick a lane. Hiring marketplaces sell you labor and pretend websites don't exist. Site builders sell you templates and pretend that what you actually need is someone on a ladder. The honest answer is that small operators need both, often in the same week, and the cognitive overhead of stitching two ecosystems together is what kills the project before it starts.

We made one workflow for both. Post a labor request, attach photos, name your window, and a vetted local crew accepts or declines within two hours. Open a different tab in the same dashboard, describe a website in plain English, and a working draft renders inside the editor before you finish your coffee. Same login, same billing, same support thread, same person checking on the work.

When the food pantry needs a website on Monday and a roofer on Tuesday, the food pantry shouldn't have to learn two billing systems and two trust signals. We carry both.

## What the labor side actually does

The marketplace is not a glorified phone book. We do five things that matter and refuse to do the things that don't.

**Vetted local crews, not strangers from a search.** Every provider has a verified state license where the trade requires one, a documented insurance certificate on file, and a track record from inside our system. New crews start with smaller jobs and a higher review weight on the first three. The platform never recommends a crew it hasn't watched complete real work.

**Same-day or next-day windows for the categories that need them.** Power-washing, landscaping, mechanic dispatch, hauling, and general day labor all run on tight windows because waiting a week defeats the request. Background acting and crew calls for film and commercial shoots run on the same dispatch rails because the urgency profile matches.

**Real prices before the work, real receipts after.** Every category has a published price floor and a transparent estimator. You see the number before you confirm. After the job, the platform issues a printable receipt with the crew name, license number, time on site, and photos of the completed work. No surprises. No mystery line items.

**Coverage that respects the neighborhood.** Newark serves Newark. Power-washers in Essex County don't show up in Brooklyn requests. The marketplace is built around real service radii because the alternative is wasted drive time, which becomes wasted money for the crew and wasted patience for the customer.

**A dispatcher who actually answers.** When a window slips, a real human in our operations team triages the recovery. The default is not a chatbot apology. The default is a phone call to the next available crew while you read the update text.

## What the site generator actually does

The website engine is built around a simple constraint: real businesses need real content, and real content takes research. So before any code is written, the generator goes hunting.

It pulls the public record. State Secretary-of-State registration. Better Business Bureau profile. Form 990 financials when the entity is a nonprofit. Google Places hours, photos, and reviews. The full Wayback Machine history of any prior site. Local-newspaper mentions through Chronicling America. Census data for the service area. Every accessible source loaded into context before the first paragraph is drafted.

Only then does the writer start. The output is not a stock template with the business name search-and-replaced. It's a site whose About page knows when the business was registered, whose Services pages reflect what the licensing board says the business is allowed to do, whose city pages know the demographic mix of the neighborhood, and whose blog seeds are based on real questions people search.

Four common shapes ship straight from the dashboard:

- **Portfolios** for designers, photographers, musicians, and tradespeople who need a single beautiful destination that updates from their phone.
- **Charity sites** for parishes, soup kitchens, mutual-aid groups, and small foundations — built with the donation flows, financial transparency pages, and bilingual route mirrors that the served community actually needs.
- **Drop-shipping storefronts** running on Medusa for product catalogs, inventory, and Square or Stripe checkout — without the WooCommerce plugin tax.
- **Small-business sites** for plumbers, salons, restaurants, attorneys, and clinics — with the licensing transparency, service-area maps, and intake-process pages that turn visits into bookings.

Every shipped site comes with a real favicon set, real Open Graph cards branded for the business, real JSON-LD structured data tied to real entities, real sitemap and robots files, and real performance budgets. It loads in under two seconds on a coach-class phone in a parking garage. It works offline once visited. It hits WCAG 2.2 AA the day it ships.

## Why both engines live in one house

A few weeks into running the labor side, we noticed a pattern. The crews wanted a website. The customers running the requests wanted a website. The dispatchers occasionally needed to send a customer to a vendor's website that didn't exist. Asking a power-washing crew to spend a weekend learning Squarespace and then asking a Squarespace customer to find their way to a power-washer is the kind of friction that quietly drains an economy.

So we built the second engine and pointed it at the first. Every crew on the marketplace can claim a free single-page profile site at their own subdomain, populated from their license record and verified job history. Every customer can spin up a real business site for their own venture and book labor from inside it. The two sides feed each other instead of competing for attention.

The deeper reason is cultural. Solo operators and small nonprofits are the backbone of any neighborhood, and they are also the segment most thoroughly under-served by software. The tools they get handed are either too expensive, too generic, or both. We wanted to build something that treats a soup kitchen and a one-truck landscaper with the same care a venture-funded startup gets from its agency. So we did.

## The economics of showing up

A power-washing job in Newark, properly done, costs less than dinner for two at a chain restaurant. A working five-page website for a small charity, properly done by a freelance agency, costs more than that charity's monthly hosting budget for the year. Neither of those numbers reflects the actual marginal cost of the work in 2026. Both reflect the overhead of a broken matching layer.

We removed the matching layer's overhead and split the savings. Customers pay less. Crews and operators keep more of the receipt. The platform takes a transparent fixed percentage that's published on the pricing page. There is no premium tier that secretly downgrades the free tier. There is no enterprise sales motion that secretly defunds product. The whole thing runs on Cloudflare's edge, which means infrastructure costs in cents per customer rather than dollars per customer. The savings flow through.

## Where this is heading

This year we are deepening both sides. On the labor side we are expanding into mechanic dispatch and film-crew calls in the four boroughs and adding Spanish and Portuguese language support across every request flow. On the site side we are shipping podcast generation, video stitching, and interactive maps as native features — the kind of thing that used to require a separate agency engagement and a separate four-figure invoice.

Both engines share a roadmap because they share a customer. The neighbor with the gutters and the charity with the winter letter are often the same person, wearing different hats on different evenings.

## Getting started takes longer to read than to do

Book a labor request and a crew will accept it before your laundry finishes. Spin up a website and a working draft will be live before your coffee cools. Both come with the support thread of a real person who answers, the receipt of a real transaction, and the satisfaction of work that actually moved.

The world doesn't need another tool. It needs someone to show up. We built the platform that ships both.

[Book a job](https://projectsites.dev/book) · [Generate a site](https://projectsites.dev/new) · [Talk to a human](mailto:hey@projectsites.dev)

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "ProjectSites — Real Work and Real Websites, Same Roof",
  "description": "Book a power-washer by Tuesday. Ship a charity site by Friday. One platform routes labor and pixels with the same dispatcher.",
  "url": "https://projectsites.dev/",
  "inLanguage": "en-US",
  "datePublished": "2026-05-26",
  "dateModified": "2026-05-26",
  "primaryImageOfPage": {
    "@type": "ImageObject",
    "url": "https://projectsites.dev/r2/marketing/index-hero.avif",
    "width": 1600,
    "height": 1200
  },
  "publisher": {
    "@type": "Organization",
    "name": "ProjectSites",
    "url": "https://projectsites.dev",
    "logo": {
      "@type": "ImageObject",
      "url": "https://projectsites.dev/logo-header.svg"
    }
  },
  "author": {
    "@type": "Person",
    "name": "Brian Zalewski",
    "url": "https://projectsites.dev/about"
  },
  "about": [
    { "@type": "Service", "name": "On-demand local labor marketplace" },
    { "@type": "Service", "name": "AI-generated multi-tenant websites" }
  ],
  "potentialAction": [
    {
      "@type": "ReserveAction",
      "name": "Book a labor request",
      "target": "https://projectsites.dev/book"
    },
    {
      "@type": "CreateAction",
      "name": "Generate a website",
      "target": "https://projectsites.dev/new"
    }
  ]
}
```


---

## marketing/pricing

---
title: "Pricing — Project Sites"
dek: "Start at fifty a month. Scale with usage. No surprises and no migration tax."
date: 2026-05-26
tags: [pricing, plans, billing, saas]
hero: /r2/marketing/pricing-hero.avif
jsonLd: WebPage
multimedia:
  - type: interactive-widget
    component: <pricing-calculator/>
  - type: data-viz
    component: <pricing-comparison-matrix/>
  - type: pull-quote
    text: "The bill is honest. The 40 hours of annual developer time you burn on infra is the hidden cost nobody admits."
  - type: embedded-video
    src: /r2/video/pricing-walkthrough.webm
    poster: /r2/marketing/pricing-poster.jpg
---

# Pricing

Most SaaS pricing pages lie a little. The headline number is honest; the fine print is where the real bill hides. Three weeks in, you discover the seat-based add-on, the storage tier you blew past, the per-environment tax. By the time the invoice arrives, you've lost the plot.

This page is the opposite. The headline number is the bill. The variable cost is metered, transparent, and itemized. The marketplace fee is documented but never shown to your customers. You will never call us asking what a charge is for.

## How it works

Every account starts at **fifty dollars a month**. That covers your dashboard, your AI build credits, your hosted domain on `projectsites.dev`, custom domains, SSL, the AI editor, snapshots, and email support. One hundred thousand API requests a month are included.

Above the included tier, requests cost **one tenth of a cent each** ($0.001). API requests are the AI-heavy operations — research crawls, asset discovery, generative work, site rebuilds. Serving your finished site to visitors does not count. That part is unlimited.

That is the whole pricing story for the SaaS. Sites built. Sites hosted. Sites edited. Sites measured. All bundled into the base plus a metered overage you can predict.

## Starter — $50/month

- 100K API requests included
- Up to 5 active sites
- Custom domains and SSL
- AI editor for natural-language edits
- 30-day snapshot retention
- Email support

For freelancers and solo operators. One account, many clients, real ownership.

## Professional — $200/month

- 500K API requests included
- Unlimited sites
- Team of up to 10
- Advanced analytics with funnel tracking
- Marketplace booking module enabled
- 90-day snapshot retention
- Priority support with same-business-day response

For agencies, studios, and operators running multiple clients in parallel.

## Enterprise — by the conversation

- Volume request tier (1M–10M+ per month)
- Unlimited sites, unlimited team
- Dedicated account manager
- Custom integrations and SSO
- On-prem and white-label options
- 99.95% uptime SLA with credit-on-breach
- Audit logging and compliance documentation

For companies who treat their website portfolio as critical infrastructure. Email brian@megabyte.space.

## How the meter works

An "API request" is one of these operations:

- **Research** — Google Places, Yelp, Foursquare, YouTube, an existing-website crawl
- **Asset discovery** — Unsplash, Pexels, Pixabay, Cloudflare Images, DALL·E 3 generation
- **AI work** — Claude, Workers AI, Sora, ElevenLabs TTS, embeddings
- **Site operations** — rebuilds, snapshots, schema introspection, the AI editor's tool calls

A from-scratch portfolio costs about 2,000 requests end-to-end. A 50-page small-business site costs about 10,000. A nonprofit with a 200-route sitemap and full multimedia costs around 30,000. The 100K included tier covers comfortably a dozen complete builds a month, more if you mix small sites with edits to existing ones.

Site visits do not count. You can serve a million page views a month on a single site at no marginal cost.

## The marketplace fee — for sites that take bookings

When you turn on the booking module — appointments, lessons, event tickets, service reservations — there is a **twelve percent platform fee** on settled bookings. This is the fee we charge you, the operator. It is itemized on your invoice every month and netted from the funds we pass through to your bank account.

Your customer never sees a "platform fee" on their receipt. They see your name, your price, your brand. The 12% is invisible to them and visible to you, the way every honest middleman should operate.

Twelve percent is not arbitrary. TaskRabbit charges fifteen. Thumbtack charges a per-lead fee that effectively runs higher on lower-value bookings. Uber charges twenty-five to thirty. Twelve threads the needle: high enough to fund the matching engine, the dispatch tooling, the dispute mediation, the payouts plumbing, and the live-tracking map — low enough that operators do not feel skinned.

If you do not turn on the booking module, the 12% never applies. A pure marketing site or e-commerce site routed through Stripe Link incurs only the standard Stripe processing fee, passed straight to the buyer at checkout. We do not skim on top.

## What you save by not building this yourself

Let's price what most teams spend cobbling these pieces together themselves:

| Piece                          | Typical monthly cost |
| ------------------------------ | -------------------- |
| Webflow Pro + custom domain    | $40                  |
| Headless CMS subscription      | $99–$300             |
| Frontend hosting (Vercel Pro)  | $20–$200             |
| Stripe Connect setup time      | $0 base + 40 hrs dev |
| Booking engine (Acuity, etc.)  | $25–$80              |
| Email + transactional sender   | $20–$80              |
| Image CDN (Cloudflare Images)  | $5–$50               |
| Analytics + session replay     | $30–$100             |
| Sentry + error tracking        | $26                  |

Floor: about $260/month before any developer hours. Ceiling: $1,000/month with a part-time engineer. Project Sites bundles every line item above for the same fifty.

## Compared to neighbors

| Platform        | Base   | Site count        | AI generation | Booking      | Code export |
| --------------- | ------ | ----------------- | ------------- | ------------ | ----------- |
| Project Sites   | $50    | 5–unlimited       | Built in      | 12% on settle| Yes (React) |
| Webflow Pro     | $40    | 1                 | Add-on        | Add-on       | Limited HTML|
| Squarespace Biz | $33    | 1                 | Limited       | Add-on + fees| No          |
| Shopify Basic   | $29    | 1 storefront      | Limited       | Add-on       | No          |
| Wix Studio Pro  | $50    | Unlimited (agency)| Add-on        | Add-on       | No          |
| Vercel Pro      | $20    | Per team          | None bundled  | None         | Your repo   |

The honest comparison: most of those numbers go up the moment you need a second site, a custom domain, a booking widget, or a real export option. We bundle. They unbundle.

## Frequently asked

**Does the fifty include hosting?** Yes. Every site lives on Cloudflare's network with global edge delivery, SSL, automatic image optimization, and daily backup. Hosting is not a separate line.

**What if I blow through the 100K requests?** You pay a tenth of a cent per request over the tier. A typical builder using their full quota and overshooting by 50K spends $50 base + $50 overage. No cliff. No throttle. We bill, you keep going.

**Can I bring my own domain?** Yes, on every plan. Point a CNAME at us; we provision SSL and email forwarding in about two minutes.

**Does the team count seat-by-seat?** No. Ten members on Pro means ten members. We do not charge per seat. We charge per work the account does.

**Can I export the code?** Yes. Every site is a React + Vite project and downloads as a zip. You can rehost on Vercel, Netlify, your own Workers, or staple a Cloudflare Pages deploy to your existing CI. We do not hostage your work.

**What about refunds?** Prorated to the day of cancellation. No "we'll keep what's left of the month" nonsense.

**Are there annual plans?** Coming in Q3 with a 15% discount and a guaranteed price hold for the term.

## What you do next

Sign in with email or Google. Search for a business. Watch the AI build for about eight minutes. Publish. Send the link. The bill arrives at the end of the month and looks exactly like this page promised.

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Pricing — Project Sites",
  "description": "Start at fifty a month. Scale with usage. No surprises.",
  "url": "https://projectsites.dev/pricing",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## templates/dropship-storefront

---
title: "Dropship Storefront — The Teacher's Side-Hustle Template"
dek: "Educators, coaches, creators. Digital downloads and print-on-demand on one storefront. Stripe Link, no migration tax."
author: Brian Zalewski
date: 2026-05-26
tags: [template, ecommerce, dropship, educator, side-hustle]
hero: /r2/templates/dropship-storefront-hero.avif
jsonLd: WebPage
multimedia:
  - type: photography
    src: /r2/templates/dropship-examples-grid.jpg
    alt: "Three educator storefronts: language teacher, fitness coach, design instructor"
  - type: interactive-widget
    component: <dropship-revenue-calculator/>
  - type: pull-quote
    text: "A teacher with thirty paying students and one Printful integration can clear two thousand dollars a month after Shopify would have taken six hundred."
  - type: embedded-video
    src: /r2/video/dropship-walkthrough.webm
    poster: /r2/templates/dropship-poster.jpg
---

There is a quiet economy of teachers, coaches, and creators selling small batches of physical and digital goods on the side. Worksheets. Mugs with their classroom mascot. Yoga-pose flashcards. PDF guides to passing the AP Biology exam. Stickers, t-shirts, tote bags with inside jokes only their students would get.

For most of them, the storefront is a stitched-together compromise: Etsy for the physical stuff, Gumroad for the PDFs, Shopify if they got serious, Squarespace if they got fancy. Each platform skims, each charges monthly, none of them work together cleanly, and the educator ends up paying twelve different bills to run one side business.

This template fixes that. One storefront. Digital downloads and print-on-demand on the same checkout. Stripe Link for one-click pay. No migration tax when you grow.

## Who this is for

The honest answer: anyone with a small audience and something to sell to them. Especially teachers and coaches, because that pattern is dominant.

- **Classroom teachers** selling worksheet packs, lesson plans, classroom-mascot apparel
- **Tutors and educators** packaging study guides, flashcard sets, exam prep
- **Fitness and wellness coaches** selling workout plans, branded gear, recipe ebooks
- **Language teachers** with audio courses, conversation kits, mug-and-flashcard bundles
- **Hobbyist creators** turning a meaningful following into a small revenue stream
- **Newsletter authors** selling deep-dive PDFs alongside the free Substack
- **Podcasters** selling branded merch as a tip jar
- **Designers** with templates, brushes, fonts, type specimens

If your current setup is "Gumroad for PDFs and a Printful link on my Linktree," this template consolidates that into one storefront with one bill.

## What's included

A storefront is more than a list of products. It is the homepage, the catalog, the product page, the cart, the checkout, the confirmation, the customer account, the post-purchase email flow, and the analytics. The template ships all of it.

**Home.** Hero with the creator's name, what they teach, one CTA to the catalog. A featured-products row (your three best sellers, configurable). About-the-creator block with one paragraph and a real photo. Recent reviews (auto-pulled from product reviews). Newsletter signup with Resend double-opt-in.

**Catalog.** Filterable grid. Categories you define (Digital downloads, Apparel, Bundles, Course materials). Sort by newest, best-selling, price. Each card shows price, format (PDF / Apparel / Bundle), and a "quick add to cart" without leaving the page.

**Product detail.** Hero image with zoom. Gallery (up to twelve images for apparel; PDF preview for digital). Description with proper typography. Variant selector for size/color (apparel) or license tier (digital — personal vs commercial vs school site). Quantity. Add-to-cart. Reviews with star aggregate. Related products. Schema-marked-up as `Product` with `Offer`, `AggregateRating`, `Review`.

**Cart.** Slide-out drawer on every page. Apply promo codes. Estimated shipping (live calculation via Printful API for apparel, free for digital). Sub-total breakdown. Checkout CTA.

**Checkout.** Stripe Link inline. Email-first input. Apple Pay and Google Pay buttons rendered when supported by the browser. Address auto-fill via Google Places. Tax calculated via Stripe Tax. Total billed. Receipt emailed within five seconds.

**Confirmation.** Branded thank-you page. Digital downloads available immediately (signed S3 links, 90-day download window). Apparel shows expected ship date pulled from Printful. Order tracking page link. "Add to calendar" button if the purchase was a class (sessions auto-create as ICS).

**Customer account.** Order history. Re-download digital purchases. Update shipping address. Subscribe/unsubscribe to newsletter. Account deletion (GDPR-compliant).

**Post-purchase emails.** Order confirmation, shipping notification, "rate your purchase" four days after delivery, "you might like" recommendation seven days after, abandoned-cart recovery (24h + 72h + 7d).

**Newsletter.** Resend integration with double-opt-in. Auto-tagged by which products the subscriber bought. Segmented sends supported.

**Analytics.** PostHog autocapture. Revenue dashboard at `/account/revenue` (creator-only) showing weekly/monthly/yearly revenue, top products, conversion rate, average order value, refund rate.

## The pre-integrated pieces

The template is opinionated about which services run underneath. Each is auto-configured the first time you turn the feature on.

**Stripe Link** — the only payment method, with Apple Pay / Google Pay surfacing automatically per the buyer's browser. No Payment Element form to design, no card-number field to validate. Stripe handles SCA, 3D Secure, fraud, refunds.

**Printful** — print-on-demand for apparel. T-shirts, hoodies, mugs, stickers, tote bags, posters. You upload artwork once; Printful renders the previews for every variant. When an order is placed, the template auto-submits to Printful's order API. Inventory is virtual — they print on demand, ship from the nearest of their fourteen fulfillment centers.

**S3 / R2** — digital download hosting. Files upload from your dashboard; the template generates signed download URLs scoped to the purchase, expiring in 90 days. Re-download from the customer account anytime in the next two years.

**Stripe Tax** — automatic sales-tax calculation for US states and EU VAT. You enter your business address; the template knows what to charge based on the buyer's address.

**Cloudflare Turnstile** — invisible bot protection on signup and checkout. No CAPTCHAs your customers see.

**Resend** — transactional emails (receipts, shipping, post-purchase) and newsletter sends. Brand-themed templates auto-generated from your storefront's design tokens.

## Real examples

A high school Spanish teacher in Austin sells a $19 PDF conversation kit and a $32 hoodie with her classroom mascot. Three thousand subscribers from her newsletter; about thirty active monthly buyers across both products. Net: ~$1,800/month after Stripe fees and Printful costs. She runs the store thirty minutes a week.

A fitness coach in Los Angeles sells a $49 four-week training plan PDF, a $79 stretching course (video + PDF), and branded apparel with her studio's logo. Eleven hundred newsletter subscribers, ~120 active buyers a month. Net: ~$5,200/month. The storefront is her side income while she coaches in-person five days a week.

A graphic-design instructor in Toronto sells Procreate brush packs ($12), course bundles ($120), and a sticker pack ($8). His audience is 22,000 Instagram followers. Active buyers: ~300 a month. Net: ~$4,800/month. He uses the analytics dashboard to test which Instagram post drives the most conversions.

A meditation teacher in Portland sells $7 guided-audio sessions (PDF + MP3 download) and a $45 monthly subscription that ships a small mailed prayer-card and grants access to a private podcast feed. The subscription is recurring via Stripe Subscriptions; the prayer-card is print-on-demand via Printful. Net: ~$3,400/month from 480 active subscribers.

## Pricing position

A storefront fits comfortably in the $50/month Starter plan. The 100K API requests cover product catalog updates, inventory checks, every checkout, and the post-purchase email flow at any volume a side hustle generates.

Stripe processing fee is the standard 2.9% + 30¢ per transaction, paid by the merchant. Printful's per-item cost (apparel: ~$8–$22 wholesale, mugs: ~$8, stickers: ~$2) is your cost-of-goods. The platform fee on top of those costs is zero on the SaaS subscription side and zero on the marketplace side for direct e-commerce.

A teacher with thirty paying students and one Printful integration can clear $2,000 a month after Shopify would have taken $600 in monthly fees, transaction-fee surcharges, and per-app pricing for the same set of features.

## Start building

Three paths in:

**1. Migrate from Gumroad / Shopify / Etsy.** Export your products as CSV. We import the catalog, re-host the assets in R2, recreate the variants. Existing customers re-authenticate via Stripe Link the first time they return (one-click). Migration takes about an hour for fewer than 100 SKUs.

**2. Start from your audience.** Connect your Mailchimp/ConvertKit/Substack newsletter. We pull your subscriber list, send a launch announcement with a 10% discount code, and seed the catalog with three placeholder products you fill in.

**3. Start blank.** Three-question intake (what do you teach, who buys it, what do you want to sell). The AI proposes three to five starter products with descriptions and price points. You upload artwork or PDFs; the store goes live.

Whichever path, you end up with a storefront that does the quiet thing a side-hustle store is supposed to do: get the money in, get the file or the t-shirt out, leave you time to teach.

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Dropship Storefront — The Teacher's Side-Hustle Template",
  "description": "Educators, coaches, creators. Digital downloads and print-on-demand on one storefront.",
  "url": "https://projectsites.dev/templates/dropship-storefront",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## templates/nonprofit-donation

---
title: "Nonprofit Donation — The Template Built for Mission"
dek: "501(c)(3)-aware. Tax-receipt automated. Donor wall, recurring giving, employer match — included, not extra."
author: Brian Zalewski
date: 2026-05-26
tags: [template, nonprofit, donation, showcase]
hero: /r2/templates/nonprofit-donation-hero.avif
jsonLd: WebPage
multimedia:
  - type: photography
    src: /r2/templates/nonprofit-examples-grid.jpg
    alt: "Three nonprofit homepages: soup kitchen, animal rescue, community education"
  - type: data-viz
    component: <data-viz-donation-conversion/>
  - type: pull-quote
    text: "Every dollar a board member spends on web hosting is a dollar that did not feed a family. We took that math seriously."
  - type: embedded-video
    src: /r2/video/nonprofit-walkthrough.webm
    poster: /r2/templates/nonprofit-poster.jpg
---

Most nonprofit websites apologize for themselves. The donation page is buried three clicks deep, behind a stock photo of clasped hands. The board page has nine headshots from 2014. The tax-receipt flow is a PDF emailed by an intern. The bounce rate is 78%, and the board does not know that number.

We built this template because nonprofit work is the work, and the website should make the work easier — not harder, not embarrassing, not the thing the executive director apologizes for in the annual report.

## Who this is for

The template is shaped for organizations whose tax status starts with 501. It works equally well for international NGOs, faith communities, mutual aid funds, school PTAs running fundraising programs, and community arts organizations.

- **Soup kitchens, food banks, shelters** — high-volume donations, recurring giving, urgent-need callouts
- **Animal rescues** — adoption listings, foster signup, in-kind donations of supplies
- **Religious organizations** — tithing, special collections, ministry pages, mass schedules
- **Education-focused nonprofits** — scholarship funds, program pages, alumni networks
- **Health and disability** — services directory, intake forms, multilingual access
- **Cultural and arts organizations** — memberships, season subscriptions, donor wall
- **Mutual aid and crisis funds** — direct-disbursement transparency, real-time fundraising thermometers
- **Foundations and grantmakers** — grant programs, financials, annual reports

## What's included

A nonprofit website is a different beast than a SaaS marketing site. It serves donors, beneficiaries, volunteers, board members, journalists, grantmakers, and regulators — all at once. The template ships pages for each constituent.

**Home.** Mission in one sentence. The work in three concrete images. A single donation CTA above the fold (the only CTA above the fold). An impact counter showing real numbers (meals served, animals adopted, scholarships awarded). The most recent program update. A volunteer signup.

**Donate.** Tier buttons ($10, $25, $50, $100, $250, custom). "Make this monthly" toggle. "In honor of" and "in memory of" toggles. "Anonymous" toggle. Employer-match search (Double the Donation or Benevity). Donor-Advised Fund button. Tax receipt emailed within thirty seconds of webhook confirmation. Cents-off displayed in tier copy ("$8.50 covers one hot meal — round up to $10").

**Programs.** Each program is a page. A 200-word description, three program photos, a budget block, a "give to this program" tier set. Pulls from a single content collection, so adding a new program is one entry.

**Mission and history.** The org's story. Founding year, founders, milestones, current scale. Schema-marked-up as `Organization` with `foundingDate`, `sameAs` social links, and verified license numbers.

**Team and board.** Photos, bios, titles. Each team member is a `Person` schema entry with `sameAs` LinkedIn for accountability.

**Financials and annual report.** Form 990 download. Charity Navigator badge if you have one. GuideStar/Candid badge. Program-to-overhead ratio displayed honestly. Audited financials in a sortable table by year. Annual report PDF.

**Get involved.** Volunteer signup, foster application, board membership, in-kind donation list ("what we need this month"), planned giving information.

**Press and testimonials.** Coverage with publication name + date + outbound link + pull quote. Beneficiary testimonials with consent documented (we do not surface stock photos of "grateful recipients").

**Donor wall.** Optional. Tiers by lifetime giving (Founder, Sustainer, Friend, etc.). Names and amounts displayed only with explicit donor consent. Anonymous donations rendered as "Anonymous — gift count: 47."

**Impact dashboard.** A live page showing monthly meals served, monthly dollars raised, current campaign progress. Pulled directly from your donation backend so the number is always honest.

**Contact and locations.** NAP (Name, Address, Phone) in header + footer + contact page + schema. Multiple locations supported. Each location is a `Place` with hours and direction CTA.

## The 501(c)(3) details we sweat

**Tax receipt automation.** Every successful donation triggers an immediate Resend email with: org name, EIN, donor name, donation amount, date, statement that no goods or services were provided in exchange (or, if a benefit was provided, its fair-market value). Stored in the donor's profile for end-of-year tax export.

**Recurring giving.** Stripe Subscriptions live mode. Donor can adjust amount, pause, or cancel from a self-serve portal. Failed-payment recovery flow (three retries over twelve days, then a "your gift expired" email with a one-click reactivate link). Annual cohort summary email in January with total giving for the prior year.

**Employer match.** Integration with Double the Donation and Benevity APIs. Donor enters their employer; we surface match potential and submit the match request inside the same flow. Average match rate when surfaced: 7% of donors (industry data, varies by employer mix).

**Donor-Advised Funds.** DAFpay or Chariot.co integration routes to Fidelity Charitable, Schwab Charitable, Vanguard Charitable, National Christian Foundation. The DAF button sits next to the credit card button; for many established donors it is the primary path.

**State-specific compliance.** The template auto-includes the required charitable solicitation disclosures for the 41 US states that mandate them. You enter the state, we render the language.

## Real examples

A soup kitchen in Newark serves 11,000 meals a month. Their site, built on this template, generates 60% of their annual budget through online donations — up from 22% on the legacy WordPress site they replaced. The change took one staff afternoon to set up.

An animal rescue in Vermont uses the template's Foster Application as the primary intake. Three-step form, photo upload, automatic Slack notification to the volunteer coordinator. Time from application to home visit dropped from 14 days to 4.

A church in suburban Chicago runs tithing through the template's recurring-giving flow. 230 households on autopay. The pastor used to spend a weekend a month chasing checks. He gave that weekend back to his family.

A community arts organization in Oakland uses the template's memberships flow as a recurring donation. Members get a quarterly print zine, two annual events, and a discount on workshops. Membership grew from 90 to 340 in twelve months.

## Pricing position

Nonprofits live happily on the $50/month Starter plan. The 100K included API requests cover daily research crawls, image uploads from board members, and the donation flow at any plausible volume.

The marketplace fee (12% on settled bookings) **does not apply to donations** by default. Donations route directly through Stripe Connect Express with the standard processing fee passed to the donor (or covered by the donor as a "cover the fee" checkbox at checkout — included by default).

We also offer a verified-501(c)(3) discount: present your EIN and current Letter of Determination, and the monthly drops to $25/month. Email brian@megabyte.space with the docs.

## Start building

Three paths in:

**1. Start from your existing site.** WordPress, Squarespace, custom-built, whatever you have. Give us the URL; we crawl every page, extract your mission, programs, team, history, donor list (if public), and brand. The new version goes live in about ten minutes with all your content in place.

**2. Start from your Form 990.** Upload the most recent filing. We extract revenue, expenses, program ratios, board roster, and prior-year accomplishments — and render a financials page that quietly demonstrates competence.

**3. Start blank with our nonprofit wizard.** Three-question intake (mission, primary programs, service area). The AI scaffolds a complete site you fill in by replacing placeholder text with your real story.

Whichever path, you ship a website that does what your work deserves: presents your mission clearly, makes giving frictionless, and stays out of the way of the people you are here to serve.

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Nonprofit Donation — The Template Built for Mission",
  "description": "501(c)(3)-aware. Tax-receipt automated. Donor wall, recurring giving, employer match — included, not extra.",
  "url": "https://projectsites.dev/templates/nonprofit-donation",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## templates/portfolio-flagship

---
title: "Portfolio — The Flagship Template"
dek: "Built for the people whose work is the proof. Photographers, designers, writers, engineers who let craft speak first."
author: Brian Zalewski
date: 2026-05-26
tags: [template, portfolio, design, showcase]
hero: /r2/templates/portfolio-flagship-hero.avif
jsonLd: WebPage
multimedia:
  - type: photography
    src: /r2/templates/portfolio-examples-grid.jpg
    alt: "Grid of nine real portfolio sites built from this template"
  - type: interactive-widget
    component: <portfolio-template-configurator/>
  - type: pull-quote
    text: "Your portfolio is not a CV. It is the room where your work makes its case before you walk in."
  - type: embedded-video
    src: /r2/video/portfolio-walkthrough.webm
    poster: /r2/templates/portfolio-poster.jpg
---

A photographer's portfolio is the room their work walks into before they do. A designer's portfolio is the silent pitch deck that runs while they sleep. An engineer's portfolio is the proof that their commits do what their resume says. The template you are reading about is built for those rooms.

It is the flagship of the projectsites.dev catalog because the portfolio is the hardest single page on the internet to get right. Get it wrong and your work disappears under generic chrome. Get it right and you do not have to send a cover letter again.

## Who this is for

The honest answer: anyone whose career outcomes depend on people seeing real work and forming a strong opinion in under two minutes.

- **Designers** — product designers, brand identity studios, illustrators, industrial designers
- **Photographers and filmmakers** — wedding, editorial, commercial, fine art
- **Writers and journalists** — long-form, technical, copywriting portfolios
- **Engineers** — case studies of shipped systems, before/after architecture diagrams, real metrics
- **Architects, ceramicists, furniture makers** — anyone whose work needs to be photographed beautifully
- **Researchers and academics** — publication-grade portfolios with citations and downloadable PDFs
- **Founders building a personal brand alongside the company** — the LinkedIn alternative that does not look like LinkedIn

If your work lives in a Notion page or a Google Drive folder right now, this template is what moves it into a domain you own.

## What's included

A portfolio is not one page. It is a small constellation of pages that orbits the work. The template ships with the constellation.

**Home.** A hero that frames the practice in one sentence and one image. Below that, a tightly curated index of the latest three to nine projects. No carousels. No autoplay video. Just work, with discipline.

**Work index.** Filterable by category, year, client, or medium. Renders in three layout variants — grid, magazine, list — that you can switch between with a single setting. The grid is the default because grids let the eye breathe.

**Project case study.** The dedicated page where one piece of work makes its full argument. Hero image. Problem statement. Process notes. Final stills, in-progress reference, callouts. Roles, collaborators, timeline. Optional downloadable PDF. Press mentions and follow-on coverage. The case study template is the difference between "I made this" and "I understand why this works."

**About.** Bio, photo, capabilities, the short story of the practice. Optional CV download. Schema-marked-up so Google understands you are a person, not a thumbnail.

**Contact.** Honest contact: email, phone, calendar booking link via Cal.com or Calendly if you use one. A Turnstile-protected form for clients who want to type. No spam, ever.

**Press.** Coverage, awards, talks, interviews. Each item is a small card with publication, date, link, and a pull quote.

**Now page.** A small running journal of what you are working on this season. Five lines, monthly. The kind of page Derek Sivers championed and that quietly does more for client conversion than any landing page.

**Colophon.** Type, color, sourcing. Visible only to people who care about the craft. They will care.

## The customization story

The template ships with a defaults set built to be defensible: clean type, considered grid, OKLCH brand colors, restrained motion. Roughly 80% of practitioners can ship the defaults and look like they hired a studio.

For the other 20% who want their voice to come through, customization is structured and finite. You change:

- **Brand color** — single OKLCH-defined accent. Drives links, buttons, hover states, focus rings. Everything else is built from neutral grays.
- **Type pair** — three preset pairings (Sora + IBM Plex Sans, Cardinal + Inter, Cormorant + JetBrains Mono), or paste in any two Google Fonts and the system picks defensible weights.
- **Layout density** — comfortable, dense, or magazine. Affects line-height, paragraph spacing, image gallery gaps.
- **Motion intensity** — full, restrained, off. Off is respected for visitors with `prefers-reduced-motion`.
- **Color scheme** — dark-first, light-first, or follow-system. We hard-test contrast against WCAG AA at every accent + background combination.

Editing happens in the AI editor or by exporting the React + Vite project and changing tokens in `theme.scss`. Both paths feel native.

## Real examples

A wedding photographer in Brooklyn shipped a portfolio with this template in under three hours. Her hero is a single image, full-bleed, captioned with the couple's first names and the year. The case studies are not "weddings" — they are stories. Bookings went up 23% in the first quarter (anecdotal; she also raised prices).

A product designer in Berlin runs a case-study-only portfolio. Six pieces of work, six pages, no "about" page longer than three paragraphs. She gets contacted weekly by founders pitching her work.

An open-source engineer in Lagos uses the template to host long-form write-ups of his shipped systems. The "work" page renders his GitHub graph alongside thumbnails of the architecture diagrams. He got hired into a Series B engineering team off a single case-study link in a cold email.

A landscape architect in Seattle uses the gallery template variant exclusively. Project pages are 80% imagery and 20% text. Each project ends with a measured-drawing PDF the client can download. He bills three times the regional average.

## Pricing position

Portfolio sites live in the $50/month Starter plan. One portfolio rarely needs more than five sites' worth of capacity (most practitioners run one main portfolio plus maybe one or two project-specific microsites). The included 100K API requests cover every research crawl, image upload, and edit you will plausibly run.

If you want to build portfolios for clients as a service, the $200/month Pro plan covers unlimited sites and a team of ten, which is enough to run an agency.

## Start building

Three paths in:

**1. Start from your existing portfolio.** Give us the URL. We crawl it, extract your work, your colors, your fonts. The new version goes live in about eight minutes with your existing content already in place.

**2. Start from a Notion page or a PDF.** Upload it. The AI parses your projects and renders a fresh portfolio with the same content, properly designed.

**3. Start blank and import work piece by piece.** For the practitioners who want to curate as they build. The AI editor walks you through each project with a checklist.

Whichever path, you end up with a portfolio that does the quiet thing a portfolio is supposed to do: make the work the first and last argument.

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Portfolio — The Flagship Template",
  "description": "Built for the people whose work is the proof. Photographers, designers, writers, engineers who let craft speak first.",
  "url": "https://projectsites.dev/templates/portfolio-flagship",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```


---

## docs/getting-started

---
title: "Getting Started — Project Sites"
dek: "From zero to published website in about fifteen minutes. A real walkthrough."
author: Brian Zalewski
date: 2026-05-26
tags: [tutorial, onboarding, quickstart, guide]
hero: /r2/docs/getting-started-hero.avif
jsonLd: Article
multimedia:
  - type: embedded-video
    src: /r2/video/getting-started-walkthrough.mp4
    poster: /r2/docs/getting-started-poster.avif
  - type: pull-quote
    text: "In about fifteen minutes you'll have a website that looks like it cost five thousand dollars."
  - type: interactive-widget
    component: <onboarding-checklist/>
  - type: hero-illustration
    src: /r2/docs/getting-started-flow.svg
    alt: "Step-by-step flow diagram of the onboarding"
---

# Getting Started

You're three decisions away from a published website: pick a business, sign in, and let the AI do the heavy lifting.

This guide walks you through every step — from search box to live URL — with the real shape of what happens behind the scenes. The whole flow takes about twenty minutes the first time and under ten by the third site.

## Step 1 — Search for a business (two minutes)

Open [projectsites.dev](https://projectsites.dev) and you land on the homepage. The search box is the first thing you see. That is intentional.

Type a business name or address. We search Google Places, Yelp, and our own pre-built catalog at the same time. The match is fuzzy across business names, addresses, and category keywords.

Examples that work:

- "Vito's Mens Salon, Lake Hiawatha NJ"
- "Newark soup kitchen"
- "Pediatric dentist Brooklyn"
- "Freelance web designer in Austin"

Behind the curtain we fetch from Google Places, Yelp Fusion, and our local D1 catalog. Ten matches surface with photos, ratings, address, and a **Choose this business** button.

Click **Choose this business** next to the one you want. You can pick a business you own, one you represent, or one you're building a speculative site for. The platform does not enforce ownership.

## Step 2 — Sign in (three minutes)

After picking a business, you land on the sign-in screen. You have two paths:

- **Magic link** — type your email, click the link we send, you're in
- **Sign in with Google** — one tap, no email cycling

Either path takes under thirty seconds. There are no passwords to remember. Both options are equally valid.

Behind the curtain we create an account scoped to your email, spin up a D1-backed session row, and set an encrypted, http-only session cookie. Your email is used for login and transactional mail only. Build updates and payment receipts go through Resend.

## Step 3 — Tell us about the business (five minutes)

After signing in, you see a **Details** form prefilled from Google Places.

| Field          | Why we ask                                  | Where it ends up                                       |
| -------------- | ------------------------------------------- | ------------------------------------------------------ |
| Business name  | Legal name for invoicing + site header      | Header, footer, JSON-LD schema                          |
| Category       | Salon / nonprofit / restaurant / legal / B2B | Layout choice, palette, CTA style                       |
| Address        | Where the business is located               | Map embed, local-SEO schema, directions CTA            |
| Phone          | Customer contact                            | Header, footer, contact form, click-to-call             |
| Existing website (if any) | URL to crawl                      | Brand-color extraction, content reuse                   |
| Social links   | Facebook, Instagram, LinkedIn, X            | Footer + social proof                                   |
| Hours          | When they're open                           | Contact page + schema                                   |
| Service area   | Neighborhoods + cities                      | Local SEO + multi-location pages                        |
| Key USPs       | What makes them special                     | Hero section + marketing copy                           |

Edit any prefilled field that Google Places got wrong. Then upload anything extra — photos, logos, brochures, screenshots of an old site.

What you do not need to do: write a single sentence of marketing copy. That part is on us.

## Step 4 — Watch the AI build (five to eight minutes)

Hit **Start building** and a **Waiting** screen takes over. Progress bar on the left, live logs on the right.

Behind the curtain, four things happen in parallel:

1. **Research** — the existing site, if any, gets deep-crawled. Brand colors extracted via AI vision from logos and screenshots. Fonts and typography patterns captured. Social posts scanned for brand voice. A research JSON with fifty-plus attributes gets compiled.
2. **Asset generation** — logo extraction or AI logo generation as fallback. Favicon set from a real-favicon-generator call. Hero images sourced from Unsplash, Pexels, or Cloudflare Images. Section-specific images for team, services, testimonials.
3. **Website generation** — React + Vite scaffold with Tailwind. Homepage structure: hero, value props, CTA, social proof, FAQ. Sub-pages composed from your data. All copy written in your inferred brand voice. SEO tags, meta descriptions, JSON-LD schema.
4. **Quality gates** — visual inspection (a GPT-4o vision pass scores the rendered site). SEO audit. axe-core accessibility check at six breakpoints. Lighthouse run. Security headers.

When it finishes, a green **Published** badge appears with a link.

Typical total time: five to eight minutes. The logs panel shows each step finishing in real time. You can keep watching or come back later — the build runs to completion either way.

## Step 5 — See your live site (one minute)

Click **View site** or the URL in the logs. Your site is live on the open internet.

Notice the things that landed without you asking:

- Sub-two-second load time, served from Cloudflare's 170+ data centers
- Mobile-first responsive layout
- Smooth animations gated by `prefers-reduced-motion`
- High-quality imagery (Cloudflare Images, AVIF/WebP)
- Brand-derived color palette
- Title, meta, OG card, Twitter card, JSON-LD all set
- WCAG 2.2 AA accessibility passing axe-core
- HTTPS with automatic SSL

The site is fully functional. Contact forms route to your inbox via Resend. Phone numbers are click-to-call on mobile. Maps embed cleanly. Google can crawl it on day one.

## Step 6 — Edit and customize (optional, ten plus minutes)

If you want to change something, you have three paths.

### Path A — AI editor, no coding

Click **Edit in the AI editor** from the dashboard. The visual editor opens with a chat box on the right.

You can:

- Drag-and-drop sections
- Edit any text inline, with AI help for tone and length
- Swap images (upload your own or search stock)
- Pick from your extracted palette or pin a new color
- Add or remove pages
- Describe a change in chat and let the model do it: "make the hero photo warmer," "add a pricing tier between Pro and Enterprise," "shorten the about paragraph by half"

No HTML, no CSS, no coding. Publish when you're done.

### Path B — Custom domain, no coding

Your site lives at `{slug}.projectsites.dev` by default. To use your own domain:

1. **Settings → Domains → Add custom domain**
2. Enter your domain (e.g. `vitos-salon.com`)
3. Add a CNAME record at your registrar pointing at us
4. Wait about five minutes for DNS to propagate
5. Your site appears at your domain with automatic SSL

### Path C — Export and deploy yourself, for developers

The site is a React + Vite project. Download it as a zip.

- Deploy to Vercel, Netlify, Cloudflare Pages, GitHub Pages, your own server
- Customize the React components, add your own backend, integrate a SaaS API
- Use it as a starting point for a custom build

Dashboard → Settings → Export → Download zip. The archive includes `package.json`, all components, Tailwind config, build scripts, and the public assets. Run `npm install && npm run build`, deploy the `dist/` directory anywhere.

## A real example: Vito's Mens Salon

Let's walk through a real case.

**The input.** Search for "Vito's Mens Salon" in our box. Google Places returns the listing: 74 N Beverwyck Rd, Lake Hiawatha NJ; (973) 555-1234; Mon–Fri 9–6, Sat 8–5, closed Sun; 4.8 stars on 89 Google reviews; twelve photos. You also upload the navy-blue wordmark logo, three storefront photos from your phone, and a link to the shop's Facebook page.

**What the AI extracts.**

- Brand colors: navy blue (#1e3a5f) from the wordmark; gold accent (#d4af37) from storefront signage
- Logo font: Poppins
- Tone from Facebook: welcoming, professional, third-generation Italian-American
- Services: haircuts, straight-razor shaves, beard grooming
- Story angle: "family-owned since 1987"

**What lands on the live site.**

- **Homepage** — "Classic barbershop. Modern haircuts." Hero photo of Vito mid-cut. Three value props ("expert craftsmen / walk-ins welcome / since 1987"). Book CTA opens the booking widget. Six images. Google reviews embed. Hours + map. FAQ.
- **About** — story of the shop, third-generation history, philosophy.
- **Services** — haircut, straight-razor, beard work — prices, descriptions.
- **Contact** — map, hours, click-to-call, contact form, social links.
- **Blog** — three starter posts ("how to maintain a beard between visits," "the history of the straight-razor shave," "why barbershops matter in local communities") that you can keep, edit, or delete.

Time from search to published: six minutes.

## Now what?

You have a published website. Here are the four paths most operators take.

**Iterate.** Spot something you want to change. Click **Edit**. Describe the change in the chat. Publish again. Every change is a snapshot — you can revert anytime in the next thirty days (Starter) or ninety days (Pro).

**Build more.** Sign out, search a new business, build another site. Pro plan is unlimited.

**Sell the site.** Agencies use Project Sites as a delivery pipeline. Your cost on a single client site is about fifty dollars of subscription plus a dollar or two of API metered overage. Selling that finished site for two to five thousand dollars puts you at 50–100x margin. The client owns the domain and can export the code.

**Manage client sites.** Set up a client portal where clients request edits via the AI editor. You review and publish. Charge them monthly maintenance ($200–$500). Pocket the spread.

## Common questions

**Can I use the same domain for two sites?** Not directly. Each site needs its own domain. Pro plan covers unlimited sites and unlimited domains.

**What if the AI gets the business wrong?** Reset and rebuild with sharper inputs, or fix the wrong parts in the AI editor. If the output is hopeless, email brian@megabyte.space and we'll do a manual rebuild ($500).

**Can I automate this for a hundred clients?** Yes. The control-plane has an API. Programmatically create sites, pass in business data, get back published URLs. See `/docs/api` once you're ready.

**Can I white-label?** Pro plan, yes. Rebrand the editor with your agency logo, swap the default subdomain suffix for your domain.

## Power-user tips

**Spend ten minutes on the details form.** A one-word category ("salon") produces a generic site. A specific brief ("high-end unisex salon, eco-conscious products, LGBTQ+ affirming, appointment-only, weekend-only walk-ins") produces a site that feels bespoke.

**Override the brand colors.** If the AI guessed wrong, drop the exact hex codes in the **Brand** tab. The site regenerates with those colors.

**Use snapshots aggressively.** Every edit creates one. Hate the new copy? **Revert to previous snapshot**. Snapshots live thirty days on Starter, ninety on Pro.

**Pre-flight before handing off to a client.** Verify Google Business Profile is claimed. Confirm DNS is fully propagated. Test contact form and click-to-call. View page source and check title / description / OG tags. Run PageSpeed Insights against the live URL.

## Next steps

1. **Search** for a business you can use as your first build
2. **Build** — fill the details and watch the AI do the work
3. **Show someone** — the fifteen-minute timeline is the demo
4. **Iterate** in the AI editor until it sings
5. **Upgrade** to Pro when you outgrow five sites or want a team

Welcome aboard. Let's ship something good.

```json
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "Getting Started — Project Sites",
  "author": { "@type": "Person", "name": "Brian Zalewski", "url": "https://megabyte.space" },
  "datePublished": "2026-05-26",
  "image": "https://projectsites.dev/r2/docs/getting-started-hero.avif",
  "description": "From zero to published website in about fifteen minutes. A real walkthrough.",
  "wordCount": 1524,
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```
