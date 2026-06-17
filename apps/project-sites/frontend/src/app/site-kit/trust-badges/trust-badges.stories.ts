import type { Meta, StoryObj } from '@storybook/angular';
import { TrustBadgesComponent } from './trust-badges.component';

const meta: Meta<TrustBadgesComponent> = {
  title: 'Site Kit/Conversion/TrustBadges',
  component: TrustBadgesComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<TrustBadgesComponent>;

export const Default: Story = {
  args: {
    badges: [
      { label: 'Licensed & Insured' },
      { label: '5-Star Rated' },
      { label: '24/7 Support' },
      { label: 'Free Estimates' },
      { label: 'Satisfaction Guaranteed' },
    ],
  },
};

export const Healthcare: Story = {
  args: {
    badges: [
      { label: 'Board Certified' },
      { label: 'HIPAA Compliant' },
      { label: 'Accepting New Patients' },
      { label: 'In-Network Insurance' },
    ],
  },
};
