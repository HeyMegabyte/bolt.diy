import type { Meta, StoryObj } from '@storybook/angular';
import { SkNewsletterSignupComponent } from './newsletter-signup.component';

const meta: Meta<SkNewsletterSignupComponent> = {
  title: 'Site Kit/Marketing/Newsletter Signup',
  component: SkNewsletterSignupComponent,
  tags: ['autodocs'],
  args: {
    heading: 'Stay in the loop',
    subheading: 'Get the latest updates, tutorials, and product news — no spam, ever.',
    eyebrow: 'Newsletter',
    placeholder: 'Enter your email',
    buttonLabel: 'Subscribe',
    successMessage: "You're subscribed! Check your inbox for a confirmation.",
    disclaimer: 'By subscribing you agree to our Privacy Policy. Unsubscribe anytime.',
  },
};

export default meta;
type Story = StoryObj<SkNewsletterSignupComponent>;

export const Default: Story = {};

export const NoEyebrow: Story = {
  args: {
    eyebrow: '',
    heading: 'Subscribe to our newsletter',
    subheading: 'Weekly insights and tips from our team.',
  },
};

export const NoDisclaimer: Story = {
  args: {
    disclaimer: '',
    heading: 'Get early access',
    subheading: 'Be first to know when we launch new features.',
    buttonLabel: 'Join waitlist',
  },
};

export const MinimalForm: Story = {
  args: {
    eyebrow: '',
    subheading: '',
    disclaimer: '',
    heading: 'Join thousands of readers',
    buttonLabel: 'Subscribe free',
  },
};
