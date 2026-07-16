import { Injectable, signal, effect } from '@angular/core';

export type DensityMode = 'compact' | 'comfortable' | 'card';

const STORAGE_KEY = 'ps-density-mode';
const VALID_MODES: readonly DensityMode[] = ['compact', 'comfortable', 'card'];

@Injectable({ providedIn: 'root' })
export class DensityService {
  readonly mode = signal<DensityMode>(this.load());

  constructor() {
    effect(() => {
      const m = this.mode();
      document.documentElement.setAttribute('data-density', m);
      this.persist(m);
    });
  }

  cycle(): void {
    const modes: DensityMode[] = ['comfortable', 'compact', 'card'];
    const idx = modes.indexOf(this.mode());
    this.mode.set(modes[(idx + 1) % modes.length]);
  }

  setMode(m: DensityMode): void {
    if (VALID_MODES.includes(m as DensityMode)) {
      this.mode.set(m as DensityMode);
    }
  }

  private load(): DensityMode {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && VALID_MODES.includes(raw as DensityMode)) {
        return raw as DensityMode;
      }
    } catch { /* quota / private mode */ }
    return 'comfortable';
  }

  private persist(m: DensityMode): void {
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* quota */ }
  }
}
