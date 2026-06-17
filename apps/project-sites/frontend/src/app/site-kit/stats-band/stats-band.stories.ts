import type { Meta, StoryObj } from '@storybook/angular';
import { SkStatsBandComponent } from './stats-band.component';

const meta: Meta<SkStatsBandComponent> = {
  title: 'Site Kit/Marketing/StatsBand',
  component: SkStatsBandComponent,
  tags: ['autodocs'],
  args: {
    heading: '',
    stats: [
      { value: '10M+', label: 'Active users' },
      { value: '99.9%', label: 'Uptime SLA' },
      { value: '<50ms', label: 'Median latency' },
      { value: '180+', label: 'Countries served' },
    ],
  },
};
export default meta;
type Story = StoryObj<SkStatsBandComponent>;

export const Default: Story = {};

export const WithHeading: Story = {
  args: { heading: 'Numbers that speak for themselves' },
};
