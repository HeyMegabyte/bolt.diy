import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { DomainPickerComponent } from './domain-picker.component';
import { AdminStateService } from '../../pages/admin/admin-state.service';
import { ApiService } from '../../services/api.service';
import { BillingService } from '../../services/billing.service';
import { TelemetryService } from '../../services/telemetry.service';
import { ToastService } from '../../services/toast.service';

/**
 * `<app-domain-picker>` — vanity-domain suggester + RDAP availability. Each row
 * shows a green ● (available) / red ● (taken) beside the URL, the URL in Consolas
 * (via the global `--ps-font-mono` token), a cyan "Recommended" pill on every AI
 * pick, and a "Buy" CTA. Recommendations render in the AI endpoint's ranked order.
 *
 * Heavy app services are stubbed so the component renders standalone in the
 * workshop. Click the trigger to open the panel.
 */
const meta: Meta<DomainPickerComponent> = {
  title: 'Admin/Domain Picker',
  component: DomainPickerComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        {
          provide: AdminStateService,
          useValue: {
            selectedSite: signal({ id: 's1', business_name: 'Acme Co', slug: 'acme' }),
            sites: signal([]),
          },
        },
        { provide: ApiService, useValue: { get: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) } },
        { provide: BillingService, useValue: { walletState: () => ({ has_wallet: true, balance_cents: 9_999_900 }) } },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        {
          provide: ToastService,
          useValue: { info: () => 0, error: () => 0, success: () => 0, warning: () => 0, dismiss: () => undefined },
        },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      ],
    }),
  ],
};
export default meta;
type Story = StoryObj<DomainPickerComponent>;

export const Default: Story = {};
