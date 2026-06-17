import type { Meta, StoryObj } from '@storybook/angular';
import { RollingCounterComponent } from './rolling-counter.component';

/**
 * `<app-rolling-counter>` — every numeric stat on projectsites.dev animates up
 * from 0 via requestAnimationFrame (easeOutQuart), locale-formatted, and snaps to
 * the final value under `prefers-reduced-motion`. Fires when scrolled into view.
 */
const meta: Meta<RollingCounterComponent> = {
  title: 'Cinematic UI/Rolling Counter',
  component: RollingCounterComponent,
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'number' }, description: 'Target value (required)' },
    duration: { control: { type: 'number' }, description: 'Animation duration (ms)' },
    prefix: { control: 'text' },
    suffix: { control: 'text' },
    decimals: { control: { type: 'number' } },
    locale: { control: 'text' },
    threshold: { control: { type: 'number' } },
  },
  args: { value: 2480, suffix: '+', duration: 1400, prefix: '', decimals: 0, locale: 'en-US' },
};
export default meta;
type Story = StoryObj<RollingCounterComponent>;

/** Integer with thousands separator + plus suffix. */
export const Default: Story = {};

/** Decimal percentage (uptime-style). */
export const Percentage: Story = { args: { value: 99.99, decimals: 2, suffix: '%' } };

/** Currency with a slower count. */
export const Currency: Story = { args: { value: 50000, prefix: '$', suffix: '', duration: 1800 } };

/** Seconds. */
export const Seconds: Story = { args: { value: 42, suffix: 's', decimals: 0 } };
