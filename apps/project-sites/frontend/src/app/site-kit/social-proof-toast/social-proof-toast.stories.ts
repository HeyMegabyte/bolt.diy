import type { Meta, StoryObj } from '@storybook/angular';
import { SocialProofToastComponent } from './social-proof-toast.component';

const meta: Meta<SocialProofToastComponent> = {
  title: 'Site Kit/Conversion/SocialProofToast',
  component: SocialProofToastComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<SocialProofToastComponent>;

export const Default: Story = {
  args: {
    entries: [
      { name: 'Maria S.', action: 'just booked a consultation', location: 'Austin, TX', ago: '2 min ago' },
      { name: 'James K.', action: 'requested a free estimate', location: 'Denver, CO', ago: '5 min ago' },
      { name: 'Priya L.', action: 'left a 5-star review', ago: 'Just now' },
    ],
    intervalMs: 3000,
    displayMs: 2500,
  },
};
