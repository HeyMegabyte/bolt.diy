import type { Meta, StoryObj } from '@storybook/angular';
import { TrustStripComponent } from './trust-strip.component';

/**
 * `<app-trust-strip>` — the "built on" logo row shown on marketing surfaces
 * (Cloudflare · D1 · R2 · Workers AI · bolt.diy). Static, brand-token themed,
 * reduced-motion safe.
 */
const meta: Meta<TrustStripComponent> = {
  title: 'Cinematic UI/Trust Strip',
  component: TrustStripComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<TrustStripComponent>;

export const Default: Story = {};
