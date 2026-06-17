import type { Meta, StoryObj } from '@storybook/angular';
import { SkLogoCloudComponent } from './logo-cloud.component';

const meta: Meta<SkLogoCloudComponent> = {
  title: 'Site Kit/Marketing/LogoCloud',
  component: SkLogoCloudComponent,
  tags: ['autodocs'],
  args: {
    label: 'Trusted by teams at',
    logos: [
      { name: 'Acme Corp' },
      { name: 'Globex' },
      { name: 'Initech' },
      { name: 'Umbrella' },
      { name: 'Hooli' },
      { name: 'Pied Piper' },
      { name: 'Dunder Mifflin' },
    ],
  },
};
export default meta;
type Story = StoryObj<SkLogoCloudComponent>;

export const Default: Story = {};

export const NoLabel: Story = {
  args: { label: '' },
};
