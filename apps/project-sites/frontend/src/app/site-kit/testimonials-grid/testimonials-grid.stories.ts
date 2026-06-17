import type { Meta, StoryObj } from '@storybook/angular';
import { SkTestimonialsGridComponent } from './testimonials-grid.component';

const meta: Meta<SkTestimonialsGridComponent> = {
  title: 'Site Kit/Marketing/TestimonialsGrid',
  component: SkTestimonialsGridComponent,
  tags: ['autodocs'],
  args: {
    heading: 'What our customers say',
    subheading: 'Join thousands of teams that ship faster with us.',
    testimonials: [
      { quote: 'This platform cut our deployment time by 80%. We ship features every day now.', name: 'Sarah K.', title: 'CTO, Fintech Startup' },
      { quote: 'The DX is unmatched. Our engineers love it — onboarding is down to 20 minutes.', name: 'Marcus T.', title: 'VP Engineering, SaaS Co.' },
      { quote: 'Finally, a tool that does what it says on the tin. No hidden complexity.', name: 'Aisha R.', title: 'Lead Developer, Agency' },
    ],
  },
};
export default meta;
type Story = StoryObj<SkTestimonialsGridComponent>;

export const Default: Story = {};

export const WithAvatars: Story = {
  args: {
    testimonials: [
      { quote: 'Incredible tool for our workflow.', name: 'Jordan Lee', title: 'Founder', avatarSrc: 'https://picsum.photos/seed/av1/80/80' },
      { quote: 'Saved us weeks of engineering time.', name: 'Priya N.', title: 'Engineering Lead', avatarSrc: 'https://picsum.photos/seed/av2/80/80' },
    ],
  },
};
