import type { Meta, StoryObj } from '@storybook/angular';
import { SkSiteFooterComponent } from './site-footer.component';

const meta: Meta<SkSiteFooterComponent> = {
  title: 'Site Kit/Marketing/Site Footer',
  component: SkSiteFooterComponent,
  tags: ['autodocs'],
  args: {
    brand: 'Acme Co.',
    tagline: 'Building great products for the people who matter most.',
    copyright: `© ${new Date().getFullYear()} Acme Co. All rights reserved.`,
    groups: [
      {
        heading: 'Product',
        links: [
          { label: 'Features', href: '#features' },
          { label: 'Pricing', href: '#pricing' },
          { label: 'Changelog', href: '#changelog' },
          { label: 'Roadmap', href: '#roadmap' },
        ],
      },
      {
        heading: 'Company',
        links: [
          { label: 'About', href: '#about' },
          { label: 'Blog', href: '#blog' },
          { label: 'Careers', href: '#careers' },
          { label: 'Press', href: '#press' },
        ],
      },
      {
        heading: 'Support',
        links: [
          { label: 'Docs', href: '#docs' },
          { label: 'Status', href: '#status' },
          { label: 'Contact', href: '#contact' },
        ],
      },
    ],
    legalLinks: [
      { label: 'Privacy Policy', href: '#privacy' },
      { label: 'Terms of Service', href: '#terms' },
      { label: 'Cookie Policy', href: '#cookies' },
    ],
  },
};

export default meta;
type Story = StoryObj<SkSiteFooterComponent>;

export const Default: Story = {};

export const NoSocials: Story = {
  args: {
    socials: [],
    brand: 'Studio Zero',
    tagline: 'Crafting digital experiences with purpose and precision.',
  },
};

export const MinimalGroups: Story = {
  args: {
    groups: [
      {
        heading: 'Links',
        links: [
          { label: 'Home', href: '/' },
          { label: 'About', href: '/about' },
          { label: 'Contact', href: '/contact' },
        ],
      },
    ],
    legalLinks: [{ label: 'Privacy', href: '#privacy' }],
    tagline: 'Simple footer for a simple site.',
  },
};

export const NoLegalLinks: Story = {
  args: {
    legalLinks: [],
    copyright: '© 2025 My Brand',
  },
};
