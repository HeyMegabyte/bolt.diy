import type { Meta, StoryObj } from '@storybook/angular';
import { SkCtaBandComponent } from './cta-band.component';

const meta: Meta<SkCtaBandComponent> = {
  title: 'Site Kit/Marketing/CtaBand',
  component: SkCtaBandComponent,
  tags: ['autodocs'],
  args: {
    heading: 'Ready to get started?',
    subheading: 'Join over 10,000 teams building the future. Start for free today.',
    primaryCtaLabel: 'Start free trial',
    primaryCtaHref: '#signup',
    secondaryCtaLabel: 'Talk to sales',
    secondaryCtaHref: '#contact',
    footnote: 'No credit card required · Cancel anytime',
  },
};
export default meta;
type Story = StoryObj<SkCtaBandComponent>;

export const Default: Story = {};

export const SingleCTA: Story = {
  args: {
    secondaryCtaLabel: '',
    footnote: '',
  },
};

export const NoFootnote: Story = {
  args: { footnote: '' },
};
