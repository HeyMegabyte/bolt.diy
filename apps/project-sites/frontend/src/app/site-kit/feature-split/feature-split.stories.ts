import type { Meta, StoryObj } from '@storybook/angular';
import { SkFeatureSplitComponent } from './feature-split.component';

const meta: Meta<SkFeatureSplitComponent> = {
  title: 'Site Kit/Marketing/FeatureSplit',
  component: SkFeatureSplitComponent,
  tags: ['autodocs'],
  args: {
    items: [
      {
        eyebrow: 'Collaboration',
        heading: 'Work together, ship together',
        body: 'Real-time collaboration tools that keep your team aligned across every timezone.',
        imageSrc: 'https://picsum.photos/seed/feat1/800/500',
        imageAlt: 'Collaboration dashboard',
        imageRight: false,
      },
      {
        eyebrow: 'Automation',
        heading: 'Let the machine do the heavy lifting',
        body: 'Automate repetitive tasks with powerful workflow tools.',
        imageSrc: 'https://picsum.photos/seed/feat2/800/500',
        imageAlt: 'Automation workflow',
        imageRight: true,
      },
    ],
  },
};
export default meta;
type Story = StoryObj<SkFeatureSplitComponent>;

export const Default: Story = {};

export const SingleItem: Story = {
  args: {
    items: [
      {
        heading: 'Build in minutes',
        body: 'Go from idea to production in the time it used to take to set up a dev environment.',
        imageSrc: 'https://picsum.photos/seed/single/800/500',
        imageAlt: 'Build faster',
      },
    ],
  },
};
