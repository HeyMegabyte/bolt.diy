/**
 * llmLandingPage — the static landing served at `llm.projectsites.dev/`.
 * The host-routing (only the gateway host gets it; others fall through) is
 * verified live post-deploy via curl; here we assert the page content.
 */
import { llmLandingPage } from '../lib/llm_landing_page.js';

describe('llmLandingPage', () => {
  const html = llmLandingPage();

  it('is a complete HTML document with a per-route title + canonical', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>LLM Gateway · ProjectSites</title>');
    expect(html).toContain('<link rel="canonical" href="https://llm.projectsites.dev/">');
    expect(html).toContain('name="description"');
  });

  it('advertises the OpenAI-compatible base URL + both endpoints', () => {
    expect(html).toContain('https://llm.projectsites.dev/v1');
    expect(html).toContain('/v1/models');
    expect(html).toContain('/v1/chat/completions');
  });

  it('shows a runnable curl quick-start with a Bearer auth header', () => {
    expect(html).toContain('curl');
    expect(html).toContain('Authorization: Bearer');
    expect(html).toContain('chat/completions');
  });

  it('links back to the dashboard + marketing site', () => {
    expect(html).toContain('https://projectsites.dev/admin');
    expect(html).toContain('https://projectsites.dev');
  });
});
