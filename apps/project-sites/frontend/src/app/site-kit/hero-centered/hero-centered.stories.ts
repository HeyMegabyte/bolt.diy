import type { Meta, StoryObj } from '@storybook/angular';
import { SkHeroCenteredComponent } from './hero-centered.component';

const meta: Meta<SkHeroCenteredComponent> = {
  title: 'Site Kit/Marketing/HeroCentered',
  component: SkHeroCenteredComponent,
  tags: ['autodocs'],
  args: {
    eyebrow: 'Now in beta',
    heading: 'The platform built for makers',
    subheading: 'Design, build, and ship your next product — faster than you thought possible.',
    primaryCtaLabel: 'Get early access',
    primaryCtaHref: '#signup',
    secondaryCtaLabel: 'Learn more',
    secondaryCtaHref: '#features',
  },
};
export default meta;
type Story = StoryObj<SkHeroCenteredComponent>;

export const Default: Story = {};

export const SingleCTA: Story = {
  args: { secondaryCtaLabel: '' },
};
