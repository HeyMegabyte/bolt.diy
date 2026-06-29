/**
 * @module plane_cycle_automation
 *
 * @description
 * When a new Plane project is created for a customer, auto-compute the
 * standard cycles, module templates, and default member role distribution.
 *
 * Pure zero-I/O: all functions are deterministic with no side-effects.
 * Never throws — every input shape is handled gracefully.
 *
 * @remarks
 * PL8 project-per-customer — cycle automation for new Plane projects.
 *
 * **Cycles**: Six sprints (Sprint 1–6) computed from a project start date
 * and sprint length. Each cycle is an ISO-date-bounded interval.
 *
 * **Modules**: Four standard module templates per project:
 * - Frontend (UI + client logic)
 * - Backend (API, DB, auth)
 * - Design (UX, visual, brand assets)
 * - DevOps (CI/CD, infra, monitoring)
 *
 * **Default members**: A sane starting point for a small team — one admin,
 * two members, one viewer.
 *
 * @example
 * ```ts
 * import { generateCycles, generateModules, defaultMembers } from './plane_cycle_automation.js';
 *
 * const cycles = generateCycles('2026-07-06');
 * // cycles → [Sprint 1: 2026-07-06 → 2026-07-19, Sprint 2: …, … Sprint 6]
 *
 * const modules = generateModules();
 * // modules → [{ name: 'Frontend', description: '…' }, …]
 *
 * const roles = defaultMembers();
 * // roles → [{ role: 'admin', count: 1 }, { role: 'member', count: 2 }, …]
 * ```
 *
 * @packageDocumentation
 */

// ────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────

/** A single sprint cycle with ISO date bounds. */
export interface CycleSpec {
  /** Human-readable cycle name, e.g. "Sprint 1". */
  readonly name: string;
  /** ISO 8601 date string when the cycle starts, e.g. "2026-07-06". */
  readonly startDate: string;
  /** ISO 8601 date string when the cycle ends (inclusive — last day). */
  readonly endDate: string;
}

/** A module template with a name and one-line description. */
export interface ModuleTemplate {
  readonly name: string;
  readonly description: string;
}

/** A default member role with a suggested head-count. */
export interface MemberRole {
  readonly role: 'admin' | 'member' | 'viewer';
  readonly count: number;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Default sprint duration in weeks when not specified. */
const DEFAULT_SPRINT_WEEKS = 2;

/** Number of sprints to generate for a new project. */
const CYCLE_COUNT = 6;

/** Module templates keyed by name. */
const MODULE_TEMPLATES: readonly ModuleTemplate[] = Object.freeze([
  {
    name: 'Frontend',
    description:
      'User interface and client-side logic — components, routing, state management, responsive layout, and API integration.',
  },
  {
    name: 'Backend',
    description:
      'Server-side API, database schema, authentication, business logic, and third-party service integration.',
  },
  {
    name: 'Design',
    description:
      'UX research, wireframes, visual design, brand assets, accessibility compliance, and design system tokens.',
  },
  {
    name: 'DevOps',
    description:
      'CI/CD pipeline, infrastructure provisioning, monitoring, alerting, secrets management, and deployment automation.',
  },
]);

/** Default member role distribution for a new project. */
const DEFAULT_MEMBER_ROLES: readonly MemberRole[] = Object.freeze([
  { role: 'admin', count: 1 },
  { role: 'member', count: 2 },
  { role: 'viewer', count: 1 },
]);

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Add `days` (non-negative integer) to an ISO date string and return the
 * result as an ISO date string. Clamps to valid calendar dates.
 *
 * @param isoDate — ISO 8601 date string (e.g. "2026-07-06").
 * @param days — Number of days to add (must be >= 0).
 * @returns ISO 8601 date string offset by `days`.
 * @remarks Pure — no I/O, never throws.
 */
function addDays(isoDate: string, days: number): string {
  const clamped = Math.max(0, Math.floor(days));
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + clamped);
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Generate 6 sprints starting from `projectStart`.
 *
 * Each sprint is `sprintWeeks` long (default 2). The first sprint starts on
 * `projectStart`; subsequent sprints begin the day after the prior sprint's
 * end date. All dates are ISO 8601 (YYYY-MM-DD).
 *
 * @param projectStart — ISO 8601 date when the first sprint begins.
 * @param sprintWeeks — Number of weeks per sprint (default 2, clamped 1–4).
 * @returns An array of exactly 6 {@link CycleSpec} objects.
 * @remarks Pure — no I/O, never throws.
 *
 * @example
 * ```ts
 * generateCycles('2026-07-06');
 * // →
 * // [
 * //   { name: 'Sprint 1', startDate: '2026-07-06', endDate: '2026-07-19' },
 * //   { name: 'Sprint 2', startDate: '2026-07-20', endDate: '2026-08-02' },
 * //   { name: 'Sprint 3', startDate: '2026-08-03', endDate: '2026-08-16' },
 * //   { name: 'Sprint 4', startDate: '2026-08-17', endDate: '2026-08-30' },
 * //   { name: 'Sprint 5', startDate: '2026-08-31', endDate: '2026-09-13' },
 * //   { name: 'Sprint 6', startDate: '2026-09-14', endDate: '2026-09-27' },
 * // ]
 * ```
 */
export function generateCycles(projectStart: string, sprintWeeks?: number): CycleSpec[] {
  // Clamp sprintWeeks to a sane range [1, 4]; default 2.
  const weeks =
    sprintWeeks === undefined
      ? DEFAULT_SPRINT_WEEKS
      : Math.max(1, Math.min(4, Math.floor(sprintWeeks)));
  const daysPerSprint = weeks * 7;

  const cycles: CycleSpec[] = [];
  let cursor = projectStart;

  for (let i = 1; i <= CYCLE_COUNT; i++) {
    const end = addDays(cursor, daysPerSprint - 1);
    cycles.push({
      name: `Sprint ${i}`,
      startDate: cursor,
      endDate: end,
    });
    // Next sprint starts the day after this one ends.
    cursor = addDays(end, 1);
  }

  return cycles;
}

/**
 * Return the four standard module templates for a new project.
 *
 * @returns An array of {@link ModuleTemplate} objects: Frontend, Backend,
 * Design, DevOps.
 * @remarks Pure — no I/O, never throws.
 *
 * @example
 * ```ts
 * generateModules();
 * // →
 * // [
 * //   { name: 'Frontend', description: 'User interface and client-side logic…' },
 * //   { name: 'Backend', description: 'Server-side API, database schema…' },
 * //   { name: 'Design', description: 'UX research, wireframes, visual design…' },
 * //   { name: 'DevOps', description: 'CI/CD pipeline, infrastructure…' },
 * // ]
 * ```
 */
export function generateModules(): ModuleTemplate[] {
  return MODULE_TEMPLATES.map((m) => ({ ...m }));
}

/**
 * Return the default member role distribution for a new project.
 *
 * Defaults: 1 admin, 2 members, 1 viewer.
 *
 * @returns An array of {@link MemberRole} objects.
 * @remarks Pure — no I/O, never throws.
 *
 * @example
 * ```ts
 * defaultMembers();
 * // → [{ role: 'admin', count: 1 }, { role: 'member', count: 2 }, { role: 'viewer', count: 1 }]
 * ```
 */
export function defaultMembers(): MemberRole[] {
  return DEFAULT_MEMBER_ROLES.map((r) => ({ ...r }));
}
