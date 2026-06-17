import type { Meta, StoryObj } from '@storybook/angular';
import { StickyCallBarComponent } from './sticky-call-bar.component';

const meta: Meta<StickyCallBarComponent> = {
  title: 'Site Kit/Conversion/StickyCallBar',
  component: StickyCallBarComponent,
  tags: ['autodocs'],
  argTypes: {
    message: { control: 'text' },
    phone: { control: 'text' },
    ctaLabel: { control: 'text' },
    ctaHref: { control: 'text' },
    label: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<StickyCallBarComponent>;

export const WithPhone: Story = {
  args: {
    message: 'Speak with a specialist today — no obligation.',
    phone: '+15555550100',
    ctaLabel: 'Call (555) 555-0100',
  },
};

export const WithLink: Story = {
  args: {
    message: 'Limited slots available. Book before they fill up.',
    ctaLabel: 'Book Now',
    ctaHref: '/book',
  },
};
