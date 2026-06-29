/**
 * @module services/plugin_registry
 * @description Pure in-memory plugin registry. Manages a collection of
 * registered plugins (integrations, themes, widgets) with type-scoped
 * listing and slug-based resolution. Zero I/O — all state is module-level.
 *
 * @packageDocumentation
 */

// ── Types ─────────────────────────────────────────────────────────────

/** Supported plugin categories. */
export const PLUGIN_TYPES = ['integration', 'theme', 'widget'] as const;

/** Discriminated union of allowed plugin types. */
export type PluginType = (typeof PLUGIN_TYPES)[number];

/**
 * Metadata supplied when registering a plugin.
 */
export interface PluginMeta {
  /** Unique kebab-case identifier (e.g. `'stripe-payments'`). */
  slug: string;
  /** Human-readable display name. */
  name: string;
  /** Plugin category. */
  type: PluginType;
  /** SemVer string (e.g. `'1.2.3'`). */
  version: string;
  /** One-sentence description of what the plugin does. */
  description: string;
  /** Optional author name or org. */
  author?: string;
  /** Optional project homepage URL. */
  homepage?: string;
}

/**
 * Internal registry entry wrapping PluginMeta with a registration timestamp.
 */
export interface PluginEntry extends PluginMeta {
  /** ISO-8601 timestamp of when the plugin was registered. */
  registeredAt: string;
}

/**
 * Result of a registerPlugin call.
 */
export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: 'slug_taken' | 'invalid_type' };

/**
 * Result of a resolvePlugin call.
 */
export type ResolveResult =
  | { ok: true; plugin: PluginEntry }
  | { ok: false; reason: 'not_found' };

// ── Registry state ────────────────────────────────────────────────────

const registry = new Map<string, PluginEntry>();

// ── Public API ────────────────────────────────────────────────────────

/**
 * Register a plugin in the registry.
 *
 * Slugs must be unique. Duplicate registration returns `{ ok: false }`
 * with reason `'slug_taken'`. Unknown plugin types return `'invalid_type'`.
 *
 * @param meta - Plugin metadata to register
 * @returns RegisterResult indicating success or failure
 *
 * @example
 * const r = registerPlugin({
 *   slug: 'stripe-payments',
 *   name: 'Stripe Payments',
 *   type: 'integration',
 *   version: '1.0.0',
 *   description: 'Accept payments via Stripe',
 * });
 * r.ok // true
 *
 * @example
 * const r = registerPlugin({ slug: 'dup', name: 'Dup', type: 'theme', version: '1.0.0', description: '' });
 * const r2 = registerPlugin({ slug: 'dup', name: 'Dup', type: 'theme', version: '1.0.0', description: '' });
 * r2.ok // false
 * r2.reason // 'slug_taken'
 */
export function registerPlugin(meta: PluginMeta): RegisterResult {
  if (!PLUGIN_TYPES.includes(meta.type)) {
    return { ok: false, reason: 'invalid_type' };
  }

  if (registry.has(meta.slug)) {
    return { ok: false, reason: 'slug_taken' };
  }

  const entry: PluginEntry = {
    ...meta,
    registeredAt: new Date().toISOString(),
  };

  registry.set(meta.slug, entry);
  return { ok: true };
}

/**
 * List all registered plugins, optionally filtered by type.
 *
 * Returns a snapshot array — mutating the result does not affect the registry.
 *
 * @param type - Optional type filter. When omitted, returns all plugins.
 * @returns Array of PluginEntry objects (empty if none match)
 *
 * @example
 * listPlugins()                       // all plugins
 * listPlugins('integration')          // only integrations
 * listPlugins('widget')               // only widgets (may be empty)
 */
export function listPlugins(type?: PluginType): PluginEntry[] {
  const all = Array.from(registry.values());
  if (!type) return all;
  return all.filter((p) => p.type === type);
}

/**
 * Resolve a single plugin by its slug.
 *
 * @param slug - The unique plugin identifier
 * @returns ResolveResult with the PluginEntry or a not_found reason
 *
 * @example
 * const r = resolvePlugin('stripe-payments');
 * if (r.ok) {
 *   console.log(r.plugin.name);
 * }
 *
 * @example
 * const r = resolvePlugin('nonexistent');
 * r.ok       // false
 * r.reason   // 'not_found'
 */
export function resolvePlugin(slug: string): ResolveResult {
  const entry = registry.get(slug);
  if (!entry) return { ok: false, reason: 'not_found' };
  return { ok: true, plugin: entry };
}
