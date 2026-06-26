# CX Improvement #59 — AI Chat KB Auto-Trained from Site Content

> **Goal:** The site's own chat widget answers visitor questions from the actual site copy.
> Every publish reindexes paragraphs/headings into `site_kb_chunks`, embeddings stored in D1,
> retrieval via in-process cosine similarity → top-5 chunks injected into the LLM prompt.

---

## 50 Sub-Ideas

### P0 — Ship this batch (top 8)
1. D1 schema `site_kb_chunks(id, site_id, text, embedding BLOB, source_url, source_section, indexed_at)`.
2. Service `kb_indexer.ts` — extract paragraphs + headings from R2 HTML, chunk to ≤512 chars, embed via `@cf/baai/bge-base-en-v1.5`, write rows.
3. Service `kb_retriever.ts` — embed query, scan chunks, cosine similarity, return top-5.
4. Workflow step `index-kb` triggered on every snapshot publish (best-effort, non-blocking).
5. Extend `/api/sites/:slug/chat` (public widget endpoint) to inject retrieved chunks as system context.
6. `GET /api/sites/:siteId/kb` — admin endpoint: chunk count + last-indexed timestamp + 5 sample chunks.
7. `POST /api/sites/:siteId/kb/reindex` — manual re-index button in admin.
8. `POST /api/sites/:siteId/kb/test` — sample Q&A tester returning top-5 chunks + LLM reply.

### P1 — Next sprint
9. Chunk dedup via SHA-256 of normalized text.
10. PDF/DOCX upload + extraction → KB chunks (Mammoth + pdf-parse in container).
11. URL-allow-list: customer can paste external URLs (FAQ on Notion, Help Center) → scrape + index.
12. Hybrid retrieval: BM25 keyword + cosine, RRF-fused.
13. Cross-encoder rerank top-25 → top-5 via `@cf/baai/bge-reranker-base`.
14. Chunk metadata: question/answer pairs detected via regex.
15. Auto-generated FAQ from KB (cluster chunks, summarize each cluster).
16. Citation rendering in chat: every answer shows the source URL + section.
17. Negative feedback button on each answer → log to `ai_chat_feedback`.
18. KB freshness: stale-chunk warning when source page hasn't been re-indexed in 30 days.
19. Per-locale KB (English chunks vs Spanish vs Portuguese) keyed by locale prefix.
20. Token budget: only inject chunks under context budget (default 2000 tok).
21. Chat memory: previous user messages in this session feed into retrieval query expansion.
22. Topic clustering: K-means on embeddings → "Top 5 topics customers ask about".
23. Suggested-question chips in widget seeded from highest-clicked FAQ entries.
24. Visitor email capture before chat → leads pushed to forms inbox.
25. Office-hours mode: chat shows "We'll reply within X hours" outside business hours.

### P2 — Future polish
26. Voice input (Web Speech API).
27. Voice output (ElevenLabs or `@cf/openai/whisper`).
28. Multi-turn followups with anaphora resolution ("What about that?").
29. Function calling: book appointment, add to cart, send quote.
30. Agentic mode: chat can navigate the site for the visitor.
31. Vector index in Cloudflare Vectorize when chunks > 500 per site.
32. Hot-reload: edit a section in `/admin/editor` → instant re-index of that section.
33. Diff-based incremental indexing (re-embed only changed paragraphs).
34. Auto-translate Q&A to visitor's `Accept-Language`.
35. Sentiment analysis of visitor messages, escalate angry ones to human.
36. Anti-prompt-injection guardrails on visitor input.
37. PII redaction in chat logs (email, phone, SSN).
38. GDPR delete: customer requests deletion → erase chat history + KB references.
39. Knowledge gaps detector: cluster unanswered questions, suggest new FAQ entries.
40. Chat-to-email handoff when AI gives up (confidence < 0.5).
41. Slack/Discord notification when high-intent question detected.
42. Daily digest: top 10 questions + answers + confidence scores.
43. AB-test system prompts across visitor cohorts.
44. RAG eval harness: golden Q&A set, regression-tested on every model upgrade.
45. Token cost dashboard per site per month.
46. Self-hosted embedding model (BGE-base-en-v1.5 GGUF) for compliance customers.
47. White-label widget (no "Powered by ProjectSites").
48. Mobile-app SDK wrapper of the widget.
49. WhatsApp Business API bridge using same KB.
50. SMS bridge via Twilio using same KB.

---

## Acceptance Criteria for P0
- [ ] Migration `0026_live_site_features.sql` adds `site_kb_chunks` table.
- [ ] `kb_indexer.indexSite(siteId)` writes ≥1 chunk for any non-empty site.
- [ ] `kb_retriever.retrieveTop(siteId, query, 5)` returns 5 most similar chunks.
- [ ] Workflow step `index-kb` calls indexer; failure does NOT block publish.
- [ ] Chat endpoint extension injects retrieved chunks; falls back gracefully when KB empty.
- [ ] `/admin/settings` AI Chat tab → AI Knowledge subtab shows count + sample + reindex + tester.
- [ ] Unit tests: 6+ (chunking, embed, cosine math, top-k, dedup, retrieval).
- [ ] E2E: publish site → KB indexed → admin sees chunk count → tester returns relevant answer.
