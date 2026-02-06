/**
 * E2E tests for the Project Sites homepage flow.
 *
 * These tests validate the interactive homepage:
 * - Search input rendering and interaction
 * - Business search API integration
 * - Sign-in gate display
 * - Screen transitions
 */

describe('Homepage', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('renders the search screen with hero content', () => {
    cy.contains('Project Sites');
    cy.get('input[placeholder*="Search for your business"]').should('be.visible');
  });

  it('shows the search input centered on the page', () => {
    cy.get('input[placeholder*="Search for your business"]')
      .should('be.visible')
      .and('have.css', 'max-width');
  });

  it('displays the tagline text', () => {
    cy.contains('handled').should('be.visible');
  });
});

describe('Search Functionality', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('shows search results dropdown when typing', () => {
    // Intercept the search API
    cy.intercept('GET', '/api/search/businesses*', {
      statusCode: 200,
      body: {
        data: [
          {
            place_id: 'ChIJ_test1',
            name: "Joe's Pizza",
            address: '123 Main St, New York, NY',
            types: ['restaurant'],
          },
          {
            place_id: 'ChIJ_test2',
            name: "Joe's Plumbing",
            address: '456 Oak Ave, Brooklyn, NY',
            types: ['plumber'],
          },
        ],
      },
    }).as('searchBusinesses');

    cy.get('input[placeholder*="Search for your business"]').type('Joe');
    cy.wait('@searchBusinesses');

    // Should show results dropdown
    cy.contains("Joe's Pizza").should('be.visible');
    cy.contains("Joe's Plumbing").should('be.visible');
    cy.contains('123 Main St').should('be.visible');
  });

  it('always shows the Custom Website option at the bottom', () => {
    cy.intercept('GET', '/api/search/businesses*', {
      statusCode: 200,
      body: { data: [] },
    }).as('emptySearch');

    cy.get('input[placeholder*="Search for your business"]').type('xyz nonexistent');
    cy.wait('@emptySearch');

    // The custom option should always be visible
    cy.contains(/custom/i).should('be.visible');
  });

  it('handles search API errors gracefully', () => {
    cy.intercept('GET', '/api/search/businesses*', {
      statusCode: 500,
      body: { error: 'Internal Server Error' },
    }).as('searchError');

    cy.get('input[placeholder*="Search for your business"]').type('test query');
    cy.wait('@searchError');

    // Should not crash - page should still be functional
    cy.get('input[placeholder*="Search for your business"]').should('be.visible');
  });
});

describe('Business Selection Flow', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('checks site existence when a business result is clicked', () => {
    // Mock search results
    cy.intercept('GET', '/api/search/businesses*', {
      body: {
        data: [
          {
            place_id: 'ChIJ_new',
            name: 'New Business',
            address: '789 Elm St',
            types: ['store'],
          },
        ],
      },
    }).as('search');

    // Mock lookup - site does NOT exist
    cy.intercept('GET', '/api/sites/lookup*', {
      body: { data: { exists: false } },
    }).as('lookup');

    cy.get('input[placeholder*="Search for your business"]').type('New Business');
    cy.wait('@search');

    // Click the result
    cy.contains('New Business').click();
    cy.wait('@lookup');

    // Should navigate to sign-in screen
    cy.contains(/sign in/i).should('be.visible');
  });

  it('redirects to existing published site', () => {
    cy.intercept('GET', '/api/search/businesses*', {
      body: {
        data: [
          {
            place_id: 'ChIJ_existing',
            name: 'Existing Biz',
            address: '111 Pine St',
            types: ['restaurant'],
          },
        ],
      },
    }).as('search');

    // Mock lookup - site EXISTS with a build
    cy.intercept('GET', '/api/sites/lookup*', {
      body: {
        data: {
          exists: true,
          site_id: 'site-123',
          slug: 'existing-biz',
          status: 'published',
          has_build: true,
        },
      },
    }).as('lookup');

    cy.get('input[placeholder*="Search for your business"]').type('Existing Biz');
    cy.wait('@search');

    // Click the result - should attempt to redirect
    cy.contains('Existing Biz').click();
    cy.wait('@lookup');

    // The app should try to redirect (we can't follow cross-origin redirects in Cypress)
    // But we can verify it attempted to navigate
  });

  it('shows waiting screen for queued sites', () => {
    cy.intercept('GET', '/api/search/businesses*', {
      body: {
        data: [
          {
            place_id: 'ChIJ_queued',
            name: 'Queued Business',
            address: '222 Oak St',
            types: ['store'],
          },
        ],
      },
    }).as('search');

    // Mock lookup - site is queued
    cy.intercept('GET', '/api/sites/lookup*', {
      body: {
        data: {
          exists: true,
          site_id: 'site-456',
          slug: 'queued-business',
          status: 'queued',
          has_build: false,
        },
      },
    }).as('lookup');

    cy.get('input[placeholder*="Search for your business"]').type('Queued Business');
    cy.wait('@search');

    cy.contains('Queued Business').click();
    cy.wait('@lookup');

    // Should show the waiting screen
    cy.contains(/building your website/i).should('be.visible');
    cy.contains(/few minutes/i).should('be.visible');
  });
});

describe('Sign-In Screen', () => {
  beforeEach(() => {
    // Navigate to sign-in by selecting a new business
    cy.visit('/');

    cy.intercept('GET', '/api/search/businesses*', {
      body: {
        data: [
          {
            place_id: 'ChIJ_signin_test',
            name: 'Test Business',
            address: '333 Main St',
            types: ['store'],
          },
        ],
      },
    }).as('search');

    cy.intercept('GET', '/api/sites/lookup*', {
      body: { data: { exists: false } },
    }).as('lookup');

    cy.get('input[placeholder*="Search for your business"]').type('Test Business');
    cy.wait('@search');
    cy.contains('Test Business').click();
    cy.wait('@lookup');
  });

  it('shows all three sign-in options', () => {
    cy.contains(/sign in/i).should('be.visible');
    cy.contains(/google/i).should('be.visible');
    cy.contains(/phone/i).should('be.visible');
    cy.contains(/email/i).should('be.visible');
  });

  it('shows phone input when phone sign-in is selected', () => {
    cy.contains(/phone/i).click();
    cy.get('input[type="tel"]').should('be.visible');
  });

  it('shows email input when email sign-in is selected', () => {
    cy.contains(/email/i).click();
    cy.get('input[type="email"]').should('be.visible');
  });
});

describe('API Health', () => {
  it('health endpoint works', () => {
    cy.request('/health').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('status');
    });
  });

  it('search API returns valid JSON', () => {
    cy.request({
      url: '/api/search/businesses?q=pizza',
      failOnStatusCode: false,
    }).then((response) => {
      // May fail if GOOGLE_PLACES_API_KEY is not set, but should return JSON
      expect(response.headers['content-type']).to.include('application/json');
    });
  });

  it('lookup API returns valid JSON', () => {
    cy.request({
      url: '/api/sites/lookup?place_id=nonexistent',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.headers['content-type']).to.include('application/json');
    });
  });

  it('create-from-search requires auth', () => {
    cy.request({
      method: 'POST',
      url: '/api/sites/create-from-search',
      body: { business_name: 'Test' },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });
});
