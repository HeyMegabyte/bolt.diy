/**
 * @module libs/features/native_booking/service
 *
 * Native Booking Engine (#37, ROI 2.00) — pure availability calculator,
 * slot generator, and booking validator. Zero I/O, deterministic.
 */
export interface ServiceOffering {
  id: string; name: string; durationMinutes: number;
  priceCents: number; bufferMinutes: number;
}

export interface BusinessHours {
  dayOfWeek: number; openHour: number; closeHour: number;
}

export interface TimeSlot {
  date: string; startTime: string; endTime: string;
  serviceId: string; available: boolean;
}

export interface BookingRequest {
  serviceId: string; date: string; startTime: string;
  customerName: string; customerEmail: string; customerPhone?: string;
}

export interface BookingConfirmation {
  id: string; serviceId: string; serviceName: string;
  date: string; startTime: string; endTime: string;
  customerName: string; customerEmail: string;
  priceCents: number; priceFormatted: string;
  confirmedAt: string; cancellationPolicy: string;
}

const DEFAULT_HOURS: BusinessHours[] = [
  { dayOfWeek: 1, openHour: 9, closeHour: 17 },
  { dayOfWeek: 2, openHour: 9, closeHour: 17 },
  { dayOfWeek: 3, openHour: 9, closeHour: 17 },
  { dayOfWeek: 4, openHour: 9, closeHour: 17 },
  { dayOfWeek: 5, openHour: 9, closeHour: 17 },
  { dayOfWeek: 6, openHour: 10, closeHour: 15 },
];

function getHours(date: Date, hours: BusinessHours[]): BusinessHours | null {
  const dow = date.getDay();
  return hours.find((h) => h.dayOfWeek === dow) || null;
}

/**
 * Generates available time slots for a service on a given date.
 */
export function generateSlots(
  service: ServiceOffering,
  date: Date,
  existingBookings: Array<{ startTime: string; endTime: string }>,
  hours: BusinessHours[] = DEFAULT_HOURS,
): TimeSlot[] {
  const dayHours = getHours(date, hours);
  if (!dayHours) return [];

  const slots: TimeSlot[] = [];
  const dateStr = date.toISOString().split('T')[0];
  const totalMinutes = service.durationMinutes + service.bufferMinutes;

  for (let h = dayHours.openHour; h < dayHours.closeHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      const startMin = h * 60 + m;
      const endMin = startMin + totalMinutes;
      if (endMin > dayHours.closeHour * 60) break;

      const startH = Math.floor(startMin / 60);
      const startM = startMin % 60;
      const endH = Math.floor(endMin / 60);
      const endM = endMin % 60;

      const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
      const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

      const conflicts = existingBookings.some((b) =>
        b.date === dateStr && b.startTime < endTime && b.endTime > startTime,
      );

      slots.push({ date: dateStr, startTime, endTime, serviceId: service.id, available: !conflicts });
    }
  }
  return slots;
}

/**
 * Validates a booking request and returns a confirmation.
 */
export function confirmBooking(
  request: BookingRequest,
  service: ServiceOffering,
  existingBookings: Array<{ date: string; startTime: string; endTime: string }>,
  hours?: BusinessHours[],
): BookingConfirmation | { error: string } {
  const date = new Date(request.date + 'T00:00:00');
  if (isNaN(date.getTime())) return { error: 'Invalid date format. Use YYYY-MM-DD.' };

  const dayHours = getHours(date, hours || DEFAULT_HOURS);
  if (!dayHours) return { error: 'Business is closed on this day.' };

  const endMin = parseTime(request.startTime) + service.durationMinutes + service.bufferMinutes;
  if (endMin > dayHours.closeHour * 60) {
    return { error: 'Booking would end after business hours.' };
  }

  const endTime = formatTime(endMin);
  const conflicts = existingBookings.some((b) =>
    b.date === request.date && b.startTime < endTime && b.endTime > request.startTime,
  );
  if (conflicts) return { error: 'This time slot is no longer available.' };

  return {
    id: `bk_${crypto.randomUUID?.()?.slice(0, 8) ?? Date.now().toString(36)}`,
    serviceId: service.id, serviceName: service.name,
    date: request.date, startTime: request.startTime, endTime,
    customerName: request.customerName, customerEmail: request.customerEmail,
    priceCents: service.priceCents,
    priceFormatted: `$${(service.priceCents / 100).toFixed(2)}`,
    confirmedAt: new Date().toISOString(),
    cancellationPolicy: 'Free cancellation up to 24 hours before the appointment.',
  };
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
