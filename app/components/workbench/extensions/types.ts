/**
 * @file Shared types for the BottomPanelTabs system.
 *
 * @remarks
 * Adding a new tab = (1) implement `ExtensionTabComponent` in
 * `extensions/tabs/{Name}Tab.tsx`, (2) register in `BottomPanelTabs.tsx`
 * `TABS` array. Tab components must be self-contained — they consume the
 * shared `~/lib/stores/workbench` + `~/lib/webcontainer` exports directly
 * rather than receiving props.
 */
import type { ComponentType } from 'react';

export interface ExtensionTabDescriptor {
  /** Stable slug used in URL + state — never change. */
  id: string;
  /** Human label shown on the tab strip. */
  label: string;
  /** UnoCSS icon class, e.g. `i-ph:database-duotone`. */
  icon: string;
  /** Lazy-imported tab body. */
  component: ComponentType;
  /** Optional tooltip for the trigger button. */
  hint?: string;
}

export type ExtensionTabComponent = ComponentType;
