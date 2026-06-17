import type { Meta, StoryObj } from '@storybook/angular';
import { ProcessStepsComponent } from './process-steps.component';

const meta: Meta<ProcessStepsComponent> = {
  title: 'Site Kit/Conversion/ProcessSteps',
  component: ProcessStepsComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<ProcessStepsComponent>;

export const Default: Story = {
  args: {
    heading: 'How It Works',
  },
};

export const ThreeSteps: Story = {
  args: {
    heading: 'Our Process',
    steps: [
      { title: 'Consult', description: 'Tell us about your project in a free 15-minute call.' },
      { title: 'Design', description: 'We craft a customized plan tailored to your needs and budget.' },
      { title: 'Deliver', description: 'Our team executes flawlessly, on time and on budget.' },
    ],
  },
};
