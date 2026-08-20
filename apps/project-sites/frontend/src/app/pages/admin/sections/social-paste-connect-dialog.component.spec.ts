import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { SocialPasteConnectDialogComponent, isValidPublicHttpsUrl } from './social-paste-connect-dialog.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/** Coverage for the extracted paste-key dialog (split slice 3). */
function make(platform: string | null = 'bluesky', label = 'Bluesky'): {
  c: SocialPasteConnectDialogComponent;
  post: jasmine.Spy;
  toast: { success: jasmine.Spy; error: jasmine.Spy };
  fx: ComponentFixture<SocialPasteConnectDialogComponent>;
} {
  const post = jasmine.createSpy('post').and.returnValue(of({}));
  const toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  TestBed.configureTestingModule({
    imports: [SocialPasteConnectDialogComponent],
    providers: [
      { provide: ApiService, useValue: { post } },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fx = TestBed.createComponent(SocialPasteConnectDialogComponent);
  fx.componentRef.setInput('platform', platform);
  fx.componentRef.setInput('platformLabel', label);
  fx.detectChanges();
  return { c: fx.componentInstance, post, toast, fx };
}

describe('SocialPasteConnectDialogComponent (extracted from the social god component)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('bluesky: valid fields pass, out-of-range fields are rejected', () => {
    const { c } = make('bluesky');
    c.f.identifier = 'me.bsky.social';
    c.f.app_password = 'abcd-efgh-ijkl';
    expect(c.pasteValid()).toBeTrue();
    c.f.identifier = 'x';
    expect(c.pasteValid()).toBeFalse();
    expect(c.bskyIdInvalid()).toBeTrue();
    c.f.identifier = 'me.bsky.social';
    c.f.app_password = 'short';
    expect(c.bskyPwInvalid()).toBeTrue();
  });

  it('mastodon: requires a public https instance URL + 20-500 token', () => {
    const { c } = make('mastodon');
    c.f.instance_url = 'http://mastodon.social';
    c.f.access_token = 'a'.repeat(40);
    expect(c.mastoUrlInvalid()).toBeTrue();
    expect(c.pasteValid()).toBeFalse();
    c.f.instance_url = 'https://mastodon.social';
    expect(c.pasteValid()).toBeTrue();
    c.f.access_token = 'short';
    expect(c.mastoTokInvalid()).toBeTrue();
  });

  it('telegram: chat bounds hold', () => {
    const { c } = make('telegram');
    c.f.chat_id = '@mychannel';
    expect(c.pasteValid()).toBeTrue();
    c.f.chat_id = 'x'.repeat(81);
    expect(c.tgChatInvalid()).toBeTrue();
  });

  it('discord: channel bounds hold', () => {
    const { c } = make('discord');
    c.f.channel_id = '12345';
    expect(c.pasteValid()).toBeTrue();
    c.f.channel_id = '123';
    expect(c.dcChanInvalid()).toBeTrue();
  });

  it('submit POSTs the correct platform body + emits connected', () => {
    const { c, post } = make('bluesky', 'Bluesky');
    const emitted = jasmine.createSpy('connected');
    c.connected.subscribe(emitted);
    c.f.identifier = 'me.bsky.social';
    c.f.app_password = 'abcd-efgh-ijkl';
    c.submit();
    expect(post).toHaveBeenCalledWith(
      '/social/bluesky/paste',
      { kind: 'bluesky', identifier: 'me.bsky.social', app_password: 'abcd-efgh-ijkl' },
      { silent: true },
    );
    expect(emitted).toHaveBeenCalled();
  });

  it('submit surfaces an inline error instead of POSTing when invalid', () => {
    const { c, post } = make('bluesky');
    c.submit();
    expect(post).not.toHaveBeenCalled();
    expect(c.error()).toBe('Fill in the required fields above.');
  });

  it('isValidPublicHttpsUrl rejects http, junk, and bare internal hosts', () => {
    expect(isValidPublicHttpsUrl('https://mastodon.social')).toBeTrue();
    expect(isValidPublicHttpsUrl('http://mastodon.social')).toBeFalse();
    expect(isValidPublicHttpsUrl('mastodon.social')).toBeFalse();
    expect(isValidPublicHttpsUrl('https://localhost')).toBeFalse();
    expect(isValidPublicHttpsUrl('https://internal')).toBeFalse();
  });
});
