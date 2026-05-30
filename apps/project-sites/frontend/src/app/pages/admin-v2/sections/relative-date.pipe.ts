/**
 * @module pages/admin-v2/sections/relative-date.pipe
 *
 * Standalone `relativeDate` pipe — humanizes timestamps to "3 days ago" via
 * dayjs's `relativeTime` plugin. Accepts ISO strings OR epoch-ms numbers (Site
 * uses ISO; MediaAsset uses epoch), returns "—" for empty/invalid. Pair with a
 * `[title]` carrying the absolute date so hover still shows the exact moment.
 * Leverages dayjs per [[package-preference-registry]] ("dates everywhere").
 *
 * @example `<span [title]="iso">{{ iso | relativeDate }}</span>`
 */
import { Pipe, type PipeTransform } from '@angular/core';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

@Pipe({ name: 'relativeDate', standalone: true })
export class RelativeDatePipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    if (value == null || value === '') return '—';
    const d = dayjs(value);
    return d.isValid() ? d.fromNow() : '—';
  }
}
