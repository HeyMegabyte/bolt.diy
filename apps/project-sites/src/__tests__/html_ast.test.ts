/**
 * Unit coverage for services/html_ast — AST-aware HTML helpers backed by
 * web-tree-sitter (convergence r17).
 *
 * The real `web-tree-sitter` wasm cannot instantiate under Jest's Node
 * environment (the `.wasm` moduleNameMapper hands back an empty buffer, and
 * `WebAssembly.instantiate` aborts on a 0-byte BufferSource). The module's
 * value here is its tree-walking + extraction logic, NOT the wasm parse, so we
 * mock `web-tree-sitter` with a faithful in-memory tree-sitter node shape and
 * drive every branch deterministically through a per-test fixture map.
 *
 * The mocked node mirrors the exact surface html_ast.ts reads:
 *   node.type, node.text, node.parent,
 *   node.namedChildCount, node.namedChild(i), node.namedChildren (array w/ .find)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── In-memory tree-sitter node + fixture builder ──────────────────────────

interface NodeSpec {
  type: string;
  text?: string;
  children?: NodeSpec[];
}

class MockNode {
  type: string;
  text: string;
  parent: MockNode | null = null;
  namedChildren: MockNode[];

  constructor(spec: NodeSpec) {
    this.type = spec.type;
    this.text = spec.text ?? '';
    this.namedChildren = (spec.children ?? []).map((c) => {
      const child = new MockNode(c);
      child.parent = this;
      return child;
    });
  }

  get namedChildCount(): number {
    return this.namedChildren.length;
  }

  namedChild(i: number): MockNode {
    return this.namedChildren[i];
  }
}

/**
 * Each test sets the next tree the mocked parser should hand back, keyed by
 * the exact source string passed to `parseHtml`. A single shared queue keeps
 * the mock dead-simple while still exercising the real parser-cache singleton.
 */
const treeBySource = new Map<string, NodeSpec>();
let parseCalls: string[] = [];
let parserConstructCount = 0;
let initCount = 0;
let languageLoadCount = 0;
let setLanguageCount = 0;
const parseThrowFor = new Set<string>();

function setTree(source: string, root: NodeSpec): void {
  treeBySource.set(source, root);
}

jest.mock(
  'web-tree-sitter',
  () => {
    const TreeSitter: any = {
      init: jest.fn(async () => {
        initCount++;
      }),
      Language: {
        load: jest.fn(async () => {
          languageLoadCount++;
          return { name: 'html' };
        }),
      },
      Parser: class {
        constructor() {
          parserConstructCount++;
        }
        setLanguage(): void {
          setLanguageCount++;
        }
        parse(source: string): any {
          parseCalls.push(source);
          if (parseThrowFor.has(source)) throw new Error('parse boom');
          const spec = treeBySource.get(source) ?? { type: 'document' };
          return { rootNode: new MockNode(spec) };
        }
      },
    };
    return { __esModule: true, default: TreeSitter };
  },
  { virtual: true },
);

// `.wasm` imports resolve to the {} mock via jest.config moduleNameMapper; the
// dynamic `import('../wasm/tree-sitter-html.wasm')` therefore yields {default:{}}.

import {
  parseHtml,
  countH1,
  extractVisibleText,
  extractAttributeRefs,
  findBannedWords,
} from '../services/html_ast';

// ── Fixture helpers (mirror tree-sitter-html node shapes) ─────────────────

const text = (t: string): NodeSpec => ({ type: 'text', text: t });
const tagName = (t: string): NodeSpec => ({ type: 'tag_name', text: t });

const startTag = (name: string, attrs: NodeSpec[] = []): NodeSpec => ({
  type: 'start_tag',
  children: [tagName(name), ...attrs],
});

const element = (name: string, children: NodeSpec[] = [], attrs: NodeSpec[] = []): NodeSpec => ({
  type: 'element',
  children: [startTag(name, attrs), ...children],
});

const attr = (name: string, valueType: string | null, raw?: string): NodeSpec => ({
  type: 'attribute',
  children: [
    { type: 'attribute_name', text: name },
    ...(valueType ? [{ type: valueType, text: raw ?? '' }] : []),
  ],
});

const doc = (children: NodeSpec[]): NodeSpec => ({ type: 'document', children });

beforeEach(() => {
  treeBySource.clear();
  parseThrowFor.clear();
  parseCalls = [];
  // The parser singleton in html_ast caches across tests within a module run;
  // counters reflect cumulative state, asserted only in the dedicated cache test.
});

// ──────────────────────────────────────────────────────────────────────────

describe('parseHtml + parser singleton', () => {
  it('parses source and returns a tree with a rootNode', async () => {
    const src = '<div>parse</div>';
    setTree(src, doc([element('div', [text('parse')])]));
    const tree = await parseHtml(src);
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe('document');
    expect(parseCalls).toContain(src);
  });

  it('initializes web-tree-sitter exactly once across many calls (cached singleton)', async () => {
    setTree('a', doc([]));
    setTree('b', doc([]));
    setTree('c', doc([]));
    await parseHtml('a');
    await parseHtml('b');
    await parseHtml('c');
    // getParser memoizes the promise — init/load/construct/setLanguage all once.
    expect(initCount).toBe(1);
    expect(languageLoadCount).toBe(1);
    expect(parserConstructCount).toBe(1);
    expect(setLanguageCount).toBe(1);
  });

  it('propagates a parser throw', async () => {
    parseThrowFor.add('<bad>');
    await expect(parseHtml('<bad>')).rejects.toThrow('parse boom');
  });
});

describe('countH1', () => {
  it('counts a single semantic <h1>', async () => {
    const src = 'one-h1';
    setTree(src, doc([element('h1', [text('Title')])]));
    expect(await countH1(src)).toBe(1);
  });

  it('counts multiple <h1> elements (case-insensitive tag match)', async () => {
    const src = 'two-h1';
    setTree(
      src,
      doc([
        element('H1', [text('Upper')]),
        element('h1', [text('lower')]),
        element('p', [text('body')]),
      ]),
    );
    expect(await countH1(src)).toBe(2);
  });

  it('returns 0 when there are no <h1> elements', async () => {
    const src = 'no-h1';
    setTree(src, doc([element('h2', [text('sub')]), element('div', [text('x')])]));
    expect(await countH1(src)).toBe(0);
  });

  it('counts nested <h1> deep in the tree (recursive walk)', async () => {
    const src = 'nested-h1';
    setTree(
      src,
      doc([element('section', [element('article', [element('h1', [text('Deep')])])])]),
    );
    expect(await countH1(src)).toBe(1);
  });

  it('ignores an element whose start_tag has no tag_name node', async () => {
    const src = 'no-tagname';
    // element with a start_tag that carries only an attribute, no tag_name
    setTree(src, doc([{ type: 'element', children: [{ type: 'start_tag', children: [] }] }]));
    expect(await countH1(src)).toBe(0);
  });

  it('ignores an element with no start_tag child', async () => {
    const src = 'no-starttag';
    setTree(src, doc([{ type: 'element', children: [text('orphan')] }]));
    expect(await countH1(src)).toBe(0);
  });

  it('handles an empty document', async () => {
    const src = 'empty-doc';
    setTree(src, doc([]));
    expect(await countH1(src)).toBe(0);
  });
});

describe('extractVisibleText', () => {
  it('collects visible text nodes joined by single spaces', async () => {
    const src = 'visible';
    setTree(
      src,
      doc([element('p', [text('Hello')]), element('p', [text('World')])]),
    );
    expect(await extractVisibleText(src)).toBe('Hello World');
  });

  it('skips text inside a <script> element (script_element parent)', async () => {
    const src = 'script-skip';
    setTree(
      src,
      doc([
        element('p', [text('Keep')]),
        { type: 'script_element', children: [text('var x = "drop";')] },
      ]),
    );
    expect(await extractVisibleText(src)).toBe('Keep');
  });

  it('skips text inside a <style> element (style_element parent)', async () => {
    const src = 'style-skip';
    setTree(
      src,
      doc([
        { type: 'style_element', children: [text('.a{color:red}')] },
        element('p', [text('Shown')]),
      ]),
    );
    expect(await extractVisibleText(src)).toBe('Shown');
  });

  it('skips text nested deep inside a script (walks parent chain past wrappers)', async () => {
    const src = 'deep-script';
    setTree(
      src,
      doc([
        {
          type: 'script_element',
          children: [{ type: 'raw_text', children: [text('innerDrop')] }],
        },
        element('h1', [text('Visible')]),
      ]),
    );
    expect(await extractVisibleText(src)).toBe('Visible');
  });

  it('returns an empty string when there is no visible text', async () => {
    const src = 'no-text';
    setTree(src, doc([{ type: 'script_element', children: [text('only-script')] }]));
    expect(await extractVisibleText(src)).toBe('');
  });

  it('handles a text node with no parent (defensive: parent chain terminates)', async () => {
    const src = 'orphan-text';
    setTree(src, doc([text('Loose')]));
    expect(await extractVisibleText(src)).toBe('Loose');
  });
});

describe('extractAttributeRefs', () => {
  it('collects src and href from quoted attribute values, stripping quotes', async () => {
    const src = 'quoted-refs';
    setTree(
      src,
      doc([
        element('img', [], [attr('src', 'quoted_attribute_value', '"/logo.png"')]),
        element('a', [text('go')], [attr('href', 'quoted_attribute_value', "'/about'")]),
      ]),
    );
    expect(await extractAttributeRefs(src)).toEqual(['/logo.png', '/about']);
  });

  it('collects an unquoted attribute_value verbatim', async () => {
    const src = 'unquoted-ref';
    setTree(src, doc([element('img', [], [attr('src', 'attribute_value', '/raw.png')])]));
    expect(await extractAttributeRefs(src)).toEqual(['/raw.png']);
  });

  it('matches src/href case-insensitively', async () => {
    const src = 'case-attr';
    setTree(src, doc([element('img', [], [attr('SRC', 'quoted_attribute_value', '"/up.png"')])]));
    expect(await extractAttributeRefs(src)).toEqual(['/up.png']);
  });

  it('ignores non-src/href attributes', async () => {
    const src = 'other-attr';
    setTree(
      src,
      doc([element('div', [], [attr('class', 'quoted_attribute_value', '"hero"')])]),
    );
    expect(await extractAttributeRefs(src)).toEqual([]);
  });

  it('skips a src attribute that has no value node', async () => {
    const src = 'no-value';
    setTree(src, doc([element('img', [], [attr('src', null)])]));
    expect(await extractAttributeRefs(src)).toEqual([]);
  });

  it('skips an attribute that has no attribute_name node', async () => {
    const src = 'no-name';
    setTree(
      src,
      doc([
        {
          type: 'element',
          children: [
            startTag('img'),
            { type: 'attribute', children: [{ type: 'quoted_attribute_value', text: '"/x.png"' }] },
          ],
        },
      ]),
    );
    expect(await extractAttributeRefs(src)).toEqual([]);
  });

  it('drops an empty (quotes-only) value after stripping', async () => {
    const src = 'empty-value';
    setTree(src, doc([element('img', [], [attr('src', 'quoted_attribute_value', '""')])]));
    expect(await extractAttributeRefs(src)).toEqual([]);
  });

  it('keeps a value where only the leading quote is present (no symmetric strip)', async () => {
    const src = 'asymmetric-quote';
    // raw starts with " but does not end with " → strip branch is skipped
    setTree(src, doc([element('img', [], [attr('src', 'quoted_attribute_value', '"/half')])]));
    expect(await extractAttributeRefs(src)).toEqual(['"/half']);
  });

  it('returns empty for a document with no attribute nodes', async () => {
    const src = 'no-attrs';
    setTree(src, doc([element('p', [text('plain')])]));
    expect(await extractAttributeRefs(src)).toEqual([]);
  });
});

describe('findBannedWords', () => {
  it('reports a banned word with its visible-text count, case-insensitively', async () => {
    const src = 'banned-one';
    setTree(src, doc([element('p', [text('This is Seamless and seamless.')])]));
    const hits = await findBannedWords(src, ['seamless']);
    expect(hits).toEqual([{ word: 'seamless', count: 2 }]);
  });

  it('returns multiple banned words in input order', async () => {
    const src = 'banned-multi';
    setTree(src, doc([element('p', [text('A leverage and a robust thing')])]));
    const hits = await findBannedWords(src, ['robust', 'leverage', 'cutting-edge']);
    expect(hits).toEqual([
      { word: 'robust', count: 1 },
      { word: 'leverage', count: 1 },
    ]);
  });

  it('returns an empty array when no banned word is present', async () => {
    const src = 'banned-none';
    setTree(src, doc([element('p', [text('hand crafted since 1992')])]));
    expect(await findBannedWords(src, ['seamless', 'robust'])).toEqual([]);
  });

  it('does NOT match a banned word that only appears inside a <script> (visible-text only)', async () => {
    const src = 'banned-in-script';
    setTree(
      src,
      doc([
        element('p', [text('clean copy')]),
        { type: 'script_element', children: [text('const robust = true;')] },
      ]),
    );
    expect(await findBannedWords(src, ['robust'])).toEqual([]);
  });

  it('respects word boundaries (no partial match inside a larger word)', async () => {
    const src = 'banned-boundary';
    setTree(src, doc([element('p', [text('leveraged leveraging')])]));
    // \bleverage\b should not match "leveraged" or "leveraging"
    expect(await findBannedWords(src, ['leverage'])).toEqual([]);
  });

  it('handles an empty banned-word list', async () => {
    const src = 'banned-empty-list';
    setTree(src, doc([element('p', [text('anything robust here')])]));
    expect(await findBannedWords(src, [])).toEqual([]);
  });
});
