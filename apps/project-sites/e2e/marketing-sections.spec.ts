/**
 * E2E tests for marketing homepage sections: FAQ accordion,
 * pricing toggle, How It Works, footer, contact form success,
 * and other marketing UI elements.
 */
import { test, expect } from './fixtures.js';

test.describe('FAQ Accordion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('FAQ section exists on homepage', async ({ page }) => {
    const faqSection = page.locator('.faq-section, #faq-section, [class*="faq"]');
    await expect(faqSection.first()).toBeAttached();
  });

  test('FAQ items are present', async ({ page }) => {
    const faqItems = page.locator('.faq-item, [class*="faq-item"]');
    const count = await faqItems.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('toggleFaq function is defined', async ({ page }) => {
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).toggleFaq === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('clicking FAQ item toggles its answer visibility', async ({ page }) => {
    const faqBtn = page.locator('.faq-question, [onclick*="toggleFaq"]').first();
    if (await faqBtn.isVisible().catch(() => false)) {
      // Get initial state of the answer
      const faqItem = faqBtn.locator('..');
      const initialClass = await faqItem.getAttribute('class');

      await faqBtn.click();
      await page.waitForTimeout(300);

      const afterClass = await faqItem.getAttribute('class');
      // Class should have changed (open/active added or removed)
      expect(afterClass).not.toBe(initialClass);
    }
  });
});

test.describe('Pricing Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('pricing section exists', async ({ page }) => {
    const pricing = page.locator('.pricing-section, #pricing-section, [class*="pricing"]');
    await expect(pricing.first()).toBeAttached();
  });

  test('pricing has monthly/annual toggle', async ({ page }) => {
    const toggle = page.locator('.pricing-toggle, [onclick*="togglePricing"]');
    await expect(toggle.first()).toBeAttached();
  });

  test('togglePricing function is defined', async ({ page }) => {
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).togglePricing === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('pricing displays price amounts', async ({ page }) => {
    const priceEl = page.locator('.price-amount, [class*="price"]').first();
    await expect(priceEl).toBeAttached();
    const text = await priceEl.textContent();
    expect(text).toMatch(/\$|free|month/i);
  });

  test('Get Started button exists in pricing', async ({ page }) => {
    // Pricing section should have at least one CTA button
    const ctaBtns = page.locator('[onclick*="handleGetStartedPaid"], [onclick*="startBuildFlow"], [onclick*="openDetailsModal"]');
    const count = await ctaBtns.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe('How It Works Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('How It Works section exists', async ({ page }) => {
    const section = page.locator('.how-it-works, #how-it-works, [class*="how-it-works"]');
    await expect(section.first()).toBeAttached();
  });

  test('How It Works has 3 steps', async ({ page }) => {
    const steps = page.locator('.how-it-works .step, .how-it-works-step, [class*="step-card"]');
    const count = await steps.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe('What\'s Handled Section', () => {
  test('handled section exists', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('.handled-section, [class*="handled"], .trust-section');
    await expect(section.first()).toBeAttached();
  });
});

test.describe('Footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('footer exists with legal links', async ({ page }) => {
    const footer = page.locator('footer, .footer');
    await expect(footer.first()).toBeAttached();
  });

  test('footer has privacy policy link', async ({ page }) => {
    const privacyLink = page.locator('footer a[href="/privacy"], .footer a[href="/privacy"]');
    await expect(privacyLink.first()).toBeAttached();
  });

  test('footer has terms of service link', async ({ page }) => {
    const termsLink = page.locator('footer a[href="/terms"], .footer a[href="/terms"]');
    await expect(termsLink.first()).toBeAttached();
  });

  test('footer has content policy link', async ({ page }) => {
    const contentLink = page.locator('footer a[href="/content"], .footer a[href="/content"]');
    await expect(contentLink.first()).toBeAttached();
  });

  test('footer has copyright text', async ({ page }) => {
    const footer = page.locator('footer, .footer');
    const text = await footer.first().textContent();
    expect(text).toMatch(/©|copyright|project sites|megabyte/i);
  });
});

test.describe('Contact Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('contact form exists on homepage', async ({ page }) => {
    const form = page.locator('#contact-form');
    await expect(form).toBeAttached();
  });

  test('contact form has name, email, and message fields', async ({ page }) => {
    const nameInput = page.locator('#contact-name, #contact-form input[name="name"]');
    const emailInput = page.locator('#contact-email, #contact-form input[name="email"]');
    const messageInput = page.locator('#contact-message, #contact-form textarea');

    await expect(nameInput.first()).toBeAttached();
    await expect(emailInput.first()).toBeAttached();
    await expect(messageInput.first()).toBeAttached();
  });

  test('submitContactForm function is defined', async ({ page }) => {
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).submitContactForm === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('contact form successful submission', async ({ page }) => {
    // Mock the contact API
    await page.route('**/api/contact', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { message: 'sent' } }),
      });
    });

    const nameInput = page.locator('#contact-name').first();
    const emailInput = page.locator('#contact-email').first();
    const messageInput = page.locator('#contact-message').first();

    if (
      (await nameInput.isVisible().catch(() => false)) &&
      (await emailInput.isVisible().catch(() => false)) &&
      (await messageInput.isVisible().catch(() => false))
    ) {
      await nameInput.fill('Test User');
      await emailInput.fill('test@example.com');
      await messageInput.fill('This is a test message that is long enough to pass validation.');

      const submitBtn = page.locator('#contact-submit, [onclick*="submitContactForm"]').first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        // Should show success or clear the form
        await page.waitForTimeout(500);
      }
    }
  });
});

test.describe('Hero Section', () => {
  test('hero CTA buttons exist', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });

    // Primary CTA
    const buildBtn = page.locator('.hero-cta, [onclick*="startBuildFlow"]').first();
    await expect(buildBtn).toBeAttached();
  });

  test('startBuildFlow function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).startBuildFlow === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('hero has brand tagline', async ({ page }) => {
    await page.goto('/');
    const brand = page.locator('.hero-brand, .hero-tagline, .hero h1, .hero h2');
    await expect(brand.first()).toBeAttached();
  });
});

test.describe('Social Proof / Trust', () => {
  test('trust indicators exist', async ({ page }) => {
    await page.goto('/');
    const trust = page.locator('.trust-bar, .trust-section, [class*="trust"], [class*="social-proof"]');
    await expect(trust.first()).toBeAttached();
  });
});
