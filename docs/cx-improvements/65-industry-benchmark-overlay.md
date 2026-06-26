# CX Improvement #65 — Industry Benchmark Overlay in Analytics

> **Goal:** Customer opens `/admin/analytics`, sees their metric and a benchmark dashed line
> for their industry. "Your conversion rate (3.2%) vs salons (2.1% avg)" with AI commentary
> when below p50.

---

## 50 Sub-Ideas

### P0 — Ship this batch (top 8)
1. D1 schema `industry_benchmarks(industry, metric, p50, p75, p90, p99, samples_count, updated_at)`.
2. Seed 10 industries × 5 metrics (conversion_rate, bounce_rate, avg_session_duration_sec, pages_per_session, mobile_share).
3. `GET /api/admin/analytics/benchmarks?industry=salon` returns full benchmark row set.
4. `GET /api/admin/analytics/benchmarks/recommendation?site_id=X&metric=conversion_rate` — AI-generated tip when site < p50.
5. Service `industry_benchmarks.ts` with `getBenchmark`, `getAllForIndustry`, `recommendFor`.
6. Frontend: overlay dashed p50 line + chip "industry p50: 2.1%" on each analytics card.
7. AI commentary inline component: "You're below salon p50 — common levers: photo gallery on hero, online booking widget, etc."
8. Industry inference from site research data (cached `site.industry` column when present).

### P1 — Next sprint
9. Monthly cron aggregates anonymized stats across all sites → updates `industry_benchmarks`.
10. Sub-industry granularity (hair salon vs nail salon vs barber).
11. Geo-bracket overlay (US-CA, US-NY, EU-UK, etc).
12. Size bracket (1-employee, 2-10, 11-50).
13. Time-of-day benchmark (peak hour traffic share).
14. Day-of-week benchmark (Mon-Fri vs weekend ratio).
15. Seasonality overlay (Q4 vs Q1 conversion).
16. Device breakdown benchmark (mobile share).
17. Channel breakdown (organic vs paid vs social vs direct).
18. CTR per CTA position.
19. Form completion rate per form type.
20. Newsletter signup rate by industry.
21. Bounce rate per landing-page type (hero+CTA vs long-form).
22. Avg pages per session benchmark.
23. Returning visitor share benchmark.
24. Phone-click rate (local business).
25. Map-click rate (local business).

### P2 — Future polish
26. Peer comparison: anonymous cohort of 10 most-similar sites.
27. "Beat the benchmark" gamification badges.
28. Weekly email digest with benchmark deltas.
29. Sortable leaderboard per industry (opt-in).
30. AI-generated action plan: "3 specific changes to hit p75 in 30 days".
31. AB-test recommendation engine pre-loaded with industry-best CTAs.
32. Heatmap-derived benchmark (engagement zones per industry).
33. Lighthouse benchmark overlay (perf, SEO, a11y).
34. Page-weight benchmark (KB transferred).
35. LCP benchmark by industry.
36. Time-to-first-conversion benchmark.
37. Revenue-per-visitor benchmark.
38. Avg order value benchmark (ties into #58 orders).
39. Refund rate benchmark.
40. Customer-lifetime-value benchmark.
41. Industry trend lines: rolling 90-day p50 deltas.
42. Macroeconomic overlay (consumer confidence index correlation).
43. Competitor benchmark (named competitor URL → SimilarWeb data).
44. Auto-detect industry change via continuous site-research re-scoring.
45. Confidence intervals on each benchmark (sample size matters).
46. Compliance-mode benchmark sanitization (no individual site identifiable).
47. White-label benchmark report PDF export.
48. Slack-style notifications on benchmark breaches.
49. ROI calculator using industry CPA + CAC.
50. Public industry-report blog auto-published quarterly.

---

## Acceptance Criteria for P0
- [ ] Migration adds `industry_benchmarks` table with seed for 10 industries × 5 metrics.
- [ ] `GET /api/admin/analytics/benchmarks` returns valid JSON with all metrics.
- [ ] Frontend analytics overlays dashed industry line on each chart.
- [ ] Below-p50 commentary chip renders with AI-generated 1-sentence tip.
- [ ] Unit tests: 5+ (benchmark lookup, percentile math, industry inference, missing-industry graceful).
- [ ] E2E: open `/admin/analytics` → benchmark chip visible → AI tip renders when below p50.
