import type { Meta, StoryObj } from '@storybook/angular';
import { SkSiteNavbarComponent } from './site-navbar.component';

const meta: Meta<SkSiteNavbarComponent> = {
  title: 'Site Kit/Marketing/SiteNavbar',
  component: SkSiteNavbarComponent,
  tags: ['autodocs'],
  args: {
    brandName: 'Acme Inc.',
    logoHref: '/',
    ctaLabel: 'Get Started',
    ctaHref: '#contact',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
};
export default meta;
type Story = StoryObj<SkSiteNavbarComponent>;

export const Default: Story = {};

export const SaaSBrand: Story = {
  args: {
    brandName: 'LaunchPad',
    ctaLabel: 'Start Free Trial',
    links: [
      { label: 'Product', href: '#product' },
      { label: 'Docs', href: '#docs' },
      { label: 'Blog', href: '#blog' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
};
