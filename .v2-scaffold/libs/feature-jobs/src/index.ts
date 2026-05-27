/**
 * `@org/feature-jobs` — list + detail for dispatched jobs. The detail
 * surface is the live map hero: real-time crew GPS, ETA countdown,
 * in-app chat, voice call, photo verification, two-way ratings,
 * tipping, safety button, receipts (v2 doctrine §10).
 */
export * from './lib/services/jobs.service.js';
export * from './lib/jobs-list.component.js';
export * from './lib/job-detail.component.js';
export * from './lib/job-chat.component.js';
export * from './lib/job-rating.component.js';
export * from './lib/job-tip-dialog.component.js';
export * from './lib/job-safety-button.component.js';
export * from './lib/photo-verification.component.js';
export * from './lib/jobs.routes.js';
