-- 30 big-bet features schema. Idempotent.

-- A: Customer-facing engines (1-8)
CREATE TABLE IF NOT EXISTS visual_editor_projects (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, layout_json TEXT, breakpoint TEXT DEFAULT 'desktop', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ecommerce_products (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, price_cents INTEGER NOT NULL, currency TEXT DEFAULT 'USD', sku TEXT, inventory_qty INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ecommerce_orders (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, customer_email TEXT, total_cents INTEGER NOT NULL, status TEXT DEFAULT 'pending', stripe_session_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_slots (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, capacity INTEGER DEFAULT 1, booked_count INTEGER DEFAULT 0, price_cents INTEGER DEFAULT 0, status TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS booking_reservations (id TEXT PRIMARY KEY, slot_id TEXT NOT NULL, customer_email TEXT NOT NULL, status TEXT DEFAULT 'confirmed', stripe_payment_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lms_courses (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, title TEXT NOT NULL, modules_json TEXT NOT NULL, price_cents INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lms_enrollments (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, student_email TEXT NOT NULL, progress_pct REAL DEFAULT 0, completed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS community_topics (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, title TEXT NOT NULL, author_email TEXT, body TEXT, reply_count INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS community_replies (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, author_email TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter_campaigns (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT NOT NULL, segment TEXT DEFAULT 'all', status TEXT DEFAULT 'draft', scheduled_at TEXT, sent_count INTEGER DEFAULT 0, opens INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter_subscribers (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, email TEXT NOT NULL, segment TEXT, confirmed INTEGER DEFAULT 0, unsubscribed INTEGER DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(site_id, email));
CREATE TABLE IF NOT EXISTS membership_tiers (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, price_cents INTEGER NOT NULL, billing_cycle TEXT DEFAULT 'monthly', perks_json TEXT, stripe_price_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS membership_subscriptions (id TEXT PRIMARY KEY, tier_id TEXT NOT NULL, member_email TEXT NOT NULL, status TEXT DEFAULT 'active', stripe_subscription_id TEXT, started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS donation_campaigns (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, goal_cents INTEGER, raised_cents INTEGER DEFAULT 0, donor_count INTEGER DEFAULT 0, ends_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS donations (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, donor_email TEXT, amount_cents INTEGER NOT NULL, recurring INTEGER DEFAULT 0, anonymous INTEGER DEFAULT 0, memorial TEXT, stripe_payment_id TEXT, created_at TEXT NOT NULL);

-- B: Native + multi-platform (9-12)
CREATE TABLE IF NOT EXISTS mobile_admin_installs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT CHECK(platform IN ('ios','android')), device_id TEXT, app_version TEXT, push_token TEXT, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desktop_admin_installs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT CHECK(platform IN ('macos','windows','linux')), app_version TEXT, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS browser_extension_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, browser TEXT, version TEXT, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chatops_connections (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, platform TEXT CHECK(platform IN ('slack','teams','discord')), workspace_name TEXT, webhook_url TEXT, scopes_json TEXT, created_at TEXT NOT NULL);

-- C: Enterprise compliance (13-16)
CREATE TABLE IF NOT EXISTS soc2_controls (id TEXT PRIMARY KEY, control_id TEXT NOT NULL, family TEXT, description TEXT, status TEXT DEFAULT 'planned' CHECK(status IN ('planned','in_progress','operating','tested','passed')), evidence_json TEXT, owner_email TEXT, last_tested_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hipaa_baas (id TEXT PRIMARY KEY, customer_org_id TEXT NOT NULL, business_name TEXT, signed_at TEXT, expires_at TEXT, pdf_r2_key TEXT, status TEXT DEFAULT 'pending' CHECK(status IN ('pending','signed','expired')));
CREATE TABLE IF NOT EXISTS pci_tokens (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, last4 TEXT, brand TEXT, token TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sso_connections (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, protocol TEXT CHECK(protocol IN ('saml','oidc')), idp_metadata_url TEXT, idp_entity_id TEXT, certificate TEXT, attribute_mapping_json TEXT, status TEXT DEFAULT 'pending', created_at TEXT NOT NULL);

-- D: Infrastructure depth (17-20)
CREATE TABLE IF NOT EXISTS d1_replication_state (region TEXT PRIMARY KEY, last_bookmark TEXT, lag_ms INTEGER DEFAULT 0, healthy INTEGER DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS byo_cloudflare_accounts (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, cf_account_id TEXT NOT NULL, oauth_token_encrypted TEXT, status TEXT DEFAULT 'pending', connected_at TEXT);
CREATE TABLE IF NOT EXISTS worker_marketplace_listings (id TEXT PRIMARY KEY, author_org_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, source_code_r2_key TEXT, price_cents INTEGER DEFAULT 0, install_count INTEGER DEFAULT 0, rating_avg REAL DEFAULT 0, status TEXT DEFAULT 'draft', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS domain_reseller_inventory (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, domain TEXT NOT NULL, registrar TEXT DEFAULT 'opensrs', expires_at TEXT, auto_renew INTEGER DEFAULT 1, purchased_cents INTEGER NOT NULL, retail_cents INTEGER NOT NULL, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);

-- E: AI-native depth (21-25)
CREATE TABLE IF NOT EXISTS brand_voice_clones (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, sample_audio_r2_keys_json TEXT, elevenlabs_voice_id TEXT, consent_signed_at TEXT, status TEXT DEFAULT 'training', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_agent_listings (id TEXT PRIMARY KEY, author_org_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, mcp_tools_json TEXT, price_cents INTEGER DEFAULT 0, install_count INTEGER DEFAULT 0, rating_avg REAL DEFAULT 0, status TEXT DEFAULT 'draft', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_copilot_kbs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, vectorize_namespace TEXT, doc_count INTEGER DEFAULT 0, last_indexed_at TEXT, status TEXT DEFAULT 'indexing');
CREATE TABLE IF NOT EXISTS ai_video_courses (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, title TEXT NOT NULL, outline_text TEXT NOT NULL, lesson_count INTEGER NOT NULL, r2_keys_json TEXT, status TEXT DEFAULT 'generating', total_seconds INTEGER DEFAULT 0, cost_usd_cents INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_ab_experiments (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, goal TEXT NOT NULL, variants_json TEXT NOT NULL, traffic_split_json TEXT, winner_variant_id TEXT, status TEXT DEFAULT 'running', started_at TEXT NOT NULL);

-- F: Marketing + growth (26-30)
CREATE TABLE IF NOT EXISTS sms_campaigns (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, segment TEXT, sent_count INTEGER DEFAULT 0, opt_outs INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', scheduled_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sms_subscribers (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, phone TEXT NOT NULL, segment TEXT, confirmed INTEGER DEFAULT 0, opted_out INTEGER DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(site_id, phone));
CREATE TABLE IF NOT EXISTS affiliates (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, affiliate_email TEXT NOT NULL, code TEXT NOT NULL UNIQUE, commission_pct REAL DEFAULT 20.0, lifetime_revenue_cents INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS affiliate_referrals (id TEXT PRIMARY KEY, affiliate_id TEXT NOT NULL, referred_customer_id TEXT, conversion_cents INTEGER, commission_cents INTEGER, status TEXT DEFAULT 'pending', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loyalty_programs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, points_per_dollar REAL DEFAULT 10, tiers_json TEXT, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loyalty_members (id TEXT PRIMARY KEY, program_id TEXT NOT NULL, member_email TEXT NOT NULL, points_balance INTEGER DEFAULT 0, tier TEXT DEFAULT 'bronze', lifetime_points INTEGER DEFAULT 0, joined_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_deals (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT, value_cents INTEGER, stage TEXT DEFAULT 'lead' CHECK(stage IN ('lead','qualified','proposal','negotiation','won','lost')), owner_email TEXT, next_step TEXT, expected_close TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_activities (id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, kind TEXT CHECK(kind IN ('call','email','meeting','task','note')), body TEXT, completed INTEGER DEFAULT 0, due_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cdp_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, email TEXT, phone TEXT, traits_json TEXT, last_seen_at TEXT NOT NULL, identity_resolved INTEGER DEFAULT 0, source_count INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cdp_events (id TEXT PRIMARY KEY, profile_id TEXT, site_id TEXT NOT NULL, source TEXT CHECK(source IN ('web','sms','email','crm','sales','support')), kind TEXT NOT NULL, payload_json TEXT, ts TEXT NOT NULL);
