import type { Meta, StoryObj } from '@storybook/angular';
import { BeforeAfterSliderComponent } from './before-after-slider.component';

const meta: Meta<BeforeAfterSliderComponent> = {
  title: 'Site Kit/Conversion/BeforeAfterSlider',
  component: BeforeAfterSliderComponent,
  tags: ['autodocs'],
  argTypes: {
    initial: { control: { type: 'range', min: 0, max: 100 } },
  },
};
export default meta;
type Story = StoryObj<BeforeAfterSliderComponent>;

export const Default: Story = {
  args: {
    beforeLabel: 'Before',
    afterLabel: 'After',
    initial: 50,
  },
};

export const Skewed: Story = {
  args: {
    beforeLabel: 'Old design',
    afterLabel: 'New design',
    initial: 25,
  },
};
