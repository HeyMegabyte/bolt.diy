import type { Meta, StoryObj } from '@storybook/angular';
import { MultiStepFormComponent } from './multi-step-form.component';

const meta: Meta<MultiStepFormComponent> = {
  title: 'Site Kit/Conversion/MultiStepForm',
  component: MultiStepFormComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<MultiStepFormComponent>;

export const Default: Story = {
  args: {
    submitLabel: 'Submit Request',
  },
};

export const TwoStep: Story = {
  args: {
    submitLabel: 'Get My Free Quote',
    steps: [
      {
        title: 'Contact Info',
        fields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: 'Your name', required: true },
          { key: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', required: true },
        ],
      },
      {
        title: 'What do you need?',
        fields: [
          { key: 'details', label: 'Project details', type: 'textarea', placeholder: 'Describe your project…', required: true },
        ],
      },
    ],
  },
};
