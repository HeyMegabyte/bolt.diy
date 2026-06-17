import type { Meta, StoryObj } from '@storybook/angular';
import { SkHeroSplitComponent } from './hero-split.component';

const meta: Meta<SkHeroSplitComponent> = {
  title: 'Site Kit/Marketing/HeroSplit',
  component: SkHeroSplitComponent,
  tags: ['autodocs'],
  args: {
    eyebrow: 'Introducing v2.0',
    heading: 'Ship faster with AI-powered tools',
    subheading: 'Everything your team needs to build, launch, and scale — in one platform.',
    primaryCtaLabel: 'Start for free',
    primaryCtaHref: '#signup',
    secondaryCtaLabel: 'Watch demo',
    secondaryCtaHref: '#demo',
    imageSrc: 'https://picsum.photos/seed/hero/800/600',
    imageAlt: 'Product screenshot',
  },
};
export default meta;
type Story = StoryObj<SkHeroSplitComponent>;

export const Default: Story = {};

export const NoCTASecondary: Story = {
  args: { secondaryCtaLabel: '' },
};

export const NoEyebrow: Story = {
  args: { eyebrow: '' },
};
