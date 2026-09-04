/**
 * Regression guard for the fire-77 reset-drops-category+NAP fix.
 *
 * A `/reset` rebuild used to read the vertical ONLY from the request body (empty on
 * admin-UI resets + the loop's reset-retry) and never threaded phone/email/hours at
 * all → the identity-woven About fell back to "local service" and NAP was lost on
 * every rebuild. `resolveResetBusinessFields` re-threads them (body wins → stored
 * column from migration 0632 → undefined). This locks that contract at the lowest layer.
 */
import { resolveResetBusinessFields } from '../routes/api.js';

describe('resolveResetBusinessFields — reset re-threads category + NAP', () => {
  const stored = {
    business_category: 'family dentistry',
    business_phone: '+1 970 555 0142',
    business_email: 'hi@kestrel.example',
    business_hours: 'Mon-Fri 8am-5pm',
  };

  it('empty body → uses the STORED site columns (the exact reset-drop this fixes)', () => {
    expect(resolveResetBusinessFields({}, stored)).toEqual({
      businessCategory: 'family dentistry',
      businessPhone: '+1 970 555 0142',
      businessEmail: 'hi@kestrel.example',
      businessHours: 'Mon-Fri 8am-5pm',
    });
  });

  it('flat body values win over the stored columns', () => {
    expect(
      resolveResetBusinessFields(
        { business_category: 'hvac', business_phone: '111', business_email: 'a@b.c', business_hours: '24/7' },
        stored,
      ),
    ).toEqual({ businessCategory: 'hvac', businessPhone: '111', businessEmail: 'a@b.c', businessHours: '24/7' });
  });

  it('Places types[0] then business_type keep precedence for category', () => {
    expect(resolveResetBusinessFields({ business: { types: ['restaurant'] } }, stored).businessCategory).toBe(
      'restaurant',
    );
    expect(resolveResetBusinessFields({ business_type: 'legal' }, stored).businessCategory).toBe('legal');
  });

  it('nothing anywhere → undefined (never leaks "" / null to the workflow)', () => {
    expect(resolveResetBusinessFields({}, {})).toEqual({
      businessCategory: undefined,
      businessPhone: undefined,
      businessEmail: undefined,
      businessHours: undefined,
    });
  });

  it('null stored columns coerce to undefined', () => {
    expect(
      resolveResetBusinessFields(
        {},
        { business_category: null, business_phone: null, business_email: null, business_hours: null },
      ),
    ).toEqual({
      businessCategory: undefined,
      businessPhone: undefined,
      businessEmail: undefined,
      businessHours: undefined,
    });
  });
});
