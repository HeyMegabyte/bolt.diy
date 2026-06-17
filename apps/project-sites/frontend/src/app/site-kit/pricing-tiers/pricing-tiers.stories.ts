import type { Meta, StoryObj } from '@storybook/angular';
import { PricingTiersComponent } from './pricing-tiers.component';

const meta: Meta<PricingTiersComponent> = {
  title: 'Site Kit/Industry/PricingTiers',
  component: PricingTiersComponent,
  tags: ['autodocs'],
  argTypes: {
    heading: { control: 'text' },
    subtitle: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<PricingTiersComponent>;

export const Default: Story = {};

export const LawnCare: Story = {
  args: {
    heading: 'Lawn Care Packages',
    subtitle: 'Seasonal contracts. Flat-rate pricing. No surprises.',
    tiers: [
      {
        name: 'Basic',
        price: 79,
        period: 'visit',
        description: 'Mow, edge, and blow.',
        features: [
          { text: 'Mowing', included: true },
          { text: 'Edging', included: true },
          { text: 'Blowing', included: true },
          { text: 'Fertilizing', included: false },
          { text: 'Aeration', included: false },
        ],
        ctaLabel: 'Book Basic',
        ctaHref: '#basic',
      },
      {
        name: 'Full Care',
        price: 149,
        period: 'visit',
        badge: 'Best Value',
        highlighted: true,
        description: 'Everything in Basic + fertilizing.',
        features: [
          { text: 'Mowing', included: true },
          { text: 'Edging', included: true },
          { text: 'Blowing', included: true },
          { text: 'Fertilizing', included: true },
          { text: 'Aeration', included: false },
        ],
        ctaLabel: 'Book Full Care',
        ctaHref: '#full',
      },
      {
        name: 'Premium',
        price: 249,
        period: 'visit',
        description: 'Full seasonal program with aeration.',
        features: [
          { text: 'Mowing', included: true },
          { text: 'Edging', included: true },
          { text: 'Blowing', included: true },
          { text: 'Fertilizing', included: true },
          { text: 'Aeration', included: true },
        ],
        ctaLabel: 'Book Premium',
        ctaHref: '#premium',
      },
    ],
  },
};
