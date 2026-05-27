-- Performance indexes for hot read paths.

CREATE INDEX IF NOT EXISTS pages_published_locale ON pages(published, locale);
CREATE INDEX IF NOT EXISTS posts_published_published_at ON posts(published, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_tags ON posts(tags_json);
CREATE INDEX IF NOT EXISTS orders_status_created ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_email);
CREATE INDEX IF NOT EXISTS contact_created ON contact_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS newsletter_locale ON newsletter_subscribers(locale, confirmed);
CREATE INDEX IF NOT EXISTS webhook_events_received ON webhook_events(received_at DESC);
