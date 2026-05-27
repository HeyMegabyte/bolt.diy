/**
 * @module services/html_ast
 * @description AST-aware HTML parsing for build validators via web-tree-sitter.
 *
 * Replaces the regex-based scans in `build_validators.ts` with a real HTML
 * parse, eliminating false positives where banned slop words sit inside
 * `<script>` string literals, where `<h1>` appears in a JS template, or where
 * an asset URL is part of a comment.
 *
 * Loads `tree-sitter.wasm` + `tree-sitter-html.wasm` (≈200 KB combined,
 * cached for the worker's lifetime).
 *
 * @see services/build_validators.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Parser = any;
type Tree = any;
type Node = any;

let parserPromise: Promise<Parser> | null = null;

async function getParser(): Promise<Parser> {
  if (parserPromise) return parserPromise;
  parserPromise = (async () => {
    const [mod, { default: treeSitterCoreWasm }, { default: htmlGrammarWasm }] = await Promise.all([
      import('web-tree-sitter'),
      import('web-tree-sitter/tree-sitter.wasm' as any),
      import('../wasm/tree-sitter-html.wasm' as any),
    ]);
    const TreeSitter = (mod as any).default ?? mod;
    await TreeSitter.init({
      locateFile: () => 'tree-sitter.wasm',
      wasmBinary: treeSitterCoreWasm,
    });
    const HtmlLang = await TreeSitter.Language.load(htmlGrammarWasm as unknown as ArrayBuffer);
    const parser = new TreeSitter.Parser();
    parser.setLanguage(HtmlLang);
    return parser;
  })();
  return parserPromise;
}

/** Parse HTML source into a tree-sitter Tree. */
export async function parseHtml(source: string): Promise<Tree> {
  const parser = await getParser();
  return parser.parse(source);
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    walk(node.namedChild(i), visit);
  }
}

/**
 * Count semantic `<h1>` elements in the document. Skips occurrences inside
 * `<script>`/`<style>` content, comments, and HTML attribute values.
 */
export async function countH1(source: string): Promise<number> {
  const tree = await parseHtml(source);
  let count = 0;
  walk(tree.rootNode, (n: Node) => {
    if (n.type === 'element') {
      const startTag = n.namedChildren?.find?.((c: Node) => c.type === 'start_tag');
      const tagNameNode = startTag?.namedChildren?.find?.((c: Node) => c.type === 'tag_name');
      if (tagNameNode && tagNameNode.text.toLowerCase() === 'h1') count++;
    }
  });
  return count;
}

/**
 * Collect every visible text node, skipping `<script>` and `<style>` contents.
 * Returned strings are concatenated in document order with single-space joins.
 */
export async function extractVisibleText(source: string): Promise<string> {
  const tree = await parseHtml(source);
  const parts: string[] = [];
  walk(tree.rootNode, (n: Node) => {
    if (n.type === 'text') {
      // Skip if the nearest enclosing element is script/style — tree-sitter
      // models these as `script_element` / `style_element` parent types.
      let p = n.parent;
      let inScriptOrStyle = false;
      while (p) {
        if (p.type === 'script_element' || p.type === 'style_element') {
          inScriptOrStyle = true;
          break;
        }
        p = p.parent;
      }
      if (!inScriptOrStyle) parts.push(n.text);
    }
  });
  return parts.join(' ');
}

/**
 * Collect every internal asset ref from real `src=`/`href=` attributes —
 * skipping attribute look-alikes inside script string literals or comments.
 */
export async function extractAttributeRefs(source: string): Promise<string[]> {
  const tree = await parseHtml(source);
  const refs: string[] = [];
  walk(tree.rootNode, (n: Node) => {
    if (n.type !== 'attribute') return;
    const nameNode = n.namedChildren?.find?.((c: Node) => c.type === 'attribute_name');
    if (!nameNode) return;
    const name = nameNode.text.toLowerCase();
    if (name !== 'src' && name !== 'href') return;
    const valueNode = n.namedChildren?.find?.(
      (c: Node) => c.type === 'quoted_attribute_value' || c.type === 'attribute_value',
    );
    if (!valueNode) return;
    let raw = valueNode.text;
    // Strip surrounding quotes left by tree-sitter on quoted variants.
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    if (raw) refs.push(raw);
  });
  return refs;
}

/**
 * Tag a banned word as present in the visible body text only (not inside
 * scripts, styles, or attribute values).
 */
export async function findBannedWords(
  source: string,
  bannedWords: readonly string[],
): Promise<{ word: string; count: number }[]> {
  const text = await extractVisibleText(source);
  const lowered = text.toLowerCase();
  const out: { word: string; count: number }[] = [];
  for (const word of bannedWords) {
    const re = new RegExp(`\\b${word.toLowerCase()}\\b`, 'g');
    const matches = lowered.match(re);
    if (matches?.length) out.push({ word, count: matches.length });
  }
  return out;
}
