import type { Meta, StoryObj } from '@storybook/angular';
import { GalleryLightboxComponent } from './gallery-lightbox.component';

const meta: Meta<GalleryLightboxComponent> = {
  title: 'Site Kit/Conversion/GalleryLightbox',
  component: GalleryLightboxComponent,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<GalleryLightboxComponent>;

export const Default: Story = {
  args: {
    ariaLabel: 'Project photo gallery',
  },
};
