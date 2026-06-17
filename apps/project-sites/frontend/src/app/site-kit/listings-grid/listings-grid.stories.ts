import type { Meta, StoryObj } from '@storybook/angular';
import { ListingsGridComponent } from './listings-grid.component';

const meta: Meta<ListingsGridComponent> = {
  title: 'Site Kit/Industry/ListingsGrid',
  component: ListingsGridComponent,
  tags: ['autodocs'],
  argTypes: {
    heading: { control: 'text' },
    subtitle: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<ListingsGridComponent>;

export const Default: Story = {};

export const AutoDealership: Story = {
  args: {
    heading: 'Vehicles In Stock',
    subtitle: 'Certified pre-owned. No-hassle pricing.',
    listings: [
      {
        title: '2022 Honda Civic Sport',
        price: 22999,
        location: '14,200 mi',
        description: 'One owner, clean Carfax, Apple CarPlay, heated seats.',
        details: ['4-cyl', 'Auto', 'FWD'],
        badge: { label: 'New Arrival', variant: 'new' },
        ctaLabel: 'View Car',
        ctaHref: '#civic',
      },
      {
        title: '2021 Toyota Camry XSE',
        price: 27500,
        location: '22,800 mi',
        description: 'Sport package, moonroof, V6 engine. Like new.',
        details: ['V6', 'Auto', 'FWD'],
        ctaLabel: 'View Car',
        ctaHref: '#camry',
      },
      {
        title: '2020 Ford F-150 XLT',
        price: 34800,
        location: '38,100 mi',
        description: 'Crew cab, tow package, Sync 3, backup camera.',
        details: ['EcoBoost', 'Auto', '4WD'],
        badge: { label: 'Featured', variant: 'featured' },
        ctaLabel: 'View Truck',
        ctaHref: '#f150',
      },
    ],
  },
};

export const NoHeading: Story = {
  args: {
    heading: '',
    subtitle: '',
  },
};
