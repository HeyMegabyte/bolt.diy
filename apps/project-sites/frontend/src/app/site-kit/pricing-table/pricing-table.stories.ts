import type { Meta, StoryObj } from '@storybook/angular';
import { SkPricingTableComponent } from './pricing-table.component';

const meta: Meta<SkPricingTableComponent> = {
  title: 'Site Kit/Marketing/PricingTable',
  component: SkPricingTableComponent,
  tags: ['autodocs'],
  args: {
    heading: 'Simple, transparent pricing',
    subheading: 'No hidden fees. Cancel anytime.',
    tiers: [
      {
        name: 'Starter', price: '$0', period: '/month',
        description: 'Perfect for side projects.',
        features: ['3 projects', '10k requests/mo', 'Community support'],
        ctaLabel: 'Get started free', ctaHref: '#signup',
      },
      {
        name: 'Pro', price: '$49', period: '/month',
        description: 'For growing teams.',
        features: ['Unlimited projects', '1M requests/mo', 'Priority support'],
        ctaLabel: 'Start free trial', ctaHref: '#trial', popular: true,
      },
      {
        name: 'Enterprise', price: 'Custom',
        description: 'Tailored for large orgs.',
        features: ['Unlimited everything', 'SLA guarantee', 'Dedicated support'],
        ctaLabel: 'Contact sales', ctaHref: '#contact',
      },
    ],
  },
};
export default meta;
type Story = StoryObj<SkPricingTableComponent>;

export const Default: Story = {};
