# places_search

Public **Google Places** search endpoints the homepage SPA uses on screen 1: a
business text-search (KV-cached) and an address autocomplete (with a Text-Search
fallback). Both proxy the Google Places API via the worker's
`GOOGLE_PLACES_API_KEY`; neither touches D1. **Core, un-gated** routes (no feature
flag) — a route-organization module extracted VERBATIM from the `search.ts`
monolith (route-decomposition installment 25).

## Routes (`handlers.ts` → `placesSearch`, mounted at `app.route('/', placesSearch)`)

| Method | Path                     | Auth   |
| ------ | ------------------------ | ------ |
| GET    | `/api/search/businesses` | public |
| GET    | `/api/search/address`    | public |

## Boundaries

- Both public + guest-reachable. **Honest-empty degradation**: when the provider
  is unconfigured or down, both return `200 { data: [], _error: { code, status,
  message } }` with a stable code — never a misleading empty and never a 5xx — so
  the create flow degrades to manual entry. Raw upstream bodies (GCP billing
  state, PERMISSION_DENIED) are logged server-side only, never leaked to the
  client.
- `businesses` KV-caches only non-empty hits (6h TTL) to spare the Google Places
  daily quota; errors/empties stay live. `address` tries autocomplete then falls
  back to Text Search, carrying the `_error` only when BOTH paths fail.
- The exclusive `GooglePlace`/`GooglePlacesResponse` +
  `AutocompleteSuggestion`/`AutocompleteResponse` interfaces moved here;
  `badRequest` (still used by other search.ts routes) is re-imported. No
  `onError` — `badRequest` throws bubble to the app-level handler, matching the
  original.
