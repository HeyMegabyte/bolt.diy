import { parseSiteCommand } from '../service.js';

describe('parseSiteCommand', () => {
  test('"change my hero headline to Best Pizza" → change_text, hero', () => {
    const r = parseSiteCommand('change my hero headline to Best Pizza in Brooklyn');
    expect(r.intent.action).toBe('change_text');
    expect(r.intent.target).toBe('hero');
    expect(r.intent.newValue).toContain('Best Pizza');
    expect(r.intent.confidence).toBeGreaterThan(0.8);
    expect(r.intent.clarificationNeeded).toBe(false);
  });

  test('"add a testimonial section" → add_section', () => {
    const r = parseSiteCommand('add a testimonial section with 3 reviews');
    expect(r.intent.action).toBe('add_section');
    expect(r.intent.target).toBe('testimonials');
  });

  test('"remove the banner" → remove_element', () => {
    const r = parseSiteCommand('remove the banner');
    expect(r.intent.action).toBe('remove_element');
    expect(r.intent.target).toBe('banner');
  });

  test('"update my phone number to 555-0123" → update_info', () => {
    const r = parseSiteCommand('update my phone number to 555-0123');
    expect(r.intent.action).toBe('update_info');
    expect(r.intent.newValue).toContain('555-0123');
  });

  test('"update the about section to our new story" → change_text', () => {
    const r = parseSiteCommand('update the about section to Our new story about the bakery');
    expect(r.intent.action).toBe('change_text');
    expect(r.intent.target).toBe('about');
  });

  test('"set footer text to Copyright 2026" → change_text', () => {
    const r = parseSiteCommand('set footer text to Copyright 2026 Tony\'s Pizza');
    expect(r.intent.target).toBe('footer');
    expect(r.intent.newValue).toContain('2026');
  });

  test('"add holiday hours for Christmas" → add_section', () => {
    const r = parseSiteCommand('add holiday hours for Christmas');
    expect(r.intent.action).toBe('add_section');
    expect(r.intent.target).toBe('holiday_hours');
  });

  test('"add a FAQ section" → add_section, faq', () => {
    const r = parseSiteCommand('add a FAQ section with common questions');
    expect(r.intent.action).toBe('add_section');
    expect(r.intent.target).toBe('faq');
  });

  test('"change pricing to start at $10" → change_text, pricing', () => {
    const r = parseSiteCommand('change pricing to start at $10 per service');
    expect(r.intent.target).toBe('pricing');
  });

  test('unknown command → clarification', () => {
    const r = parseSiteCommand('make it look better');
    expect(r.intent.action).toBe('unknown');
    expect(r.intent.clarificationNeeded).toBe(true);
    expect(r.intent.clarificationQuestion).toBeTruthy();
  });

  test('empty string → clarification', () => {
    const r = parseSiteCommand('');
    expect(r.intent.action).toBe('unknown');
    expect(r.intent.clarificationNeeded).toBe(true);
  });

  test('records current page', () => {
    const r = parseSiteCommand('change the heading', '/services');
    expect(r.intent.page).toBe('/services');
  });

  test('default page is /', () => {
    const r = parseSiteCommand('change the heading');
    expect(r.intent.page).toBe('/');
  });
});
