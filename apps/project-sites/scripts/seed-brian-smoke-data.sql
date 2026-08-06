-- seed-brian-smoke-data.sql — realistic TEST DATA for brian@megabyte.space so a human
-- smoke test of /admin shows EVERY section POPULATED (not empty-where-data-should-be).
-- Idempotent (INSERT OR IGNORE, fixed `smoke-*` ids). Scoped to org-brian-001 /
-- site-megabytespace-001 / user-brian-001. Themed: Megabyte Space, a Phoenix coworking +
-- maker space. NON-DESTRUCTIVE additive rows only — no real emails/charges/outreach.
-- Clean up any time: DELETE ... WHERE id LIKE 'smoke-%' (or the noted session ids).

-- ── Forms (form_submissions) ─────────────────────────────────────────────
INSERT OR IGNORE INTO form_submissions (id, site_id, org_id, form_name, email, payload, status, created_at) VALUES
 ('smoke-fs-1','site-megabytespace-001','org-brian-001','Contact','sarah.kim@example.com','{"name":"Sarah Kim","message":"Interested in a coworking membership — do you offer day passes?"}','received',datetime('now','-1 days')),
 ('smoke-fs-2','site-megabytespace-001','org-brian-001','Contact','marcus.lee@example.com','{"name":"Marcus Lee","message":"Can I book the maker space for a soldering workshop next month?"}','forwarded',datetime('now','-3 days')),
 ('smoke-fs-3','site-megabytespace-001','org-brian-001','Membership','diego.alvarez@example.com','{"name":"Diego Alvarez","plan":"Dedicated Desk","message":"Ready to sign up for a dedicated desk."}','received',datetime('now','-4 days')),
 ('smoke-fs-4','site-megabytespace-001','org-brian-001','Tour Request','priya.nair@example.com','{"name":"Priya Nair","message":"Would love a tour this week — Thursday afternoon?"}','received',datetime('now','-2 days')),
 ('smoke-fs-5','site-megabytespace-001','org-brian-001','Contact','jordan.blake@example.com','{"name":"Jordan Blake","message":"Do you have 3D printers available for members?"}','forwarded',datetime('now','-6 days')),
 ('smoke-fs-6','site-megabytespace-001','org-brian-001','Event Space','emma.chen@example.com','{"name":"Emma Chen","message":"Pricing for renting the event space for a 40-person meetup?"}','received',datetime('now','-8 hours'));

-- ── Leads (Lead Scanner) ─────────────────────────────────────────────────
INSERT OR IGNORE INTO leads (id, site_id, org_id, source_form, name, email, phone, message, status, created_at, updated_at) VALUES
 ('smoke-lead-1','site-megabytespace-001','org-brian-001','Contact','Sarah Kim','sarah.kim@example.com','+1-602-555-0134','Coworking membership — day passes?','new',datetime('now','-1 days'),datetime('now','-1 days')),
 ('smoke-lead-2','site-megabytespace-001','org-brian-001','Membership','Diego Alvarez','diego.alvarez@example.com','+1-480-555-0199','Dedicated desk signup','qualified',datetime('now','-4 days'),datetime('now','-2 days')),
 ('smoke-lead-3','site-megabytespace-001','org-brian-001','Tour Request','Priya Nair','priya.nair@example.com','+1-602-555-0177','Tour request Thursday','contacted',datetime('now','-2 days'),datetime('now','-1 days')),
 ('smoke-lead-4','site-megabytespace-001','org-brian-001','Event Space','Emma Chen','emma.chen@example.com','+1-623-555-0143','40-person meetup space','new',datetime('now','-8 hours'),datetime('now','-8 hours')),
 ('smoke-lead-5','site-megabytespace-001','org-brian-001','Contact','Marcus Lee','marcus.lee@example.com','+1-480-555-0121','Maker space workshop','won',datetime('now','-3 days'),datetime('now','-1 days')),
 ('smoke-lead-6','site-megabytespace-001','org-brian-001','Contact','Jordan Blake','jordan.blake@example.com',NULL,'3D printer access','lost',datetime('now','-6 days'),datetime('now','-4 days'));

-- ── Social accounts + posts ──────────────────────────────────────────────
INSERT OR IGNORE INTO social_accounts (id, org_id, created_by, platform, external_id, handle, display_name, status, created_at, updated_at) VALUES
 ('smoke-sa-1','org-brian-001','user-brian-001','twitter','tw_mbs_001','@megabytespace','Megabyte Space','connected',datetime('now','-25 days'),datetime('now','-1 days')),
 ('smoke-sa-2','org-brian-001','user-brian-001','linkedin','li_mbs_002','megabyte-space','Megabyte Space','connected',datetime('now','-25 days'),datetime('now','-2 days')),
 ('smoke-sa-3','org-brian-001','user-brian-001','instagram','ig_mbs_003','megabytespace','Megabyte Space','connected',datetime('now','-20 days'),datetime('now','-3 days'));

INSERT OR IGNORE INTO social_posts (id, site_id, org_id, platform, caption, hashtags, aspect_ratio, status, scheduled_for, posted_at, created_at, updated_at) VALUES
 ('smoke-sp-1','site-megabytespace-001','org-brian-001','twitter','Grand reopening Saturday! New 3D printers, laser cutter, and a fresh cold brew tap. ☕🛠️','#coworking #phoenix #makerspace','1:1','posted',NULL,datetime('now','-2 days'),datetime('now','-3 days'),datetime('now','-2 days')),
 ('smoke-sp-2','site-megabytespace-001','org-brian-001','linkedin','Now offering dedicated desks for Phoenix founders. Fast fiber, meeting rooms, and a community that ships.','#startups #phoenix','16:9','posted',NULL,datetime('now','-5 days'),datetime('now','-6 days'),datetime('now','-5 days')),
 ('smoke-sp-3','site-megabytespace-001','org-brian-001','instagram','Member spotlight: Priya just launched her hardware startup from Bench 12. 🚀','#buildinpublic','4:5','scheduled',datetime('now','+2 days'),NULL,datetime('now','-1 days'),datetime('now','-1 days')),
 ('smoke-sp-4','site-megabytespace-001','org-brian-001','twitter','Soldering 101 workshop next Thursday — 6pm, free for members. Limited to 12 seats.','#workshop #electronics','1:1','scheduled',datetime('now','+4 days'),NULL,datetime('now','-12 hours'),datetime('now','-12 hours')),
 ('smoke-sp-5','site-megabytespace-001','org-brian-001','linkedin','We hit 100 members this month. Thank you, Phoenix. ❤️','#milestone','16:9','draft',NULL,NULL,datetime('now','-4 hours'),datetime('now','-4 hours'));

-- ── Installed apps ───────────────────────────────────────────────────────
INSERT OR IGNORE INTO app_instances (id, org_id, created_by, app_slug, subdomain, status, last_started_at, created_at, updated_at) VALUES
 ('smoke-app-1','org-brian-001','user-brian-001','listmonk','mbs-mail','running',datetime('now','-2 days'),datetime('now','-12 days'),datetime('now','-2 days')),
 ('smoke-app-2','org-brian-001','user-brian-001','plane','mbs-projects','running',datetime('now','-1 days'),datetime('now','-9 days'),datetime('now','-1 days')),
 ('smoke-app-3','org-brian-001','user-brian-001','chatwoot','mbs-support','stopped',datetime('now','-7 days'),datetime('now','-14 days'),datetime('now','-7 days'));

-- ── Custom domains (hostnames) ───────────────────────────────────────────
INSERT OR IGNORE INTO hostnames (id, org_id, site_id, hostname, type, status, is_primary, created_at, updated_at) VALUES
 ('smoke-host-1','org-brian-001','site-megabytespace-001','megabytespace.com','custom_cname','active',1,datetime('now','-18 days'),datetime('now','-18 days')),
 ('smoke-host-2','org-brian-001','site-megabytespace-001','www.megabytespace.com','custom_cname','active',0,datetime('now','-18 days'),datetime('now','-18 days'));

-- ── Notifications (bell) ─────────────────────────────────────────────────
INSERT OR IGNORE INTO notifications (id, user_id, org_id, type, title, message, action_url, read, created_at) VALUES
 ('smoke-notif-1','user-brian-001','org-brian-001','feedback_received','New lead captured','Sarah Kim submitted your contact form.','/admin/leads',0,datetime('now','-1 days')),
 ('smoke-notif-2','user-brian-001','org-brian-001','feedback_received','New form submission','Emma Chen asked about the event space.','/admin/forms',0,datetime('now','-8 hours')),
 ('smoke-notif-3','user-brian-001','org-brian-001','billing_reminder','Payment received','Your Pro plan renewed successfully.','/admin/billing',1,datetime('now','-10 days')),
 ('smoke-notif-4','user-brian-001','org-brian-001','announcement','Post published','Your Twitter post about the grand reopening went live.','/admin/social',1,datetime('now','-2 days')),
 ('smoke-notif-5','user-brian-001','org-brian-001','site_published','Site published','megabytespace.projectsites.dev is live.','/admin/snapshots',1,datetime('now','-3 days'));

-- ── Billing (subscription) ───────────────────────────────────────────────
INSERT OR IGNORE INTO subscriptions (id, org_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, created_at, updated_at) VALUES
 ('smoke-sub-1','org-brian-001','cus_smoke_brian','sub_smoke_brian','paid','active',datetime('now','-12 days'),datetime('now','+18 days'),datetime('now','-12 days'),datetime('now','-1 days'));

-- ── Contacts (CRM / analytics) ───────────────────────────────────────────
INSERT OR IGNORE INTO contacts (id, org_id, site_id, email, name, source, first_seen_at, last_seen_at, created_at, updated_at) VALUES
 ('smoke-contact-1','org-brian-001','site-megabytespace-001','sarah.kim@example.com','Sarah Kim','form',datetime('now','-1 days'),datetime('now','-1 days'),datetime('now','-1 days'),datetime('now','-1 days')),
 ('smoke-contact-2','org-brian-001','site-megabytespace-001','marcus.lee@example.com','Marcus Lee','form',datetime('now','-6 days'),datetime('now','-3 days'),datetime('now','-6 days'),datetime('now','-3 days')),
 ('smoke-contact-3','org-brian-001','site-megabytespace-001','diego.alvarez@example.com','Diego Alvarez','form',datetime('now','-4 days'),datetime('now','-2 days'),datetime('now','-4 days'),datetime('now','-2 days')),
 ('smoke-contact-4','org-brian-001','site-megabytespace-001','priya.nair@example.com','Priya Nair','newsletter',datetime('now','-9 days'),datetime('now','-1 days'),datetime('now','-9 days'),datetime('now','-1 days')),
 ('smoke-contact-5','org-brian-001','site-megabytespace-001','emma.chen@example.com','Emma Chen','form',datetime('now','-8 hours'),datetime('now','-8 hours'),datetime('now','-8 hours'),datetime('now','-8 hours')),
 ('smoke-contact-6','org-brian-001','site-megabytespace-001','jordan.blake@example.com','Jordan Blake','social',datetime('now','-6 days'),datetime('now','-6 days'),datetime('now','-6 days'),datetime('now','-6 days'));

-- ── Newsletter subscribers ───────────────────────────────────────────────
INSERT OR IGNORE INTO newsletter_subscribers (id, site_id, email, segment, confirmed, unsubscribed, created_at) VALUES
 ('smoke-news-1','site-megabytespace-001','sarah.kim@example.com','members',1,0,datetime('now','-8 days')),
 ('smoke-news-2','site-megabytespace-001','priya.nair@example.com','members',1,0,datetime('now','-9 days')),
 ('smoke-news-3','site-megabytespace-001','diego.alvarez@example.com','prospects',1,0,datetime('now','-4 days')),
 ('smoke-news-4','site-megabytespace-001','emma.chen@example.com','prospects',0,0,datetime('now','-8 hours')),
 ('smoke-news-5','site-megabytespace-001','jordan.blake@example.com','members',1,1,datetime('now','-6 days'));

-- ── AI env vars (Settings) ───────────────────────────────────────────────
INSERT OR IGNORE INTO ai_env_vars (id, org_id, scope, key, value_encrypted, description, is_secret, created_by, created_at, updated_at) VALUES
 ('smoke-env-1','org-brian-001','org','OPENAI_API_KEY','c21va2UtcGxhY2Vob2xkZXItbm90LWEtcmVhbC1rZXk=','OpenAI key for AI copy + image generation',1,'user-brian-001',datetime('now','-12 days'),datetime('now','-12 days')),
 ('smoke-env-2','org-brian-001','org','GA4_MEASUREMENT_ID','c21va2UtZzRtZWFzdXJlbWVudA==','Google Analytics 4 measurement id',0,'user-brian-001',datetime('now','-12 days'),datetime('now','-12 days')),
 ('smoke-env-3','org-brian-001','site','MAPBOX_TOKEN','c21va2UtbWFwYm94LXRva2Vu','Mapbox token for the location map',1,'user-brian-001',datetime('now','-10 days'),datetime('now','-10 days'));

-- ── Recent visitor_events (pageviews + conversions) so the analytics 7d ──
-- default window is POPULATED (not "1 pageview"). session ids `smoke-sess-*`.
INSERT OR IGNORE INTO visitor_events (id, org_id, site_id, session_id, event_type, path, referrer, metadata, created_at) VALUES
 ('smoke-pv-1','org-brian-001','site-megabytespace-001','smoke-sess-1','pageview','/','https://www.google.com/','{"device":"desktop","channel":"organic","country":"US"}',datetime('now','-6 hours')),
 ('smoke-pv-2','org-brian-001','site-megabytespace-001','smoke-sess-1','pageview','/membership','','{"device":"desktop","channel":"organic","country":"US"}',datetime('now','-6 hours')),
 ('smoke-pv-3','org-brian-001','site-megabytespace-001','smoke-sess-2','pageview','/','https://t.co/','{"device":"mobile","channel":"social","country":"US"}',datetime('now','-1 days')),
 ('smoke-pv-4','org-brian-001','site-megabytespace-001','smoke-sess-2','pageview','/maker-space','','{"device":"mobile","channel":"social","country":"US"}',datetime('now','-1 days')),
 ('smoke-pv-5','org-brian-001','site-megabytespace-001','smoke-sess-3','pageview','/','https://www.linkedin.com/','{"device":"desktop","channel":"social","country":"CA"}',datetime('now','-2 days')),
 ('smoke-pv-6','org-brian-001','site-megabytespace-001','smoke-sess-3','pageview','/contact','','{"device":"desktop","channel":"social","country":"CA"}',datetime('now','-2 days')),
 ('smoke-pv-7','org-brian-001','site-megabytespace-001','smoke-sess-4','pageview','/','','{"device":"mobile","channel":"direct","country":"US"}',datetime('now','-3 days')),
 ('smoke-pv-8','org-brian-001','site-megabytespace-001','smoke-sess-5','pageview','/events','https://www.google.com/','{"device":"desktop","channel":"organic","country":"MX"}',datetime('now','-3 days')),
 ('smoke-pv-9','org-brian-001','site-megabytespace-001','smoke-sess-6','pageview','/','https://www.google.com/','{"device":"tablet","channel":"organic","country":"US"}',datetime('now','-4 days')),
 ('smoke-pv-10','org-brian-001','site-megabytespace-001','smoke-sess-6','pageview','/pricing','','{"device":"tablet","channel":"organic","country":"US"}',datetime('now','-4 days')),
 ('smoke-pv-11','org-brian-001','site-megabytespace-001','smoke-sess-7','pageview','/','https://www.bing.com/','{"device":"desktop","channel":"organic","country":"US"}',datetime('now','-5 days')),
 ('smoke-pv-12','org-brian-001','site-megabytespace-001','smoke-sess-8','pageview','/membership','','{"device":"mobile","channel":"direct","country":"US"}',datetime('now','-5 days')),
 ('smoke-conv-1','org-brian-001','site-megabytespace-001','smoke-sess-2','conversion','/contact','','{"device":"mobile","channel":"social","country":"US","kind":"form_submit"}',datetime('now','-1 days')),
 ('smoke-conv-2','org-brian-001','site-megabytespace-001','smoke-sess-3','conversion','/contact','','{"device":"desktop","channel":"social","country":"CA","kind":"form_submit"}',datetime('now','-2 days')),
 ('smoke-conv-3','org-brian-001','site-megabytespace-001','smoke-sess-5','conversion','/events','','{"device":"desktop","channel":"organic","country":"MX","kind":"form_submit"}',datetime('now','-3 days')),
 ('smoke-conv-4','org-brian-001','site-megabytespace-001','smoke-sess-8','conversion','/membership','','{"device":"mobile","channel":"direct","country":"US","kind":"signup"}',datetime('now','-5 hours'));
