/**
 * @module durable_objects/formbricks_container
 *
 * @description
 * **TRANSITION TOMBSTONE — Formbricks is REMOVED (2026-06-27).**
 *
 * The Formbricks feature (`survey.projectsites.dev`) is fully deleted: no
 * `[[containers]]` block, no `FORMBRICKS_CONTAINER` binding, no host route, and
 * no `FORMBRICKS_*` env. Formbricks exceeds the 4-service max (it needs Cube +
 * extra custom Hub services), so it is not a supportable catalog app.
 *
 * This empty class is retained ONLY for the brief window needed to deregister
 * the orphaned `project-sites_FormbricksContainer` Durable Object namespace:
 * CF refuses to delete the namespace while a binding still references it
 * (error 10086), and refuses to deploy a class-less worker while DOs still
 * depend on the class (error 10064) — yet a `deleted_classes` migration reports
 * the class "non-existent" (the registry never recorded a creating tag). The
 * escape is: deploy with the binding gone but the class still exported → delete
 * the now-unreferenced namespace via the CF API → deploy again with this file
 * removed entirely. Never bound, never instantiated.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Dormant DO tombstone for the removed Formbricks feature. Never bound. */
export class FormbricksContainer extends Container<Env> {
  override defaultPort = 3000;
}
