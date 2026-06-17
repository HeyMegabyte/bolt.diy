import type { Meta, StoryObj } from '@storybook/angular';
import { ServiceAreaMapComponent } from './service-area-map.component';

const meta: Meta<ServiceAreaMapComponent> = {
  title: 'Site Kit/Industry/ServiceAreaMap',
  component: ServiceAreaMapComponent,
  tags: ['autodocs'],
  argTypes: {
    heading: { control: 'text' },
    subtitle: { control: 'text' },
    centerLabel: { control: 'text' },
    ctaText: { control: 'text' },
    ctaHref: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<ServiceAreaMapComponent>;

export const Default: Story = {};

export const PlumbingCompany: Story = {
  args: {
    heading: 'Our Service Area',
    subtitle: 'Fast-response plumbing in the greater metro area.',
    centerLabel: 'Downtown District',
    ctaText: 'Get a Free Quote',
    ctaHref: '#quote',
    zones: [
      { label: 'Priority Zone — 30-min response', color: 'var(--ps-accent,#00e5ff)', highlight: true },
      { label: 'Standard Zone — same-day', color: 'rgba(0,229,255,0.55)' },
      { label: 'Outlying Area — next-day', color: 'rgba(0,229,255,0.25)' },
    ],
  },
};

export const NoSubtitle: Story = {
  args: {
    subtitle: '',
    ctaText: '',
  },
};
