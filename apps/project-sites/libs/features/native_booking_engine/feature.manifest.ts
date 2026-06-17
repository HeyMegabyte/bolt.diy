import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'native_booking_engine',
  name: 'Native Booking Engine',
  description:
    'Self-hosted appointment booking that replaces the Calendly dependency. ' +
    'Tenants define availability slots; visitors reserve appointments stored in D1.',
  lifecycle: 'alpha',
  flagKey: 'native_booking_engine',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'GET /api/booking/slots',
    'POST /api/booking/reserve',
    'DELETE /api/booking/cancel/:id',
    'GET /api/booking/appointments',
  ],
  permissions: ['booking:read', 'booking:write'],
  dependencies: [],
  e2eTests: [],
  unitTests: [
    '../libs/features/native_booking_engine/__tests__/native_booking_engine.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — gates behind flag. Enable per-org via /admin/feature-flags.',
  },
  risks: [
    'Appointment slots must not double-book; relies on D1 unique constraint on slot_id + status.',
    'When flag is off, booking routes return 404 and any embedded widget will show a blank state.',
  ],
  removalNotes:
    'Drop booking_slots and booking_appointments D1 tables. ' +
    'Remove this module folder and the app.route mount in src/index.ts.',
});
