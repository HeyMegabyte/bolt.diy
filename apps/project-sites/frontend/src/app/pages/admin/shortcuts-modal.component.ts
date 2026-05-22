/**
 * Keyboard shortcuts cheat-sheet modal. Toggled by the `?` key (handled in
 * the admin shell) or by the help command in the palette.
 *
 *   <app-shortcuts-modal #help />
 *   help.open.set(true)
 */
import { Component, signal, type OnDestroy, type OnInit } from '@angular/core';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';

interface Shortcut { keys: string[]; label: string; }
interface Group { label: string; items: Shortcut[]; }

@Component({
  selector: 'app-shortcuts-modal',
  standalone: true,
  imports: [FocusTrapDirective],
  template: `
    @if (open()) {
      <div class="sk-overlay" (click)="open.set(false)">
        <div class="sk-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" [focusTrap]="open()" (click)="$event.stopPropagation()">
          <header class="sk-head">
            <h3 class="m-0 text-base font-semibold text-white">Keyboard shortcuts</h3>
            <button class="sk-close" (click)="open.set(false)" aria-label="Close">×</button>
          </header>
          <div class="sk-body">
            @for (g of groups; track g.label) {
              <div class="sk-group">
                <div class="sk-group-label">{{ g.label }}</div>
                @for (s of g.items; track s.label) {
                  <div class="sk-row">
                    <span class="sk-label">{{ s.label }}</span>
                    <span class="sk-keys">
                      @for (k of s.keys; track k; let last = $last) {
                        <kbd class="sk-kbd">{{ k }}</kbd>
                        @if (!last) { <span class="sk-plus">+</span> }
                      }
                    </span>
                  </div>
                }
              </div>
            }
          </div>
          <footer class="sk-foot">
            <span>Press <kbd class="sk-kbd">?</kbd> anytime to reopen</span>
            <span class="sk-foot-right">Esc to close</span>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .sk-overlay {
      position: fixed; inset: 0;
      background: rgba(2,2,12,0.62);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      z-index: 9100;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: skIn 160ms ease-out;
    }
    @keyframes skIn { from { opacity: 0 } to { opacity: 1 } }
    .sk-panel {
      width: min(640px, 95vw);
      max-height: 84vh; overflow: hidden;
      background: linear-gradient(180deg, rgba(20,20,42,0.97), rgba(10,10,28,0.97));
      border: 1px solid rgba(0,229,255,0.22);
      border-radius: 16px;
      box-shadow: 0 28px 80px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,229,255,0.06);
      animation: skRise 220ms cubic-bezier(0.16, 1, 0.3, 1);
      display: flex; flex-direction: column;
    }
    @keyframes skRise { from { transform: translateY(8px) scale(0.97); opacity: 0; } to { transform: none; opacity: 1; } }
    .sk-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .sk-close { background: transparent; border: 0; color: rgba(255,255,255,0.6); font-size: 22px; cursor: pointer; }
    .sk-close:hover { color: #fff; }
    .sk-body { padding: 12px 18px 4px; overflow-y: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
    @media (max-width: 560px) { .sk-body { grid-template-columns: 1fr; } }
    .sk-group { padding: 6px 0 12px; }
    .sk-group-label {
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
      color: rgba(255,255,255,0.45); padding: 6px 0;
    }
    .sk-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; }
    .sk-label { font-size: 0.82rem; color: rgba(255,255,255,0.88); }
    .sk-keys { display: inline-flex; align-items: center; gap: 4px; }
    .sk-plus { color: rgba(255,255,255,0.4); font-size: 0.7rem; }
    .sk-kbd {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 22px; padding: 2px 7px;
      border-radius: 5px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.14);
      border-bottom-width: 2px;
      color: rgba(255,255,255,0.9);
      font-family: ui-monospace, monospace; font-size: 0.7rem; font-weight: 600;
    }
    .sk-foot {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 18px; border-top: 1px solid rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.55); font-size: 0.72rem;
    }
  `],
})
export class ShortcutsModalComponent implements OnInit, OnDestroy {
  open = signal(false);
  private esc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && this.open()) { ev.preventDefault(); this.open.set(false); }
  };
  ngOnInit(): void { document.addEventListener('keydown', this.esc); }
  ngOnDestroy(): void { document.removeEventListener('keydown', this.esc); }

  groups: Group[] = [
    { label: 'Navigation', items: [
      { keys: ['⌘','K'], label: 'Open command palette (everything is searchable)' },
      { keys: ['/'],     label: 'Focus sidebar search' },
      { keys: ['?'],     label: 'Show this cheat-sheet' },
      { keys: ['G','E'], label: 'Go to Editor' },
      { keys: ['G','S'], label: 'Go to Snapshots' },
      { keys: ['G','A'], label: 'Go to Analytics' },
      { keys: ['G','F'], label: 'Go to Forms' },
      { keys: ['G','L'], label: 'Go to AI Traces' },
      { keys: ['G','D'], label: 'Go to Docs' },
      { keys: ['G','U'], label: 'Go to User settings' },
    ]},
    { label: 'Actions', items: [
      { keys: ['⌘','S'], label: 'Save & deploy (Editor / IDE)' },
      { keys: ['⌘','Enter'], label: 'Submit current form · Send Try-It request' },
      { keys: ['⌘','Shift','P'], label: 'Re-run last command palette action' },
      { keys: ['Esc'],  label: 'Close palette / dialog / popover (restores focus)' },
      { keys: ['⌘','.'], label: 'Toggle theme (dark / light / system)' },
      { keys: ['⌘','B'], label: 'Toggle sidebar' },
      { keys: ['1'],     label: 'AI Traces: All filter' },
      { keys: ['2'],     label: 'AI Traces: Today filter' },
      { keys: ['3'],     label: 'AI Traces: Errors filter' },
    ]},
    { label: 'Palette tricks', items: [
      { keys: ['>','n','a','v'], label: 'Filter palette to Navigation section' },
      { keys: ['=','2','+','2'], label: 'Inline calculator (Enter copies result)' },
      { keys: ['#','0','0','E','5','F','F'], label: 'Color converter (hex → RGB / OKLCH)' },
      { keys: ['a','u','d','i','t',':'], label: 'Live-search the audit log' },
      { keys: ['f','o','r','m',':'], label: 'Live-search forms inbox' },
      { keys: ['⌘','↵'], label: 'Open palette result in new tab' },
      { keys: ['→'], label: 'Pin highlighted palette action' },
    ]},
  ];
}
