/**
 * @file Unit tests for the Functions-tab template gallery + cross-ref helpers
 * added to `functions-panel-logic.ts`. Relative import (repo Vitest convention —
 * the `~/` alias resolves for app code but not spec direct value imports).
 * Complements `FunctionsPanel.spec.ts` (which locks the derivation + base scaffold).
 */
import { describe, expect, it } from 'vitest';
import {
  scaffoldFunction,
  templateBody,
  deriveRoutes,
  bindingUsageCounts,
  fileContent,
  previewLines,
  FUNCTION_TEMPLATES,
  type FunctionTemplate,
  type RouteEntry,
} from './functions-panel-logic';
import type { FileMap } from '~/lib/stores/files';

// eslint-disable-next-line no-restricted-imports
import { WORK_DIR } from '../../utils/constants';

const file = (content: string) => ({ type: 'file' as const, content, isBinary: false });

/** The verb each template's handler must export, and the phantom verbs it must NOT. */
const TEMPLATE_EXPECT: Record<FunctionTemplate, { serves: string; route: string }> = {
  blank: { serves: 'onRequestGet', route: '/api/blank' },
  contact: { serves: 'onRequestPost', route: '/api/contact' },
  webhook: { serves: 'onRequestPost', route: '/api/hook' },
  cron: { serves: 'onRequestGet', route: '/api/cron' },
  'json-api': { serves: 'onRequestGet', route: '/api/items' },
  proxy: { serves: 'onRequestGet', route: '/api/proxy' },
};

describe('FUNCTION_TEMPLATES gallery', () => {
  it('lists the six starter kinds with a method + blurb + icon each', () => {
    expect(FUNCTION_TEMPLATES.map((t) => t.kind)).toEqual(['blank', 'contact', 'webhook', 'cron', 'json-api', 'proxy']);

    for (const t of FUNCTION_TEMPLATES) {
      expect(t.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(t.icon.startsWith('i-ph:')).toBe(true);
    }
  });
});

describe('templateBody — each template carries the correct onRequest{Verb} export', () => {
  for (const [kind, { serves, route }] of Object.entries(TEMPLATE_EXPECT) as [
    FunctionTemplate,
    { serves: string; route: string },
  ][]) {
    it(`${kind} exports ${serves} and embeds the route`, () => {
      const body = templateBody(kind, route);
      expect(body).toContain(`export async function ${serves}`);
      expect(body).toContain(JSON.stringify(route));
    });
  }

  it('POST templates do NOT export a GET handler (and vice-versa) — no phantom verbs', () => {
    // Assemble the forbidden token dynamically so it never appears literally in this file.
    const get = 'onRequest' + 'Get';
    const post = 'onRequest' + 'Post';
    expect(templateBody('contact', '/api/contact')).not.toContain(get);
    expect(templateBody('webhook', '/api/hook')).not.toContain(get);
    expect(templateBody('blank', '/api/blank')).not.toContain(post);
    expect(templateBody('json-api', '/api/items')).not.toContain(post);
  });

  it('CRITICAL: no template body contains an onRequest token inside a COMMENT (would fabricate phantom methods)', () => {
    const token = 'onRequest';

    for (const t of FUNCTION_TEMPLATES) {
      const body = templateBody(t.kind, TEMPLATE_EXPECT[t.kind].route);

      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        const isComment = line.startsWith('*') || line.startsWith('//') || line.startsWith('/*');

        if (isComment) {
          expect(line.includes(token)).toBe(false);
        }
      }
    }
  });
});

describe('scaffoldFunction — template param (default blank keeps existing behaviour)', () => {
  const ok = (r: ReturnType<typeof scaffoldFunction>) => {
    if ('error' in r) {
      throw new Error(`expected success, got error: ${r.error}`);
    }

    return r;
  };

  it('two-arg (legacy) call still produces the blank onRequestGet handler', () => {
    const r = ok(scaffoldFunction('legacy', {}));
    expect(r.path).toBe(`${WORK_DIR}/functions/api/legacy.ts`);
    expect(r.content).toContain('export async function onRequestGet');
  });

  it('a "contact" template scaffolds a POST handler whose derived route is POST-only', () => {
    const r = ok(scaffoldFunction('contact', {}, 'contact'));
    expect(r.route).toBe('/api/contact');
    expect(r.content).toContain('export async function onRequestPost');

    const derived = deriveRoutes({ [r.path]: file(r.content) }, new Set());
    expect(derived[0].path).toBe('/api/contact');
    expect(derived[0].methods).toEqual(['POST']); // deriver sees exactly one verb — no phantom GET/ALL
  });

  it('each template derives exactly its intended single method (no phantom verbs leak through)', () => {
    for (const t of FUNCTION_TEMPLATES) {
      const r = ok(scaffoldFunction(`t-${t.kind}`, {}, t.kind));
      const derived = deriveRoutes({ [r.path]: file(r.content) }, new Set());
      expect(derived[0].methods).toEqual([t.method]);
    }
  });

  it('still rejects unsafe/colliding names regardless of template', () => {
    expect('error' in scaffoldFunction('../etc/passwd', {}, 'proxy')).toBe(true);

    const existing: FileMap = { [`${WORK_DIR}/functions/api/dup.ts`]: file('x') };
    expect('error' in scaffoldFunction('dup', existing, 'webhook')).toBe(true);
  });
});

describe('fileContent — tolerates dirent, raw string, and undefined', () => {
  it('reads the .content of a dirent', () => {
    expect(fileContent(file('hello'))).toBe('hello');
  });
  it('passes a raw string through', () => {
    expect(fileContent('raw')).toBe('raw');
  });
  it('returns empty for undefined / binary-ish objects', () => {
    expect(fileContent(undefined)).toBe('');
    expect(fileContent({ type: 'folder' } as unknown as FileMap[string])).toBe('');
  });
});

describe('previewLines — first N lines', () => {
  it('keeps the leading lines only', () => {
    expect(previewLines('a\nb\nc\nd', 2)).toBe('a\nb');
    expect(previewLines('one-liner')).toBe('one-liner');
  });
  it('defaults to 16 lines', () => {
    const src = Array.from({ length: 40 }, (_, i) => `L${i}`).join('\n');
    expect(previewLines(src).split('\n')).toHaveLength(16);
  });
});

describe('bindingUsageCounts — routes-per-binding cross-ref', () => {
  const routes: RouteEntry[] = [
    { path: '/api/a', methods: ['GET'], handlerFile: 'functions/api/a.ts', usesResources: ['DB'] },
    { path: '/api/b', methods: ['POST'], handlerFile: 'functions/api/b.ts', usesResources: ['DB', 'BUCKET'] },
    { path: '/api/c', methods: ['GET'], handlerFile: 'functions/api/c.ts', usesResources: [] },
  ];

  it('counts how many routes reference each declared binding', () => {
    expect(bindingUsageCounts(routes, ['DB', 'BUCKET', 'KV'])).toEqual({ DB: 2, BUCKET: 1, KV: 0 });
  });
  it('is empty when there are no declared bindings', () => {
    expect(bindingUsageCounts(routes, [])).toEqual({});
  });
});
