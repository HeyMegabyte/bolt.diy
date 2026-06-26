import React from 'react'
import { RichText } from '@payloadcms/richtext-lexical/react'

type Media = { url?: string; alt?: string; sizes?: Record<string, { url?: string }> }
type AnyBlock = Record<string, unknown> & { blockType: string }

const mediaUrl = (m: unknown, size?: string): string | undefined => {
  const media = m as Media | undefined
  if (!media) return undefined
  return (size && media.sizes?.[size]?.url) || media.url
}

const Img = ({ media, size, className }: { media: unknown; size?: string; className?: string }) => {
  const url = mediaUrl(media, size)
  if (!url) return null
  const alt = (media as Media)?.alt ?? ''
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" />
}

/** Renders one page-builder block. Mirrors src/blocks definitions. */
const Block = ({ block }: { block: AnyBlock }) => {
  switch (block.blockType) {
    case 'hero':
      return (
        <section className={`hero hero--${String(block.variant ?? 'centered')}`}>
          <div className="hero__inner">
            <h1>{String(block.heading ?? '')}</h1>
            {block.subheading ? <p className="hero__sub">{String(block.subheading)}</p> : null}
            {Array.isArray(block.links) && block.links.length > 0 ? (
              <div className="hero__links">
                {block.links.map((l, i) => {
                  const link = l as { label?: string; url?: string; style?: string }
                  return (
                    <a key={i} href={link.url} className={`btn btn--${link.style ?? 'primary'}`}>
                      {link.label}
                    </a>
                  )
                })}
              </div>
            ) : null}
          </div>
          {block.image ? <Img media={block.image} size="feature" className="hero__img" /> : null}
        </section>
      )
    case 'content':
      return (
        <section className={`content content--${String(block.columns ?? 'one')}`}>
          {block.richText ? <RichText data={block.richText as never} /> : null}
        </section>
      )
    case 'mediaBlock':
      return (
        <figure className={block.fullBleed ? 'media media--full' : 'media'}>
          <Img media={block.media} size="feature" />
          {block.caption ? <figcaption>{String(block.caption)}</figcaption> : null}
        </figure>
      )
    case 'cta':
      return (
        <section className="cta">
          <h2>{String(block.heading ?? '')}</h2>
          {block.body ? <p>{String(block.body)}</p> : null}
          <a className="btn btn--primary" href={String(block.buttonUrl ?? '#')}>
            {String(block.buttonLabel ?? '')}
          </a>
        </section>
      )
    case 'archive':
      return (
        <section className="archive">
          {block.heading ? <h2>{String(block.heading)}</h2> : null}
        </section>
      )
    default:
      return null
  }
}

export const RenderBlocks = ({ blocks }: { blocks?: AnyBlock[] }) => {
  if (!Array.isArray(blocks)) return null
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  )
}
