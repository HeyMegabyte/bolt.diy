import type { Meta, StoryObj } from '@storybook/angular';
import { ProviderBioComponent } from './provider-bio.component';

const meta: Meta<ProviderBioComponent> = {
  title: 'Site Kit/Industry/ProviderBio',
  component: ProviderBioComponent,
  tags: ['autodocs'],
  argTypes: {
    name: { control: 'text' },
    title: { control: 'text' },
    bio: { control: 'text' },
    ctaText: { control: 'text' },
    ctaHref: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<ProviderBioComponent>;

export const Default: Story = {};

export const DentalPractitioner: Story = {
  args: {
    name: 'Dr. Marcus Webb, DDS',
    title: 'General & Cosmetic Dentist',
    bio: 'Dr. Webb has been transforming smiles in the community for over a decade. He is a graduate of the University of Michigan School of Dentistry and a member of the American Dental Association.',
    credentials: [
      { label: 'DDS' },
      { label: 'ADA Member' },
      { label: 'Invisalign Certified' },
    ],
    specialties: ['Cosmetic Dentistry', 'Invisalign', 'Implants', 'Children'],
    ctaText: 'Schedule a Consultation',
    ctaHref: '#schedule',
  },
};

export const NoBioCredentials: Story = {
  args: {
    credentials: [],
    specialties: [],
    ctaText: '',
  },
};
