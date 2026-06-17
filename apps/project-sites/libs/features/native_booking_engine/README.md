# native_booking_engine

Self-hosted appointment booking that replaces the Calendly dependency. Tenants define availability slots; visitors reserve appointments stored in D1.

## Feature flag

**Key:** `native_booking_engine`  
**Default:** `enabled=0, rollout_percent=0, stage='experimental'`

When the flag is **off**, all routes return **404** (never 403 — feature existence is not leaked).

## API routes

| Method   | Path                        | Auth   | Description                         |
|----------|-----------------------------|--------|-------------------------------------|
| GET      | `/api/booking/slots`        | Bearer | List available slots for the org    |
| POST     | `/api/booking/reserve`      | Bearer | Reserve a slot (create appointment) |
| DELETE   | `/api/booking/cancel/:id`   | Bearer | Cancel an appointment               |
| GET      | `/api/booking/appointments` | Bearer | List all appointments (owner view)  |

## D1 tables

### `booking_slots`

Availability windows defined by the tenant.

| Column             | Type    | Notes                          |
|--------------------|---------|--------------------------------|
| id                 | TEXT PK | UUID                           |
| org_id             | TEXT    | FK → orgs.id                  |
| site_id            | TEXT    | FK → sites.id                 |
| start_at           | TEXT    | ISO 8601 UTC                   |
| end_at             | TEXT    | ISO 8601 UTC                   |
| duration_minutes   | INTEGER |                                |
| label              | TEXT    | Optional display label         |
| max_bookings       | INTEGER | Default 1                      |
| current_bookings   | INTEGER | Incremented on reserve         |
| deleted_at         | TEXT    | Soft-delete                    |
| created_at / updated_at | TEXT |                              |

### `booking_appointments`

Confirmed (or cancelled) visitor appointments.

| Column         | Type    | Notes                                         |
|----------------|---------|-----------------------------------------------|
| id             | TEXT PK | UUID                                          |
| org_id         | TEXT    | FK → orgs.id                                 |
| site_id        | TEXT    | FK → sites.id                                |
| slot_id        | TEXT    | FK → booking_slots.id                        |
| visitor_name   | TEXT    |                                               |
| visitor_email  | TEXT    |                                               |
| notes          | TEXT    | Optional                                      |
| status         | TEXT    | `confirmed` or `cancelled`                    |
| cancelled_at   | TEXT    | Nullable; set on cancellation                 |
| created_at     | TEXT    |                                               |

## Safe disabled behavior

When the flag is off, the booking widget on generated sites should render nothing (empty div). No data is accessible or leaked.

## Removal

1. Delete `booking_slots` and `booking_appointments` D1 tables via a migration.
2. Remove this module folder.
3. Remove the `app.route` mount from `src/index.ts`.
