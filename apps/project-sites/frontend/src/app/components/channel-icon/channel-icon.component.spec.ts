import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChannelIconComponent } from './channel-icon.component';

/**
 * Guards the cockpit channel-glyph cohesion: every known conversation channel
 * (form/chat/voice/sms/email) renders a monochrome cyan Feather SVG inside an
 * aria-hidden wrapper — NEVER a colourful emoji (the off-brand pattern the
 * voice/share + inbox channel chips were standardised away from).
 */
describe('ChannelIconComponent', () => {
  let fixture: ComponentFixture<ChannelIconComponent>;

  function render(channel: string): HTMLElement {
    fixture = TestBed.createComponent(ChannelIconComponent);
    fixture.componentRef.setInput('channel', channel);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  const KNOWN = ['form', 'chat', 'voice', 'sms', 'email'];

  for (const ch of KNOWN) {
    it(`renders a monochrome SVG (no emoji) for "${ch}"`, () => {
      const el = render(ch);
      expect(el.querySelector('svg')).withContext(`${ch} → svg`).toBeTruthy();
      // No literal emoji leaked into the rendered text.
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(el.textContent ?? ''))
        .withContext(`${ch} text is emoji-free`)
        .toBeFalse();
    });
  }

  it('marks the glyph wrapper aria-hidden (decorative — the row title carries meaning)', () => {
    const el = render('chat');
    expect(el.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('still renders an SVG fallback for an unknown channel', () => {
    const el = render('carrier-pigeon');
    expect(el.querySelector('svg')).withContext('fallback svg').toBeTruthy();
  });
});
