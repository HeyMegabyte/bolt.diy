/** Social post calendar generator. Pure, never throws. */
export type Platform = 'x' | 'linkedin' | 'facebook' | 'instagram';
export interface PostSlot {
  platform: Platform;
  date: string;
  time: string;
  contentType: string;
}
export const BEST_TIMES: Record<Platform, { day: number; hour: number }[]> = {
  x: [
    { day: 2, hour: 9 },
    { day: 3, hour: 12 },
    { day: 4, hour: 17 },
  ],
  linkedin: [
    { day: 2, hour: 8 },
    { day: 3, hour: 12 },
    { day: 4, hour: 16 },
  ],
  facebook: [
    { day: 1, hour: 9 },
    { day: 3, hour: 13 },
    { day: 5, hour: 15 },
  ],
  instagram: [
    { day: 1, hour: 11 },
    { day: 4, hour: 19 },
  ],
};
export function generateCalendar(
  spec: { platforms: Platform[]; postsPerWeek: number; contentType: string; startDate: string },
  weeks?: number,
): PostSlot[] {
  const w = Math.max(1, weeks ?? 4);
  const slots: PostSlot[] = [];
  const start = new Date(spec.startDate);
  for (let wk = 0; wk < w; wk++) {
    for (let p = 0; p < spec.postsPerWeek; p++) {
      const plat = spec.platforms[p % spec.platforms.length];
      const times = BEST_TIMES[plat];
      const t = times[p % times.length];
      const d = new Date(start);
      d.setDate(d.getDate() + wk * 7 + ((t.day - d.getDay() + 7) % 7));
      slots.push({
        platform: plat,
        date: d.toISOString().slice(0, 10),
        time: `${String(t.hour).padStart(2, '0')}:00`,
        contentType: spec.contentType,
      });
    }
  }
  return slots;
}
