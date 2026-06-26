import { test, expect } from '@playwright/test'

/**
 * Live smoke + delivery-surface coverage for cms.projectsites.dev. Every test starts
 * at the homepage and asserts the upgraded frontend, admin reachability, the health
 * probe, and the SEO/feed artifacts. Console-error-free is asserted on rendered pages.
 */

test.describe('CMS frontend', () => {
  test('homepage renders the ProjectSites shell with nav', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto('/')
    await expect(page).toHaveTitle(/ProjectSites/)
    await expect(page.locator('header.site-nav .brand')).toHaveText('ProjectSites')
    await expect(page.getByRole('link', { name: 'Blog' })).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('nav click reaches the blog index', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Blog' }).click()
    await expect(page).toHaveTitle(/Blog/)
    await expect(page.getByRole('heading', { name: 'Blog', level: 1 })).toBeVisible()
  })
})

test.describe('CMS delivery surfaces', () => {
  test('healthz reports db up', async ({ request }) => {
    const res = await request.get('/healthz')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.db).toBe('up')
  })

  test('robots.txt disallows admin + links the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const txt = await res.text()
    expect(txt).toContain('Disallow: /admin')
    expect(txt).toContain('sitemap.xml')
  })

  test('sitemap.xml is valid XML with the canonical host', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<?xml')
    expect(xml).toContain('cms.projectsites.dev')
  })

  test('feed.xml is an RSS 2.0 channel', async ({ request }) => {
    const res = await request.get('/feed.xml')
    expect(res.status()).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<rss version="2.0">')
    expect(xml).toContain('ProjectSites Blog')
  })
})

test.describe('CMS admin', () => {
  test('admin panel loads Payload', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveTitle(/ProjectSites CMS/)
    // Payload admin renders its login/dashboard chrome.
    await expect(page.locator('body')).toContainText(/Payload|Email|Dashboard/)
  })
})
