import type { FieldHook } from 'payload'

/** Recursively pull plain text out of a Lexical AST node tree. */
const extractText = (node: unknown): string => {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; children?: unknown[] }
  let out = typeof n.text === 'string' ? `${n.text} ` : ''
  if (Array.isArray(n.children)) out += n.children.map(extractText).join('')
  return out
}

/**
 * Virtual `readingTime` (minutes) computed from the `content` Lexical field on read.
 * 200 wpm, floor of 1. Not stored — derived every read so it can never drift.
 */
export const computeReadingTime: FieldHook = ({ siblingData }) => {
  const root = (siblingData?.content as { root?: unknown })?.root
  const words = extractText(root).trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}
