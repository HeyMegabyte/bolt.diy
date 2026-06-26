import type { Block } from 'payload'

/**
 * Page-builder blocks for the `Pages.layout` field. Editors compose a page from a
 * predefined, type-safe component set instead of free-form rich text — the standard
 * Payload page-builder pattern. Each block round-trips to a React renderer in
 * `app/(frontend)/blocks/`. See payloadcms.com/docs/fields/blocks.
 */

export const Hero: Block = {
  slug: 'hero',
  interfaceName: 'HeroBlock',
  labels: { singular: 'Hero', plural: 'Heroes' },
  fields: [
    {
      name: 'variant',
      type: 'select',
      defaultValue: 'centered',
      options: ['centered', 'left', 'split'],
    },
    { name: 'heading', type: 'text', required: true },
    { name: 'subheading', type: 'textarea' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'links',
      type: 'array',
      maxRows: 2,
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
        {
          name: 'style',
          type: 'select',
          defaultValue: 'primary',
          options: ['primary', 'secondary'],
        },
      ],
    },
  ],
}

export const Content: Block = {
  slug: 'content',
  interfaceName: 'ContentBlock',
  fields: [
    {
      name: 'columns',
      type: 'select',
      defaultValue: 'one',
      options: ['one', 'two', 'three'],
    },
    { name: 'richText', type: 'richText' },
  ],
}

export const MediaBlock: Block = {
  slug: 'mediaBlock',
  interfaceName: 'MediaBlock',
  fields: [
    { name: 'media', type: 'upload', relationTo: 'media', required: true },
    { name: 'caption', type: 'text' },
    { name: 'fullBleed', type: 'checkbox', defaultValue: false },
  ],
}

export const CallToAction: Block = {
  slug: 'cta',
  interfaceName: 'CallToActionBlock',
  labels: { singular: 'Call To Action', plural: 'Calls To Action' },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'body', type: 'textarea' },
    { name: 'buttonLabel', type: 'text', required: true },
    { name: 'buttonUrl', type: 'text', required: true },
  ],
}

export const Archive: Block = {
  slug: 'archive',
  interfaceName: 'ArchiveBlock',
  labels: { singular: 'Post Archive', plural: 'Post Archives' },
  fields: [
    { name: 'heading', type: 'text' },
    {
      name: 'populateBy',
      type: 'select',
      defaultValue: 'latest',
      options: [
        { label: 'Latest posts', value: 'latest' },
        { label: 'Hand-picked', value: 'selection' },
      ],
    },
    { name: 'limit', type: 'number', defaultValue: 6, admin: { step: 1 } },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      admin: { condition: (_, s) => s?.populateBy === 'latest' },
    },
    {
      name: 'selectedPosts',
      type: 'relationship',
      relationTo: 'posts',
      hasMany: true,
      admin: { condition: (_, s) => s?.populateBy === 'selection' },
    },
  ],
}

export const layoutBlocks = [Hero, Content, MediaBlock, CallToAction, Archive]
