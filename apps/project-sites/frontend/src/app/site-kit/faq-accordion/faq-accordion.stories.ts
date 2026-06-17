import type { Meta, StoryObj } from '@storybook/angular';
import { SkFaqAccordionComponent } from './faq-accordion.component';

const meta: Meta<SkFaqAccordionComponent> = {
  title: 'Site Kit/Marketing/FaqAccordion',
  component: SkFaqAccordionComponent,
  tags: ['autodocs'],
  args: {
    heading: 'Frequently asked questions',
    subheading: "Can't find what you're looking for? Reach out to our team.",
    items: [
      { question: 'Is there a free plan?', answer: 'Yes — our Starter plan is completely free with no credit card required.' },
      { question: 'How does billing work?', answer: 'We bill monthly or annually. Annual plans include a 20% discount.' },
      { question: 'Do you offer enterprise pricing?', answer: 'Yes — contact our sales team for custom pricing and SLAs.' },
    ],
  },
};
export default meta;
type Story = StoryObj<SkFaqAccordionComponent>;

export const Default: Story = {};

export const NoSubheading: Story = {
  args: { subheading: '' },
};
