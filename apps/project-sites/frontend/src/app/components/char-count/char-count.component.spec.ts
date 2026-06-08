import { TestBed } from '@angular/core/testing';
import { CharCountComponent } from './char-count.component';

/**
 * Guards the reusable char-counter primitive:
 *  - len reflects the bound value length
 *  - near() flips at warnRatio (drives the amber cyan→amber colour)
 *  - the polite live region stays SILENT until inside liveThreshold, then
 *    announces remaining (a near-cap heads-up, not per-keystroke spam)
 */
function make(value: string, max: number, opts: { warnRatio?: number; liveThreshold?: number } = {}) {
  const f = TestBed.createComponent(CharCountComponent);
  f.componentRef.setInput('value', value);
  f.componentRef.setInput('max', max);
  if (opts.warnRatio !== undefined) f.componentRef.setInput('warnRatio', opts.warnRatio);
  if (opts.liveThreshold !== undefined) f.componentRef.setInput('liveThreshold', opts.liveThreshold);
  f.detectChanges();
  return f;
}

describe('CharCountComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('len reflects the bound value length; null/undefined treated as empty', () => {
    expect(make('hello', 200).componentInstance.len()).toBe(5);
    const f = make('', 200);
    f.componentRef.setInput('value', null);
    f.detectChanges();
    expect(f.componentInstance.len()).toBe(0);
  });

  it('near() is false well under the cap and true at/after warnRatio', () => {
    expect(make('a'.repeat(100), 200).componentInstance.near()).toBe(false); // 50%
    expect(make('a'.repeat(180), 200).componentInstance.near()).toBe(true); // 90% default
  });

  it('liveMsg is empty until inside liveThreshold, then announces remaining', () => {
    expect(make('a'.repeat(150), 200, { liveThreshold: 20 }).componentInstance.liveMsg()).toBe(''); // 50 left
    expect(make('a'.repeat(185), 200, { liveThreshold: 20 }).componentInstance.liveMsg()).toBe('15 characters left');
    expect(make('a'.repeat(200), 200, { liveThreshold: 20 }).componentInstance.liveMsg()).toBe('0 characters left');
  });

  it('renders the cyan N/MAX counter and toggles the amber .cc-near class', () => {
    const f = make('a'.repeat(190), 200);
    const cc = f.nativeElement.querySelector('[data-testid="char-count"]') as HTMLElement;
    expect(cc.textContent?.trim()).toBe('190/200');
    expect(cc.classList.contains('cc-near')).toBe(true);
  });

  // `maxlength` caps KEYBOARD entry, not a programmatic/loaded/pasted value —
  // so a backend-stored value longer than the cap CAN exceed it. The counter
  // must read that as OVER (red), not the misleading amber "near".
  it('over() is true only when the value exceeds the cap', () => {
    expect(make('a'.repeat(200), 200).componentInstance.over()).toBe(false); // exactly at cap
    expect(make('a'.repeat(205), 200).componentInstance.over()).toBe(true); // over (e.g. backend-loaded)
  });

  it('renders the red .cc-over class + announces the overage when over the cap', () => {
    const f = make('a'.repeat(210), 200, { liveThreshold: 20 });
    const cc = f.nativeElement.querySelector('[data-testid="char-count"]') as HTMLElement;
    expect(cc.textContent?.trim()).toBe('210/200');
    expect(cc.classList.contains('cc-over')).toBe(true);
    expect(f.componentInstance.liveMsg()).toBe('10 characters over the limit');
  });
});
