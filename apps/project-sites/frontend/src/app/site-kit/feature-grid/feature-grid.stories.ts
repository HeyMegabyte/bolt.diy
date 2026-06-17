import type { Meta, StoryObj } from '@storybook/angular';
import { SkFeatureGridComponent } from './feature-grid.component';

const meta: Meta<SkFeatureGridComponent> = {
  title: 'Site Kit/Marketing/FeatureGrid',
  component: SkFeatureGridComponent,
  tags: ['autodocs'],
  args: {
    heading: 'Everything you need',
    subheading: 'Powerful features to help your team build better products, faster.',
    features: [
      { icon: '⚡', title: 'Lightning Fast', description: 'Sub-second response times on every request, globally distributed.' },
      { icon: '🔒', title: 'Secure by Default', description: 'End-to-end encryption and zero-trust security baked in from day one.' },
      { icon: '📊', title: 'Rich Analytics', description: 'Real-time dashboards that surface the insights your business needs.' },
      { icon: '🤖', title: 'AI-Powered', description: 'Intelligent automation that learns and adapts to your workflows.' },
      { icon: '🌍', title: 'Global Scale', description: 'Deploy to 200+ edge locations with a single command.' },
      { icon: '🔧', title: 'Easy Integration', description: 'Connect with your existing stack in minutes, not months.' },
    ],
  },
};
export default meta;
type Story = StoryObj<SkFeatureGridComponent>;

export const Default: Story = {};

export const ThreeCards: Story = {
  args: {
    features: [
      { icon: '⚡', title: 'Speed', description: 'Blazing fast performance at the edge.' },
      { icon: '🔒', title: 'Security', description: 'Built-in protection with zero config.' },
      { icon: '📊', title: 'Insights', description: 'Know what matters, when it matters.' },
    ],
  },
};
