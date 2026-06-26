import type { GlobalConfig } from 'payload'
import { anyone, admins } from '../access'

const navLinks = (name: string) => ({
  name,
  type: 'array' as const,
  maxRows: 8,
  fields: [
    { name: 'label', type: 'text' as const, required: true },
    { name: 'url', type: 'text' as const, required: true },
  ],
})

/** Site-wide header nav. Read public; admin-only writes. */
export const Header: GlobalConfig = {
  slug: 'header',
  access: { read: anyone, update: admins },
  fields: [{ name: 'logo', type: 'upload', relationTo: 'media' }, navLinks('navItems')],
}

/** Site-wide footer nav + legal line. */
export const Footer: GlobalConfig = {
  slug: 'footer',
  access: { read: anyone, update: admins },
  fields: [navLinks('navItems'), { name: 'copyright', type: 'text' }],
}

/** Global site identity + SEO defaults + social handles. */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site Settings',
  access: { read: anyone, update: admins },
  fields: [
    { name: 'siteName', type: 'text', required: true, defaultValue: 'ProjectSites' },
    { name: 'tagline', type: 'text' },
    { name: 'defaultOgImage', type: 'upload', relationTo: 'media' },
    {
      name: 'social',
      type: 'group',
      fields: [
        { name: 'twitter', type: 'text' },
        { name: 'github', type: 'text' },
        { name: 'linkedin', type: 'text' },
      ],
    },
  ],
}

export const globals = [Header, Footer, SiteSettings]
