import type { Env } from '../../../src/types/env.js';
import {
  listAll,
  listVersions,
  configureVariants,
  resolveLatest,
} from '../../../src/prompts/registry.js';
import type { PromptTemplate } from './schemas.js';

export const FLAG_KEY = 'prompt_studio';

export function listTemplates(): PromptTemplate[] {
  const all = listAll();
  return all.map((entry: { id: string; version: number }) => ({
    id: entry.id,
    version: entry.version,
    variants: undefined,
  }));
}

export function setVariantWeights(
  key: string,
  weights: Record<string, number>,
): { version: number } {
  const latest = resolveLatest(key);
  if (!latest) throw new Error(`Prompt key not found: ${key}`);
  configureVariants(key, latest.version, weights);
  return { version: latest.version };
}

export function rollbackToVersion(key: string): { version: number } {
  const versions = listVersions(key);
  if (!versions || versions.length < 2) throw new Error(`No previous version for: ${key}`);
  const previous = versions[versions.length - 2];
  if (previous === undefined) throw new Error(`No previous version for: ${key}`);
  return { version: previous.version };
}
