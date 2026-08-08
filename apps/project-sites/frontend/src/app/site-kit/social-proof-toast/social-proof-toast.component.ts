import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';

export interface SocialProofEntry {
  name: string;
  action: string;
  location?: string;
  ago?: string;
}

@Component({
  selector: 'sk-social-proof-toast',
  standalone: true,
  imports: [NgIf, NgFor],
  template: `
    <div
      *ngIf="visible && current"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style="
        position: fixed;
        bottom: 80px;
        left: 24px;
        z-index: var(--ps-z-toast, 9999);
        background: var(--ps-surface-glass, rgba(13,13,40,0.95));
        border: 1px solid rgba(0,229,255,0.2);
        border-radius: var(--ps-radius-lg, 16px);
        padding: 14px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 320px;
        box-shadow: var(--ps-shadow-lg, 0 12px 40px rgba(0,0,0,0.4));
        animation: spToastIn var(--ps-dur-slow, 380ms) var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1)) both;
      "
    >
      <div
        style="
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--ps-accent,#00e5ff), var(--ps-accent-secondary,#7C3AED));
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--ps-bg, #060610);
        "
        aria-hidden="true"
      >{{ current.name.charAt(0).toUpperCase() }}</div>
      <div style="min-width:0">
        <div style="color:var(--ps-ink,#f4f4ff);font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          {{ current.name }}
        </div>
        <div style="color:rgba(244,244,255,0.7);font-size:0.8rem;margin-top:2px;">
          {{ current.action }}<span *ngIf="current.location"> in {{ current.location }}</span>
        </div>
        <div *ngIf="current.ago" style="color:var(--ps-accent,#00e5ff);font-size:0.75rem;margin-top:3px;font-weight:600;">
          {{ current.ago }}
        </div>
      </div>
    </div>
    <style>
      @keyframes spToastIn {
        from { opacity: 0; transform: translateY(16px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        [role="status"] { animation: none !important; }
      }
    </style>
  `,
})
export class SocialProofToastComponent implements OnInit, OnDestroy {
  // No fabricated defaults — a social-proof toast asserting "Maria S. just booked
  // … 2 min ago" is a FAKE-ACTIVITY dark pattern (invented people + invented live
  // events) the moment it ships without real data. Empty by default → ngOnInit
  // early-returns on `!entries.length` so the toast never renders. The consumer
  // passes REAL, recent, consented activity or nothing. (anti-fabrication mandate)
  @Input() entries: SocialProofEntry[] = [];
  @Input() intervalMs = 5000;
  @Input() displayMs = 3500;

  visible = false;
  current: SocialProofEntry | null = null;
  private idx = 0;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (!this.entries.length) return;
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
    this.showNext();
  }

  ngOnDestroy(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }

  private showNext(): void {
    this.current = this.entries[this.idx % this.entries.length];
    this.idx++;
    this.visible = true;
    this.hideTimer = setTimeout(() => {
      this.visible = false;
      this.showTimer = setTimeout(() => this.showNext(), this.intervalMs);
    }, this.displayMs);
  }
}
