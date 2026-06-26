import {
  lexicalEditor,
  FixedToolbarFeature,
  HeadingFeature,
  LinkFeature,
  BlocksFeature,
  HorizontalRuleFeature,
  InlineToolbarFeature,
} from '@payloadcms/richtext-lexical'
import { CallToAction, MediaBlock } from './blocks'

/**
 * Project-wide Lexical editor. Adds a fixed + inline toolbar, a constrained heading
 * set, internal-document links (so editors can link to Pages/Posts by reference, not
 * raw URL), a horizontal rule, and the ability to embed CTA / Media blocks inline in
 * body copy. Output is portable JSON AST, rendered server-side on the frontend.
 */
export const defaultEditor = lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures,
    FixedToolbarFeature(),
    InlineToolbarFeature(),
    HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4'] }),
    HorizontalRuleFeature(),
    LinkFeature({
      enabledCollections: ['pages', 'posts'],
      fields: ({ defaultFields }) => [
        ...defaultFields,
        {
          name: 'rel',
          type: 'select',
          hasMany: true,
          options: ['noopener', 'noreferrer', 'nofollow'],
          admin: { description: 'rel attribute for the anchor' },
        },
      ],
    }),
    BlocksFeature({ blocks: [MediaBlock], inlineBlocks: [CallToAction] }),
  ],
})
