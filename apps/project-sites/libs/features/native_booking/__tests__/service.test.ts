import { generateSlots, confirmBooking } from '../service.js';
import type { ServiceOffering } from '../service.js';

const service: ServiceOffering = { id: 's1', name: 'Haircut', durationMinutes: 30, priceCents: 3500, bufferMinutes: 5 };
const tuesday = new Date(2026, 6, 21); // July 21, 2026 = Tuesday (day 2)

describe('generateSlots', () => {
  test('generates slots for a business day', () => {
    const slots = generateSlots(service, tuesday, []);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].available).toBe(true);
    expect(slots[0].date).toBe('2026-07-21');
  });

  test('marks slots as unavailable when conflicts exist', () => {
    const slots = generateSlots(service, tuesday, [
      { date: '2026-07-21', startTime: '09:00', endTime: '09:35' },
    ]);
    const conflict = slots.find((s) => s.startTime === '09:00');
    expect(conflict?.available).toBe(false);
  });

  test('returns empty for closed day (Sunday)', () => {
    const sunday = new Date(2026, 6, 19); // July 19, 2026 = Sunday
    expect(generateSlots(service, sunday, [])).toHaveLength(0);
  });

  test('buffer time is added to each slot', () => {
    const slots = generateSlots(service, tuesday, []);
    const firstEnd = slots[0].endTime;
    const firstStart = slots[0].startTime;
    const diff = parseTimeDiff(firstEnd, firstStart);
    expect(diff).toBe(35); // 30 min service + 5 min buffer
  });
});

describe('confirmBooking', () => {
  test('confirms a valid booking', () => {
    const result = confirmBooking(
      { serviceId: 's1', date: '2026-07-21', startTime: '10:00', customerName: 'Alice', customerEmail: 'a@b.com' },
      service, [],
    );
    expect('id' in result).toBe(true);
    if ('id' in result) {
      expect(result.serviceName).toBe('Haircut');
      expect(result.priceFormatted).toBe('$35.00');
      expect(result.cancellationPolicy).toBeTruthy();
    }
  });

  test('rejects booking on closed day', () => {
    const result = confirmBooking(
      { serviceId: 's1', date: '2026-07-19', startTime: '10:00', customerName: 'Bob', customerEmail: 'b@c.com' },
      service, [],
    );
    expect('error' in result).toBe(true);
  });

  test('rejects booking past closing time', () => {
    const result = confirmBooking(
      { serviceId: 's1', date: '2026-07-21', startTime: '16:45', customerName: 'Carol', customerEmail: 'c@d.com' },
      service, [],
    );
    expect('error' in result).toBe(true);
  });

  test('rejects conflicting booking', () => {
    const result = confirmBooking(
      { serviceId: 's1', date: '2026-07-21', startTime: '09:00', customerName: 'Dave', customerEmail: 'd@e.com' },
      service, [{ date: '2026-07-21', startTime: '09:00', endTime: '09:35' }],
    );
    expect('error' in result).toBe(true);
  });
});

function parseTimeDiff(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (ah * 60 + am) - (bh * 60 + bm);
}
