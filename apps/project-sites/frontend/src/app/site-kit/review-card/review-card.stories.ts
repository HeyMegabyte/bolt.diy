import type { Meta, StoryObj } from '@storybook/angular';
import { ReviewCardComponent } from './review-card.component';

const meta: Meta<ReviewCardComponent> = {
  title: 'Site Kit/Conversion/ReviewCard',
  component: ReviewCardComponent,
  tags: ['autodocs'],
  argTypes: {
    rating: { control: { type: 'range', min: 1, max: 5, step: 1 } },
  },
};
export default meta;
type Story = StoryObj<ReviewCardComponent>;

export const FiveStar: Story = {
  args: {
    reviewer: 'Sarah M.',
    role: 'Homeowner',
    body: 'Absolutely incredible experience. They arrived on time, explained everything clearly, and the job was done perfectly.',
    rating: 5,
    platform: 'Google',
  },
};

export const FourStar: Story = {
  args: {
    reviewer: 'Tom R.',
    body: 'Great work overall. Very professional crew. Would hire again.',
    rating: 4,
    platform: 'Yelp',
  },
};
