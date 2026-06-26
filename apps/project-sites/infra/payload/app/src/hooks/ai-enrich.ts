import type { CollectionBeforeChangeHook } from 'payload'

/** Pull plain text from a Lexical AST node tree. */
const extractText = (node: unknown): string => {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; children?: unknown[] }
  let out = typeof n.text === 'string' ? `${n.text} ` : ''
  if (Array.isArray(n.children)) out += n.children.map(extractText).join('')
  return out
}

/**
 * AI auto-excerpt: when a post is published with no excerpt, generate a tight summary
 * from its content via OpenAI. Dark-safe — a no-op when `OPENAI_API_KEY` is unset, so
 * the field stays editor-controlled until the key is provisioned.
 *
 * @remarks Runs on beforeChange (before validation persists), never overwrites an
 * existing excerpt, and fails open: any API error leaves the doc untouched + logs.
 */
export const aiAutoExcerpt: CollectionBeforeChangeHook = async ({ data, req }) => {
  const key = process.env.OPENAI_API_KEY
  if (!key) return data
  if (data?._status !== 'published') return data
  if (typeof data.excerpt === 'string' && data.excerpt.trim().length > 0) return data

  const body = extractText((data?.content as { root?: unknown })?.root).trim().slice(0, 6000)
  if (body.length < 80) return data

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 90,
        messages: [
          {
            role: 'system',
            content:
              'Write a single compelling meta-description for this blog post. 120-156 characters, active voice, no hype words, no quotes. Return only the sentence.',
          },
          { role: 'user', content: body },
        ],
      }),
    })
    if (!res.ok) {
      req.payload.logger.warn(`aiAutoExcerpt: OpenAI ${res.status}`)
      return data
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = json.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '')
    if (text) return { ...data, excerpt: text.slice(0, 300) }
  } catch (err) {
    req.payload.logger.error({ err }, 'aiAutoExcerpt failed')
  }
  return data
}
