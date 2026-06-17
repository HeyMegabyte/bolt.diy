import type { Meta, StoryObj } from '@storybook/angular';
import { BeforeAfterSliderComponent } from './before-after-slider.component';

/**
 * `<app-before-after-slider>` — cinematic comparison slider. Pointer + keyboard
 * (←/→, Shift for ±10%, Home/End), `role="slider"` with full ARIA, touch-action
 * locked so vertical scroll never fights the horizontal drag.
 */
const GENERIC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="600" height="360" fill="#1b1b22"/><text x="300" y="185" fill="#9aa0aa" font-family="sans-serif" font-size="26" text-anchor="middle">Generic competitor</text></svg>`,
  );
const OURS =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#060610"/><stop offset="1" stop-color="#0a2a33"/></linearGradient></defs><rect width="600" height="360" fill="url(#g)"/><text x="300" y="185" fill="#00e5ff" font-family="sans-serif" font-size="26" text-anchor="middle">Built with projectsites.dev</text></svg>`,
  );

const meta: Meta<BeforeAfterSliderComponent> = {
  title: 'Cinematic UI/Before-After Slider',
  component: BeforeAfterSliderComponent,
  tags: ['autodocs'],
  argTypes: {
    beforeLabel: { control: 'text' },
    afterLabel: { control: 'text' },
    ariaLabel: { control: 'text' },
  },
  args: {
    beforeSrc: GENERIC,
    afterSrc: OURS,
    beforeLabel: 'Generic competitor',
    afterLabel: 'Built with projectsites.dev',
    initial: 50,
  },
};
export default meta;
type Story = StoryObj<BeforeAfterSliderComponent>;

export const Default: Story = {};

/** Slider parked near the start to reveal more of the "after". */
export const RevealAfter: Story = { args: { initial: 18 } };
