/**
 * Admin → Social — Pulse Social composer + scheduler.
 *
 * 3-pane layout:
 *   LEFT 220px : Connected accounts (per-platform card + connect/disconnect)
 *   CENTER 1fr : Tabs (Compose / Drafts / Queue / Sent / Calendar) + composer
 *   RIGHT 320px: Live previews per selected platform
 *
 * Wires to sibling-agent backend:
 *   GET    /api/social/accounts?site_id=:id
 *   GET    /api/social/:platform/connect?site_id=:id     -> popup OAuth flow
 *   POST   /api/social/:platform/disconnect
 *   GET    /api/social/posts?site_id=:id&status=draft|scheduled|published
 *   POST   /api/social/posts
 *   PATCH  /api/social/posts/:id
 *   DELETE /api/social/posts/:id
 *   POST   /api/social/posts/:id/publish-now
 *   GET    /api/social/posts/:id/analytics
 *   POST   /api/social/generate
 *   POST   /api/social/media                              -> R2 upload
 *   POST   /api/social/og-preview                         -> OG fetch
 *   GET    /api/social/mentions?platform=:p&q=:q
 *   GET    /api/social/best-times?platforms=:list
 *   POST   /api/social/import-rss
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  type AfterViewInit,
  type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { InlineErrorComponent } from '../../../components/states';
import { HlmInputDirective, HlmSelectDirective, HlmTablistDirective } from '../../../ui';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/* ──────────────────────────────────────────────────────────────────── */
/*  Types                                                               */
/* ──────────────────────────────────────────────────────────────────── */

type PlatformId =
  | 'twitter'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'bluesky'
  | 'reddit'
  | 'mastodon'
  | 'discord'
  | 'slack'
  | 'telegram';

interface PlatformDef {
  id: PlatformId;
  label: string;
  charLimit: number;
  color: string;
  glyph: string; // inline SVG path data
  /** Connects via a pasted token/app-password (no OAuth popup). The worker's
   *  GET /connect returns a paste_key spec + POST /paste accepts the creds. */
  pasteKey?: boolean;
}

interface SocialAccount {
  id?: string;
  platform: PlatformId;
  connected: boolean;
  handle?: string;
  avatar_url?: string;
  expires_at?: string;
}

interface MediaItem {
  id: string;
  url: string;
  thumb_url?: string;
  alt: string;
  bytes: number;
  type: 'image' | 'video' | 'gif';
}

type PostStatus = 'draft' | 'scheduled' | 'published' | 'partial' | 'failed';

interface SocialPost {
  id: string;
  content: string;
  per_platform_content?: Partial<Record<PlatformId, string>>;
  platforms: PlatformId[];
  media: MediaItem[];
  hashtags: string[];
  link?: string;
  og?: { title: string; description: string; image: string; site_name: string };
  scheduled_at?: string;
  published_at?: string;
  status: PostStatus;
  per_platform_status?: Partial<Record<PlatformId, 'ok' | 'pending' | 'failed'>>;
  per_platform_url?: Partial<Record<PlatformId, string>>;
}

interface AnalyticsRow {
  platform: PlatformId;
  impressions: number;
  likes: number;
  shares: number;
  clicks: number;
}

interface OgData {
  title: string;
  description: string;
  image: string;
  site_name: string;
}

type Tab = 'compose' | 'drafts' | 'queue' | 'sent' | 'calendar';

/* ──────────────────────────────────────────────────────────────────── */
/*  Platform registry — single source of truth                          */
/* ──────────────────────────────────────────────────────────────────── */

const PLATFORMS: readonly PlatformDef[] = [
  {
    id: 'twitter',
    label: 'X / Twitter',
    charLimit: 280,
    color: '#1d9bf0',
    glyph:
      'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.25 2.25h6.83l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    charLimit: 3000,
    color: '#0a66c2',
    glyph:
      'M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.86-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.86 3.36-1.86 3.6 0 4.27 2.37 4.27 5.45v6.3ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45Z',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    charLimit: 63206,
    color: '#1877f2',
    glyph:
      'M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.34v6.99A10 10 0 0 0 22 12Z',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    charLimit: 2200,
    color: '#e1306c',
    glyph:
      'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23a3.7 3.7 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.15c-.3.76-.5 1.64-.56 2.91C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.73 1.46 1.39 2.13a5.92 5.92 0 0 0 2.13 1.39c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39 5.92 5.92 0 0 0 1.39-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z',
  },
  {
    id: 'threads',
    label: 'Threads',
    charLimit: 500,
    color: '#a78bfa',
    glyph:
      'M12.18 24h-.02c-3.32-.02-5.87-1.12-7.58-3.26C3.06 18.85 2.25 16.13 2.21 12.74v-.01l-.01-.1.01-.13c.04-3.4.85-6.11 2.37-8 1.71-2.14 4.26-3.23 7.58-3.26h.02c2.55.02 4.7.66 6.39 1.92 1.58 1.17 2.7 2.85 3.32 4.97l-2.07.59c-1.05-3.6-3.5-5.39-7.65-5.42-2.66.02-4.68.85-5.99 2.46-1.22 1.51-1.84 3.71-1.86 6.54.02 2.83.64 5.03 1.86 6.54 1.31 1.61 3.33 2.44 5.99 2.46 2.38-.02 3.96-.59 5.28-1.91 1.5-1.5 1.47-3.34.99-4.45-.28-.66-.78-1.21-1.46-1.62-.16 1.16-.51 2.12-1.07 2.85-.74.99-1.81 1.53-3.16 1.61-1.02.06-2-.18-2.76-.67-.91-.59-1.43-1.5-1.49-2.57-.06-1.04.36-2 1.17-2.69.78-.66 1.88-1.05 3.18-1.12.96-.05 1.86.01 2.69.18-.11-.66-.34-1.18-.66-1.57-.46-.55-1.17-.83-2.11-.83h-.03c-.76 0-1.78.21-2.43 1.19l-1.75-1.18c.87-1.32 2.29-2.04 4.18-2.04h.04c3.18.02 5.07 1.96 5.26 5.34.11.05.21.09.32.14 1.46.69 2.53 1.73 3.09 3.02.79 1.79.86 4.7-1.51 7.07-1.81 1.81-4.01 2.63-7.13 2.65Zm1.06-9.86c-.21 0-.43 0-.65.02-1.62.09-2.62.83-2.55 1.89.06 1.11 1.29 1.62 2.47 1.55 1.09-.06 2.51-.49 2.75-3.37-.61-.06-1.28-.09-2.01-.09Z',
  },
  {
    id: 'bluesky',
    label: 'Bluesky',
    charLimit: 300,
    pasteKey: true,
    color: '#1185fe',
    glyph:
      'M5.95 4.13C8.65 6.18 11.55 10.34 12 12.55c.45-2.21 3.35-6.37 6.05-8.42 1.95-1.47 5.1-2.61 5.1.99 0 .72-.41 6.04-.65 6.9-.83 3-3.88 3.77-6.6 3.3 4.74.81 5.95 3.5 3.35 6.18-4.95 5.1-7.11-1.27-7.66-2.9-.1-.3-.15-.44-.15-.32 0-.12-.05.02-.15.32-.55 1.63-2.71 8-7.66 2.9-2.6-2.68-1.39-5.37 3.35-6.18-2.72.47-5.77-.3-6.6-3.3C.14 11.16-.27 5.84-.27 5.12c0-3.6 3.15-2.46 5.1-.99h1.12Z',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    charLimit: 40000,
    color: '#ff4500',
    glyph:
      'M12 0a12 12 0 1 0 12 12A12 12 0 0 0 12 0Zm6.67 13.13c.03.19.04.39.04.59 0 3.01-3.5 5.45-7.81 5.45s-7.81-2.44-7.81-5.45c0-.2.01-.4.04-.59-.61-.27-1.04-.88-1.04-1.59 0-.96.78-1.74 1.74-1.74.47 0 .9.19 1.21.49 1.19-.86 2.84-1.41 4.67-1.47l.88-4.13 2.87.61a1.22 1.22 0 1 1-.04.55l-2.57-.55-.79 3.71c1.8.07 3.42.62 4.6 1.48.31-.31.74-.5 1.22-.5.96 0 1.74.78 1.74 1.74 0 .71-.43 1.32-1.04 1.59h.09Zm-10.91-.62a1.31 1.31 0 1 0 2.61 0 1.31 1.31 0 0 0-2.61 0Zm6.31 3.43c.16.16.16.42 0 .58a4.07 4.07 0 0 1-2.93 1.02h-.01a4.06 4.06 0 0 1-2.93-1.02.41.41 0 0 1 0-.58.41.41 0 0 1 .58 0c.59.59 1.46.88 2.35.88h.01c.89 0 1.76-.29 2.35-.88a.41.41 0 0 1 .58 0Zm-.17-2.12a1.31 1.31 0 1 1 0-2.62 1.31 1.31 0 0 1 0 2.62Z',
  },
  {
    id: 'mastodon',
    label: 'Mastodon',
    charLimit: 500,
    pasteKey: true,
    color: '#6364ff',
    glyph:
      'M23.27 5.36C22.91 2.7 20.58.6 17.81.19 17.35.12 15.58 0 11.49 0h-.03c-4.1 0-4.97.13-5.42.2C3.34.6.88 2.49.29 5.18.0 6.5 0 7.97 0 9.32.07 11.25.08 13.18.26 15.1.38 16.38.59 17.65.89 18.9c.55 2.3 2.83 4.21 5.07 5 2.39.82 4.97.96 7.43.4.27-.06.54-.13.81-.21.59-.19 1.29-.4 1.8-.78.01 0 .02-.01.03-.03v-1.92s-.01-.02-.02-.02-.02 0-.02 0c-2.05.49-4.16.74-6.27.74-3.63 0-4.6-1.72-4.88-2.44-.22-.62-.36-1.27-.42-1.92 0-.01 0-.02.01-.02s.02 0 .02 0c2.02.49 4.09.74 6.16.74.5 0 1-.01 1.49-.03 2.09-.06 4.28-.16 6.33-.56.05-.01.1-.03.15-.04 3.24-.62 6.32-2.57 6.63-7.5.01-.19.04-2.04.04-2.24.01-.69-.21-4.88-.27-5.21ZM19.58 15.4h-2.86V8.42c0-1.47-.62-2.22-1.85-2.22-1.36 0-2.05.88-2.05 2.62v3.79H10c0-3.6-.01-3.95 0-4.97 0-.99-.7-2.61-1.97-2.61-1.36 0-1.85.95-1.85 2.31v6.06H3.32C3.31 12.07 3.3 8.45 3.31 7.62c0-1.55.79-2.79 1.92-3.6.81-.58 1.78-.88 2.78-.83 2.17.04 3.5 1.59 3.92 2.43 0 .01.02.01.02 0 .42-.83 1.74-2.39 3.92-2.43 1.0-.04 1.97.25 2.78.83 1.13.81 1.92 2.05 1.92 3.6.01.83.01 4.41 0 7.78Z',
  },
  {
    id: 'discord',
    label: 'Discord',
    charLimit: 2000,
    pasteKey: true,
    color: '#5865f2',
    glyph:
      'M20.32 4.37A19.79 19.79 0 0 0 15.43 2.9a.07.07 0 0 0-.08.04c-.21.37-.44.86-.6 1.24a18.27 18.27 0 0 0-5.5 0c-.16-.39-.4-.87-.62-1.24A.08.08 0 0 0 8.55 2.9a19.74 19.74 0 0 0-4.89 1.47.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .09-.03c.46-.63.87-1.3 1.23-2.01a.08.08 0 0 0-.04-.11 13.13 13.13 0 0 1-1.87-.89.08.08 0 0 1 0-.13c.13-.1.25-.2.37-.3a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01c.12.1.24.2.37.3a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.71.77 1.38 1.23 2.01a.08.08 0 0 0 .09.03 19.85 19.85 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.83-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z',
  },
  {
    id: 'slack',
    label: 'Slack',
    charLimit: 40000,
    color: '#4a154b',
    glyph:
      'M5.04 15.16a2.52 2.52 0 0 1-2.52 2.52A2.52 2.52 0 0 1 0 15.16a2.52 2.52 0 0 1 2.52-2.52h2.52v2.52ZM6.32 15.16a2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52v6.32A2.52 2.52 0 0 1 8.84 24a2.52 2.52 0 0 1-2.52-2.52v-6.32ZM8.84 5.04A2.52 2.52 0 0 1 6.32 2.52 2.52 2.52 0 0 1 8.84 0a2.52 2.52 0 0 1 2.52 2.52v2.52H8.84ZM8.84 6.32a2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52H2.52A2.52 2.52 0 0 1 0 8.84a2.52 2.52 0 0 1 2.52-2.52h6.32ZM18.96 8.84a2.52 2.52 0 0 1 2.52-2.52A2.52 2.52 0 0 1 24 8.84a2.52 2.52 0 0 1-2.52 2.52h-2.52V8.84ZM17.68 8.84a2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52V2.52A2.52 2.52 0 0 1 15.16 0a2.52 2.52 0 0 1 2.52 2.52v6.32ZM15.16 18.96a2.52 2.52 0 0 1 2.52 2.52A2.52 2.52 0 0 1 15.16 24a2.52 2.52 0 0 1-2.52-2.52v-2.52h2.52ZM15.16 17.68a2.52 2.52 0 0 1-2.52-2.52 2.52 2.52 0 0 1 2.52-2.52h6.32A2.52 2.52 0 0 1 24 15.16a2.52 2.52 0 0 1-2.52 2.52h-6.32Z',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    charLimit: 4096,
    pasteKey: true,
    color: '#229ed9',
    glyph:
      'M12 0a12 12 0 1 0 12 12A12 12 0 0 0 12 0Zm5.94 8.2-1.98 9.35c-.15.66-.54.82-1.1.51l-3.04-2.24-1.47 1.42c-.16.16-.3.3-.62.3l.22-3.13 5.71-5.16c.25-.22-.05-.34-.39-.13L8.21 13.6 4.96 12.6c-.71-.22-.72-.71.15-1.05l12.7-4.9c.59-.22 1.1.14.9 1.55Z',
  },
] as const;

/* ──────────────────────────────────────────────────────────────────── */
/*  Component                                                           */
/* ──────────────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-admin-social',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RevealDirective, RollingCounterComponent, DialogShellComponent, HlmInputDirective, HlmSelectDirective, HlmTablistDirective, InlineErrorComponent],
  template: `
<div class="social-wrap" [class.is-loading]="loading()">

  <!-- ═══════════════════════ HEADER ═══════════════════════ -->
  <header class="social-header" appReveal>
    <div class="hdr-left">
      <div class="kicker">Pulse Social</div>
      <h1 class="social-h1">
        <svg class="hdr-glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 11l18-8v18l-18-8z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
        </svg>
        Social
        <span class="hdr-pill">
          <span class="hdr-pill-dot"></span>
          @if (loading() && accounts().length === 0) {
            <span aria-hidden="true">…</span>&nbsp;connected
          } @else if (accountsError() && accounts().length === 0) {
            <!-- Connection states failed to load → the count is UNKNOWN, not 0.
                 Show "—" (mirrors the loading "…"), never a false "0 connected". -->
            <span aria-hidden="true">—</span>&nbsp;connected
          } @else {
            <app-rolling-counter [value]="connectedCount()" />&nbsp;connected
          }
        </span>
      </h1>
      <p class="hdr-sub">Compose once. Tailor per network. Schedule, queue, measure.</p>
      <div class="auto-pilot-row" role="group" aria-label="Auto-Pilot controls">
        <label class="auto-pilot-toggle" [class.is-on]="autoPilotEnabled()" [class.is-busy]="autoPilotSaving()">
          <input
            type="checkbox"
            [checked]="autoPilotEnabled()"
            (change)="setAutoPilot($any($event.target).checked)"
            [disabled]="autoPilotSaving()"
            aria-label="Toggle Auto-Pilot" />
          <span class="auto-pilot-toggle__track">
            <span class="auto-pilot-toggle__dot"></span>
          </span>
          <span class="auto-pilot-toggle__label">Auto-Pilot</span>
          @if (autoPilotEnabled()) {
            <span class="auto-pilot-toggle__hint">drafts every {{ autoPilotCadenceHours() }}h</span>
          }
        </label>
        <button
          type="button"
          class="auto-pilot-btn"
          (click)="openAutoPilotPrompt()"
          aria-label="Configure Auto-Pilot prompt"
          data-testid="social-auto-pilot-prompt-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          Auto-Pilot prompt
        </button>
      </div>
    </div>
    <nav class="tab-row" role="tablist" hlmTablist aria-label="Pulse Social tabs">
      <button class="tab" role="tab" [class.is-active]="tab() === 'compose'" (click)="tab.set('compose')">Compose</button>
      <button class="tab" role="tab" [class.is-active]="tab() === 'drafts'" (click)="loadPosts('draft'); tab.set('drafts')">
        Drafts <span class="tab-count">{{ draftsCount() }}</span>
      </button>
      <button class="tab" role="tab" [class.is-active]="tab() === 'queue'" (click)="loadPosts('scheduled'); tab.set('queue')">
        Queue <span class="tab-count">{{ scheduledCount() }}</span>
      </button>
      <button class="tab" role="tab" [class.is-active]="tab() === 'sent'" (click)="loadPosts('published'); tab.set('sent')">
        Sent <span class="tab-count">{{ publishedCount() }}</span>
      </button>
      <button class="tab" role="tab" [class.is-active]="tab() === 'calendar'" (click)="tab.set('calendar')">Calendar</button>
    </nav>
  </header>

  <!-- ═══════════════════════ 3-PANE BODY ═══════════════════════ -->
  <div class="three-pane">

    <!-- ─────────── LEFT: ACCOUNTS ─────────── -->
    <aside class="pane-accounts" appReveal aria-label="Connected accounts">
      <div class="pane-h">Connected accounts</div>
      @if (accountsError()) {
        <app-inline-error
          class="block mb-2"
          data-testid="social-accounts-error"
          message="Couldn't load connection states — badges may be out of date."
          (retry)="retryAccounts()" />
      }
      <div class="acct-list">
        @for (p of platforms; track p.id) {
          @let acct = accountFor(p.id);
          <article class="acct-card" [class.is-on]="acct?.connected" [style.--brand]="p.color">
            <div class="acct-glyph" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="p.glyph"/></svg>
            </div>
            <div class="acct-meta">
              <div class="acct-label">{{ p.label }}</div>
              @if (acct?.connected) {
                <div class="acct-handle">{{ acct?.handle || 'connected' }}</div>
              } @else {
                <div class="acct-handle dim">Not connected</div>
              }
            </div>
            <span class="acct-pill" [class.is-on]="acct?.connected">{{ acct?.connected ? 'Live' : 'Off' }}</span>
            @if (acct?.connected) {
              <button class="acct-btn" type="button" (click)="disconnect(p.id)" [disabled]="isDisconnectingAcct(p.id)" [attr.aria-busy]="isDisconnectingAcct(p.id)" [attr.aria-label]="'Disconnect ' + p.label">{{ isDisconnectingAcct(p.id) ? 'Disconnecting…' : 'Disconnect' }}</button>
            } @else {
              <button class="acct-btn primary" type="button" (click)="connect(p.id)" [attr.aria-label]="'Connect ' + p.label">+ Connect</button>
            }
          </article>
        }
      </div>
    </aside>

    <!-- ─────────── CENTER: TAB CONTENT ─────────── -->
    <section class="pane-main">

      <!-- ============ COMPOSER ============ -->
      @if (tab() === 'compose') {
        <div class="composer" appReveal>

          <!-- Platform toggle chips -->
          <div class="chip-row" role="group" aria-label="Select platforms">
            @for (p of platforms; track p.id) {
              @let on = isPlatformSelected(p.id);
              @let conn = isConnected(p.id);
              <button
                type="button"
                class="chip"
                [class.is-on]="on"
                [class.is-override]="hasOverride(p.id)"
                [class.is-off]="!conn"
                [style.--brand]="p.color"
                [disabled]="!conn"
                [attr.aria-pressed]="on"
                [title]="on ? (hasOverride(p.id) ? 'Tap again to remove per-platform copy' : 'Tap again to customize copy for ' + p.label) : 'Add ' + p.label"
                (click)="togglePlatform(p.id)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="p.glyph"/></svg>
                <span>{{ p.label }}</span>
                @if (on) {
                  <span class="chip-ct" [class.over]="charsFor(p.id) > p.charLimit">{{ charsFor(p.id) }}/{{ p.charLimit }}</span>
                }
              </button>
            }
          </div>

          <!-- Main textarea -->
          <textarea
            #mainTa
            hlmInput
            [multiline]="true"
            class="w-full min-h-[90px] resize-y leading-relaxed"
            rows="4"
            [(ngModel)]="content"
            (ngModelChange)="onContentChange($event)"
            (keydown)="onContentKeydown($event)"
            placeholder="What are you sharing today?"
            aria-label="Post content"
            data-testid="social-composer-textarea"></textarea>

          <!-- Mention autocomplete dropdown -->
          @if (mentionOpen() && mentionResults().length > 0) {
            <div class="mention-pop" role="listbox" aria-label="Mention suggestions">
              @for (m of mentionResults(); track m.handle; let i = $index) {
                <button
                  type="button"
                  role="option"
                  class="mention-row"
                  [class.is-active]="i === mentionIdx()"
                  (mousedown)="insertMention(m, $event)">
                  <span class="mention-handle">&#64;{{ m.handle }}</span>
                  @if (m.name) { <span class="mention-name">{{ m.name }}</span> }
                </button>
              }
            </div>
          }

          <!-- Per-platform override surfaces -->
          @for (p of platforms; track p.id) {
            @if (hasOverride(p.id)) {
              <div class="override-row" [style.--brand]="p.color">
                <div class="override-h">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="p.glyph"/></svg>
                  <span>{{ p.label }} override</span>
                  <span class="override-ct" [class.over]="(perPlatform()[p.id]?.length || 0) > p.charLimit">
                    {{ perPlatform()[p.id]?.length || 0 }}/{{ p.charLimit }}
                  </span>
                  <button type="button" class="override-x" (click)="removeOverride(p.id)" aria-label="Remove override">&times;</button>
                </div>
                <textarea
                  hlmInput
                  [multiline]="true"
                  class="w-full min-h-[60px] resize-y text-[0.82rem]"
                  rows="3"
                  [ngModel]="perPlatform()[p.id]"
                  (ngModelChange)="setOverride(p.id, $event)"
                  [placeholder]="'Tailored copy for ' + p.label"
                  [attr.aria-label]="p.label + ' tailored content'"></textarea>
              </div>
            }
          }

          <!-- Media uploader -->
          <div class="media-zone"
               [class.is-drag]="dragOver()"
               (dragover)="onDragOver($event)"
               (dragleave)="dragOver.set(false)"
               (drop)="onDrop($event)"
               (click)="fileInput.click()"
               (keydown.enter)="fileInput.click()"
               role="button"
               tabindex="0"
               aria-label="Drop or click to upload media">
            <input #fileInput type="file" accept="image/*,video/*" multiple hidden (change)="onFiles($event)" />
            @if (media().length === 0) {
              <div class="media-empty">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
                <span>Drag images/video here, or click to browse</span>
              </div>
            } @else {
              <div class="media-grid">
                @for (m of media(); track m.id) {
                  <figure class="media-tile" (click)="$event.stopPropagation()">
                    @if (m.type === 'video') {
                      <video [src]="m.url" muted></video>
                    } @else {
                      <img [src]="m.thumb_url || m.url" [alt]="m.alt || ''" loading="lazy" />
                    }
                    <input
                      class="media-alt"
                      type="text"
                      [value]="m.alt"
                      (input)="updateAlt(m.id, $any($event.target).value)"
                      placeholder="Alt text"
                      [attr.aria-label]="'Alt text for ' + (m.type || 'media')" />
                    <button type="button" class="media-x" (click)="removeMedia(m.id); $event.stopPropagation()" aria-label="Remove media">&times;</button>
                  </figure>
                }
                <button type="button" class="media-add" (click)="fileInput.click(); $event.stopPropagation()" aria-label="Add more media">+</button>
              </div>
            }
          </div>

          <!-- Hashtags + link + AI/mention helpers -->
          <div class="meta-grid">

            <div class="meta-col">
              <label class="meta-lbl" for="ps-tags">Hashtags <span class="meta-aux">{{ hashtags().length }}/30</span></label>
              <div class="tag-input">
                @for (t of hashtags(); track t; let i = $index) {
                  <span class="tag-chip">#{{ t }} <button type="button" (click)="removeHashtag(i)" aria-label="Remove tag">&times;</button></span>
                }
                <input
                  hlmInput
                  id="ps-tags"
                  class="flex-1"
                  type="text"
                  [(ngModel)]="hashtagDraft"
                  (keydown)="onHashtagKeydown($event)"
                  placeholder="Type, then space or comma" />
              </div>
            </div>

            <div class="meta-col">
              <label class="meta-lbl" for="ps-link">Link</label>
              <input
                hlmInput
                id="ps-link"
                class="w-full"
                type="url"
                [(ngModel)]="link"
                (blur)="fetchOg()"
                placeholder="https://…" />
              @if (og(); as o) {
                <div class="og-card" data-testid="og-card">
                  @if (o.image) { <img [src]="o.image" [alt]="o.title" /> }
                  <div class="og-meta">
                    <div class="og-site">{{ o.site_name }}</div>
                    <div class="og-title">{{ o.title }}</div>
                    <div class="og-desc">{{ o.description }}</div>
                  </div>
                </div>
              } @else if (linkHost()) {
                <div class="og-card og-card--fallback" data-testid="link-fallback-card">
                  <div class="og-meta">
                    <div class="og-site">{{ linkHost() }}</div>
                    <div class="og-title">{{ link() }}</div>
                    <div class="og-desc">Preview unavailable — the link still posts with your message.</div>
                  </div>
                </div>
              }
            </div>

          </div>

          <!-- AI assist row -->
          <div class="ai-row">
            <select hlmSelect [(ngModel)]="aiTone" aria-label="AI tone">
              <option value="punchy">Punchy</option>
              <option value="warm">Warm</option>
              <option value="authoritative">Authoritative</option>
              <option value="playful">Playful</option>
              <option value="story">Story-driven</option>
            </select>
            <button type="button" class="btn-ai" (click)="generate()" [disabled]="aiLoading() || selected().length === 0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              {{ aiLoading() ? 'Drafting…' : 'AI assist' }}
            </button>
            @if (aiVariants().length > 0) {
              <div class="ai-variants" role="group" aria-label="AI variant carousel">
                <button type="button" class="ai-nav" (click)="prevVariant()" aria-label="Previous variant">‹</button>
                <span class="ai-vidx">{{ variantIdx() + 1 }} / {{ aiVariants().length }}</span>
                <button type="button" class="ai-nav" (click)="nextVariant()" aria-label="Next variant">›</button>
                <button type="button" class="ai-use" (click)="useVariant()">Use</button>
              </div>
            }
          </div>

          <!-- Schedule + best-times -->
          <div class="sched-row">
            <label class="meta-lbl">When</label>
            <div class="sched-btns">
              <button type="button" class="sched-btn" [class.is-on]="!scheduleAt()" (click)="scheduleAt.set(null)">Post now</button>
              <button type="button" class="sched-btn" [class.is-on]="!!scheduleAt()" (click)="openScheduler()">Schedule</button>
              @if (scheduleAt()) {
                <input hlmInput type="datetime-local" [(ngModel)]="scheduleAt" aria-label="Scheduled time" />
                <select hlmSelect [(ngModel)]="scheduleTz" aria-label="Time zone">
                  <option value="America/Los_Angeles">Los Angeles</option>
                  <option value="America/New_York">New York</option>
                  <option value="America/Chicago">Chicago</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">London</option>
                  <option value="Europe/Berlin">Berlin</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                </select>
              }
            </div>
            @if (bestTimes().length > 0) {
              <div class="best-times">
                <span class="best-h">Best for {{ selected().length }} platforms:</span>
                @for (b of bestTimes(); track b) {
                  <button type="button" class="best-chip" (click)="applyBestTime(b)">{{ b }}</button>
                }
              </div>
            }
          </div>

          <!-- Status line -->
          <div class="status-line" [attr.aria-live]="'polite'">
            <span>{{ selected().length }} platform{{ selected().length === 1 ? '' : 's' }}</span>
            <span>·</span>
            <span>{{ mediaSummary() }}</span>
            <span>·</span>
            <span>{{ scheduleSummary() }}</span>
          </div>

          <!-- Actions -->
          <div class="action-row">
            <button type="button" class="btn-ghost" (click)="discard()">Discard</button>
            <button type="button" class="btn-ghost" (click)="saveDraft()" [disabled]="saving()">Save draft</button>
            <button type="button" class="btn-primary" (click)="publish()" [disabled]="!canPublish() || saving()"
              [attr.aria-describedby]="publishBlockReason() ? 'publish-hint' : null">
              {{ scheduleAt() ? 'Schedule post' : 'Publish now' }}
            </button>
          </div>
          @if (publishBlockReason(); as reason) {
            <p class="publish-hint" id="publish-hint" role="status" aria-live="polite" data-testid="publish-hint">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {{ reason }}
            </p>
          }

          <!-- Bulk import (RSS) -->
          <div class="rss-row">
            <details>
              <summary>Bulk import from RSS</summary>
              <div class="rss-body">
                <input hlmInput class="flex-1" type="url" [(ngModel)]="rssUrl" placeholder="https://example.com/feed.xml" aria-label="RSS feed URL"
                  [attr.aria-invalid]="rssUrlInvalid()" [attr.aria-describedby]="rssUrlInvalid() ? 'rss-url-hint' : null" />
                <button type="button" class="btn-ghost" (click)="rssPreview()" [disabled]="!rssUrlValid()">Preview</button>
                @if (rssUrlInvalid()) {
                  <span id="rss-url-hint" data-testid="rss-url-hint" class="rss-hint">Must be a valid https:// feed URL.</span>
                }
                @if (rssItems().length > 0) {
                  <ul class="rss-list">
                    @for (it of rssItems(); track it.url) {
                      <li><strong>{{ it.title }}</strong> · <a [href]="it.url" target="_blank" rel="noopener noreferrer">{{ it.url }}</a></li>
                    }
                  </ul>
                  <div class="rss-actions">
                    <button type="button" class="btn-primary" (click)="importRssDrafts()" [disabled]="importingRss()" data-testid="rss-import-drafts">
                      {{ importingRss() ? 'Importing…' : 'Import ' + rssItems().length + ' as drafts' }}
                    </button>
                    <button type="button" class="btn-ghost" (click)="copyRssLinks()" data-testid="rss-copy-links">Copy links</button>
                    <span class="rss-hint">Drafts land in your Drafts tab — assign accounts + schedule there.</span>
                  </div>
                }
              </div>
            </details>
          </div>
        </div>
      }

      <!-- ============ DRAFTS / QUEUE / SENT lists ============ -->
      @if (tab() === 'drafts' || tab() === 'queue' || tab() === 'sent') {
        <div class="list-pane" appReveal>
          @if (filteredPosts().length === 0) {
            <div class="empty-state">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
              <h3>Nothing here yet</h3>
              <p>{{ tab() === 'drafts' ? 'Save a draft from the composer to see it here.' : tab() === 'queue' ? 'Schedule a post to fill the queue.' : 'Published posts will appear here with analytics.' }}</p>
              <button type="button" class="btn-primary" (click)="tab.set('compose')">Open composer</button>
            </div>
          } @else {
            @for (post of filteredPosts(); track post.id) {
              <article class="post-card" appReveal [revealDelay]="$index * 60">
                <header class="post-h">
                  <div class="post-platforms">
                    @for (p of post.platforms; track p) {
                      @let pd = defOf(p);
                      <span class="post-pglyph" [style.--brand]="pd?.color" [title]="pd?.label || p">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="pd?.glyph || ''"/></svg>
                      </span>
                    }
                  </div>
                  <span class="post-status" [class]="'is-' + post.status">{{ post.status }}</span>
                  <span class="post-time">{{ post.scheduled_at || post.published_at | date:'short' }}</span>
                </header>
                <p class="post-body">{{ post.content }}</p>
                @if (post.media.length > 0) {
                  <div class="post-thumbs">
                    @for (m of post.media; track m.id) {
                      <img [src]="m.thumb_url || m.url" [alt]="m.alt" loading="lazy" />
                    }
                  </div>
                }

                @if (tab() === 'sent') {
                  <div class="post-stats">
                    @for (row of analyticsFor(post.id); track row.platform) {
                      @let pd = defOf(row.platform);
                      <div class="stat-tile" [style.--brand]="pd?.color">
                        <div class="stat-h"><span class="stat-glyph"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="pd?.glyph || ''"/></svg></span> {{ pd?.label }}</div>
                        <div class="stat-grid">
                          <div><span class="stat-k">Impressions</span><app-rolling-counter [value]="row.impressions" /></div>
                          <div><span class="stat-k">Likes</span><app-rolling-counter [value]="row.likes" /></div>
                          <div><span class="stat-k">Shares</span><app-rolling-counter [value]="row.shares" /></div>
                          <div><span class="stat-k">Clicks</span><app-rolling-counter [value]="row.clicks" /></div>
                        </div>
                      </div>
                    }
                  </div>
                  <div class="post-links">
                    @for (p of post.platforms; track p) {
                      @if (post.per_platform_url?.[p]) {
                        <a [href]="post.per_platform_url![p]!" target="_blank" rel="noopener noreferrer">View on {{ defOf(p)?.label }}<svg class="inline-block align-[-2px] ml-[3px]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
                      }
                    }
                  </div>
                }

                <div class="post-actions">
                  @if (tab() === 'drafts') {
                    <button type="button" class="btn-ghost sm" (click)="editPost(post)">Edit</button>
                    <button type="button" class="btn-ghost sm danger" [disabled]="isDeletingPost(post.id)" [attr.aria-busy]="isDeletingPost(post.id)" (click)="deletePost(post)">{{ isDeletingPost(post.id) ? 'Deleting…' : 'Delete' }}</button>
                    <button type="button" class="btn-primary sm" [class.is-busy]="isPublishing(post.id)" [disabled]="isPublishing(post.id)" (click)="publishNow(post)">{{ isPublishing(post.id) ? 'Publishing…' : 'Publish' }}</button>
                  }
                  @if (tab() === 'queue') {
                    <button type="button" class="btn-ghost sm" (click)="editPost(post)">Edit time</button>
                    <button type="button" class="btn-ghost sm danger" [disabled]="isDeletingPost(post.id)" [attr.aria-busy]="isDeletingPost(post.id)" (click)="deletePost(post)">{{ isDeletingPost(post.id) ? 'Cancelling…' : 'Cancel' }}</button>
                    <button type="button" class="btn-primary sm" [class.is-busy]="isPublishing(post.id)" [disabled]="isPublishing(post.id)" (click)="publishNow(post)">{{ isPublishing(post.id) ? 'Publishing…' : 'Send now' }}</button>
                  }
                  @if (tab() === 'sent') {
                    <button type="button" class="btn-ghost sm" (click)="duplicatePost(post)">Duplicate</button>
                  }
                </div>
              </article>
            }
          }
        </div>
      }

      <!-- ============ CALENDAR ============ -->
      @if (tab() === 'calendar') {
        <div class="cal-pane" appReveal>
          <header class="cal-h">
            <button type="button" class="btn-ghost sm" (click)="calPrev()" aria-label="Previous month">‹</button>
            <h3>{{ calLabel() }}</h3>
            <button type="button" class="btn-ghost sm" (click)="calNext()" aria-label="Next month">›</button>
            <button type="button" class="btn-ghost sm" (click)="calToday()">Today</button>
          </header>
          <div class="cal-grid" role="grid" aria-label="Scheduled posts calendar">
            @for (h of weekDayHeaders; track h) {
              <div class="cal-dh">{{ h }}</div>
            }
            @for (cell of calCells(); track cell.iso) {
              <div class="cal-cell"
                   [class.is-today]="cell.today"
                   [class.is-out]="cell.outOfMonth"
                   (dragover)="onCalDragOver($event)"
                   (drop)="onCalDrop($event, cell.iso)">
                <div class="cal-num">{{ cell.day }}</div>
                @for (post of postsOnDay(cell.iso); track post.id) {
                  <button
                    type="button"
                    class="cal-event"
                    draggable="true"
                    [style.--brand]="defOf(post.platforms[0])?.color"
                    (dragstart)="onCalEventDrag($event, post)"
                    (click)="editPost(post)"
                    [title]="post.content">
                    <span class="cal-time">{{ post.scheduled_at | date:'shortTime' }}</span>
                    <span class="cal-txt">{{ post.content }}</span>
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }
    </section>

    <!-- ─────────── RIGHT: PREVIEWS ─────────── -->
    <aside class="pane-previews" appReveal aria-label="Post previews">
      <div class="pane-h">Live preview</div>
      @if (selected().length === 0) {
        <div class="prev-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          <p>Select a platform to preview.</p>
        </div>
      } @else {
        @for (pid of selected(); track pid) {
          @let p = defOf(pid)!;
          @let txt = perPlatform()[pid] || content();
          <article class="prev-card" [style.--brand]="p.color">
            <header class="prev-h">
              <span class="prev-glyph"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path [attr.d]="p.glyph"/></svg></span>
              <span class="prev-name">{{ p.label }}</span>
              <span class="prev-handle">{{ accountFor(pid)?.handle || '@you' }}</span>
            </header>
            <div class="prev-body">
              <div class="prev-avatar"></div>
              <div class="prev-content">
                <div class="prev-author">Your brand</div>
                <p class="prev-txt">{{ txt || 'Your post preview will appear here…' }}</p>
                @if (hashtags().length > 0) {
                  <p class="prev-tags">@for (t of hashtags(); track t) { <span>#{{ t }}</span> }</p>
                }
                @if (media().length > 0) {
                  <div class="prev-media" [attr.data-count]="media().length">
                    @for (m of media().slice(0, 4); track m.id) {
                      <img [src]="m.thumb_url || m.url" [alt]="m.alt" loading="lazy" />
                    }
                  </div>
                }
                @if (og(); as o) {
                  <div class="prev-og">
                    @if (o.image) { <img [src]="o.image" [alt]="o.title" /> }
                    <div>
                      <div class="prev-og-site">{{ o.site_name }}</div>
                      <div class="prev-og-title">{{ o.title }}</div>
                    </div>
                  </div>
                }
                <div class="prev-actions" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </div>
              </div>
            </div>
          </article>
        }
      }
    </aside>

  </div>

  <!-- ═══════════════════════ AUTO-PILOT PROMPT DIALOG ═══════════════════════ -->
  @if (autoPilotDialogOpen()) {
    <app-dialog-shell (closed)="closeAutoPilotDialog()">
      <span dialogIcon class="ap-dlg-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </span>
      <span dialogTitle>Auto-Pilot prompt</span>
      <span dialogBadge class="ap-dlg-badge">Drafts only</span>

      <div class="ap-dlg-body">
        <p class="ap-dlg-blurb">
          Auto-Pilot autonomously composes posts on a cadence using this system prompt and your business context. Output is saved as a <strong>draft</strong> — you still review and publish manually.
        </p>

        <label class="ap-dlg-lbl" for="ap-prompt">System prompt</label>
        <textarea
          hlmInput
          [multiline]="true"
          id="ap-prompt"
          class="w-full resize-y"
          rows="8"
          [ngModel]="autoPilotPromptDraft()"
          (ngModelChange)="autoPilotPromptDraft.set($event)"
          [attr.aria-label]="'Auto-Pilot system prompt'"
          placeholder="You are an autonomous social media composer for {{ '{{business_name}}' }}…"></textarea>
        <div class="ap-dlg-help">
          Variables: <code>{{ '{{business_name}}' }}</code>, <code>{{ '{{business_type}}' }}</code>, <code>{{ '{{brand_voice}}' }}</code>, <code>{{ '{{recent_news}}' }}</code>, <code>{{ '{{target_networks}}' }}</code>.
          <button type="button" class="ap-dlg-link" (click)="resetAutoPilotPromptToDefault()">Reset to default</button>
        </div>

        <div class="ap-dlg-grid">
          <div>
            <label class="ap-dlg-lbl" for="ap-cadence">Cadence</label>
            <select
              hlmSelect
              id="ap-cadence"
              class="w-full"
              [ngModel]="autoPilotCadenceDraft()"
              (ngModelChange)="autoPilotCadenceDraft.set(+$event)"
              aria-label="Auto-Pilot cadence">
              <option [ngValue]="6">Every 6 hours</option>
              <option [ngValue]="12">Every 12 hours</option>
              <option [ngValue]="24">Every 24 hours</option>
              <option [ngValue]="48">Every 48 hours</option>
              <option [ngValue]="168">Weekly</option>
            </select>
          </div>
          <div>
            <label class="ap-dlg-lbl" for="ap-preview-net">Preview network</label>
            <select
              hlmSelect
              id="ap-preview-net"
              class="w-full"
              [ngModel]="autoPilotPreviewNetwork()"
              (ngModelChange)="autoPilotPreviewNetwork.set($event)"
              aria-label="Preview network">
              @for (p of platforms; track p.id) {
                <option [ngValue]="p.id">{{ p.label }}</option>
              }
            </select>
          </div>
        </div>

        <label class="ap-dlg-lbl">Target networks</label>
        <div class="ap-dlg-chips" role="group" aria-label="Target networks for Auto-Pilot">
          @for (p of platforms; track p.id) {
            <button
              type="button"
              class="ap-dlg-chip"
              [class.is-on]="autoPilotNetworksDraft().includes(p.id)"
              [style.--brand]="p.color"
              [attr.aria-pressed]="autoPilotNetworksDraft().includes(p.id)"
              (click)="toggleAutoPilotNetwork(p.id)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path [attr.d]="p.glyph"/></svg>
              <span>{{ p.label }}</span>
            </button>
          }
        </div>

        <div class="ap-dlg-preview">
          <div class="ap-dlg-preview__h">
            <span>Sample output</span>
            <button
              type="button"
              class="ap-dlg-btn ghost"
              (click)="previewAutoPilotPost()"
              [disabled]="autoPilotPreviewing()">
              {{ autoPilotPreviewing() ? 'Drafting…' : 'Generate preview' }}
            </button>
          </div>
          @if (autoPilotPreviewText()) {
            <pre class="ap-dlg-preview__body">{{ autoPilotPreviewText() }}</pre>
            @if (autoPilotPreviewMedia()) {
              <div class="ap-dlg-preview__media">Suggested media: {{ autoPilotPreviewMedia() }}</div>
            }
          } @else {
            <div class="ap-dlg-preview__empty">Click "Generate preview" to see one sample for {{ defOf(autoPilotPreviewNetwork())?.label }}.</div>
          }
        </div>
      </div>

      <div dialogFooter class="ap-dlg-footer">
        <button type="button" class="ap-dlg-btn ghost" (click)="closeAutoPilotDialog()">Cancel</button>
        <button
          type="button"
          class="ap-dlg-btn primary"
          (click)="saveAutoPilotConfig()"
          [disabled]="autoPilotSaving()">
          {{ autoPilotSaving() ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </app-dialog-shell>
  }

  <!-- ═══════════════════════ PASTE-KEY CONNECT DIALOG ═══════════════════════ -->
  @if (pasteOpen(); as pid) {
    <app-dialog-shell (closed)="closePaste()">
      <span dialogTitle>Connect {{ defOf(pid)?.label || pid }}</span>
      <span dialogBadge class="ap-dlg-badge">Paste key</span>

      <div class="ap-dlg-body">
        @switch (pid) {
          @case ('bluesky') {
            <p class="ap-dlg-blurb">Create an app password at Settings → App Passwords, then paste it below.</p>
            <div>
              <label class="ap-dlg-lbl" for="paste-bsky-id">Handle or email</label>
              <input hlmInput id="paste-bsky-id" class="w-full" type="text" [(ngModel)]="pasteF.identifier" placeholder="you.bsky.social" autocomplete="off" autocapitalize="off" spellcheck="false" />
            </div>
            <div>
              <label class="ap-dlg-lbl" for="paste-bsky-pw">App password</label>
              <input hlmInput id="paste-bsky-pw" class="w-full" type="password" [(ngModel)]="pasteF.app_password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="off" />
            </div>
          }
          @case ('mastodon') {
            <p class="ap-dlg-blurb">Create an application in your instance’s Preferences → Development, then paste its access token.</p>
            <div>
              <label class="ap-dlg-lbl" for="paste-masto-url">Instance URL</label>
              <input hlmInput id="paste-masto-url" class="w-full" type="url" [(ngModel)]="pasteF.instance_url" placeholder="https://mastodon.social" autocomplete="off" autocapitalize="off" spellcheck="false"
                     [attr.aria-invalid]="mastoUrlInvalid() || null" [attr.aria-describedby]="mastoUrlInvalid() ? 'paste-masto-url-err' : null" />
              @if (mastoUrlInvalid()) {
                <p class="paste-err" id="paste-masto-url-err" role="alert">Enter the instance’s full https URL (e.g. https://mastodon.social).</p>
              }
            </div>
            <div>
              <label class="ap-dlg-lbl" for="paste-masto-tok">Access token</label>
              <input hlmInput id="paste-masto-tok" class="w-full" type="password" [(ngModel)]="pasteF.access_token" placeholder="Your application access token" autocomplete="off" />
            </div>
          }
          @case ('telegram') {
            <p class="ap-dlg-blurb">Add your bot to the channel as an admin, then paste the channel’s chat ID.</p>
            <div>
              <label class="ap-dlg-lbl" for="paste-tg-chat">Chat ID</label>
              <input hlmInput id="paste-tg-chat" class="w-full" type="text" [(ngModel)]="pasteF.chat_id" placeholder="@yourchannel or -100123456789" autocomplete="off" autocapitalize="off" spellcheck="false" />
            </div>
            <div>
              <label class="ap-dlg-lbl" for="paste-tg-name">Display name <span class="paste-opt">(optional)</span></label>
              <input hlmInput id="paste-tg-name" class="w-full" type="text" [(ngModel)]="pasteF.display_name" placeholder="My Channel" autocomplete="off" />
            </div>
          }
          @case ('discord') {
            <p class="ap-dlg-blurb">Enable the channel webhook for your server, then paste the channel ID.</p>
            <div>
              <label class="ap-dlg-lbl" for="paste-dc-chan">Channel ID</label>
              <input hlmInput id="paste-dc-chan" class="w-full" type="text" [(ngModel)]="pasteF.channel_id" placeholder="123456789012345678" autocomplete="off" autocapitalize="off" spellcheck="false" />
            </div>
            <div>
              <label class="ap-dlg-lbl" for="paste-dc-name">Display name <span class="paste-opt">(optional)</span></label>
              <input hlmInput id="paste-dc-name" class="w-full" type="text" [(ngModel)]="pasteF.display_name" placeholder="My Server" autocomplete="off" />
            </div>
          }
        }

        @if (pasteError(); as pe) {
          <div class="paste-err" role="alert">{{ pe }}</div>
        }
      </div>

      <div dialogFooter class="ap-dlg-footer">
        <button type="button" class="ap-dlg-btn ghost" (click)="closePaste()">Cancel</button>
        <button
          type="button"
          class="ap-dlg-btn primary"
          (click)="submitPasteConnect()"
          [disabled]="pasteSubmitting()"
          data-testid="social-paste-submit">
          {{ pasteSubmitting() ? 'Connecting…' : 'Connect' }}
        </button>
      </div>
    </app-dialog-shell>
  }
</div>
`,
  styles: [
    `
      :host {
        display: block;
        --brand: var(--ps-accent, #00e5ff);
      }

      .social-wrap {
        padding: 28px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-height: calc(100vh - 49px);
        animation: fadeIn 0.3s ease;
      }
      @media (max-width: 900px) { .social-wrap { padding: 14px; } }

      /* ── Header ── */
      .social-header { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
      .hdr-left { min-width: 0; }
      .kicker {
        text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.62rem;
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 90%, var(--ps-ink, #f4f4ff) 10%);
        font-weight: 700;
      }
      .social-h1 {
        margin: 4px 0 6px; font-size: 1.4rem; font-weight: 800;
        color: var(--ps-ink, #f4f4ff); display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      }
      .hdr-glyph { color: var(--ps-accent, #00e5ff); }
      .hdr-pill {
        display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
        border-radius: 999px; font-size: 0.7rem; font-weight: 600;
        color: var(--ps-accent, #00e5ff);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
      }
      .hdr-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ps-accent, #00e5ff); box-shadow: 0 0 8px var(--ps-accent, #00e5ff); }
      .hdr-sub { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); font-size: 0.82rem; margin: 0; }

      /* ── Auto-Pilot header controls ── */
      .auto-pilot-row {
        display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px;
      }
      .auto-pilot-toggle {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 12px; border-radius: 999px; cursor: pointer;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 80%, transparent);
        font-size: 0.78rem; font-weight: 600;
        transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
      }
      .auto-pilot-toggle:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
        color: var(--ps-ink, #f4f4ff);
      }
      .auto-pilot-toggle.is-on {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        color: var(--ps-accent, #00e5ff);
      }
      .auto-pilot-toggle.is-busy { opacity: 0.6; cursor: progress; }
      .btn-primary.is-busy { opacity: 0.65; cursor: progress; }
      .auto-pilot-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
      .auto-pilot-toggle__track {
        position: relative; width: 28px; height: 16px; border-radius: 999px;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 18%, transparent);
        transition: background 0.18s ease;
      }
      .auto-pilot-toggle.is-on .auto-pilot-toggle__track { background: var(--ps-accent, #00e5ff); }
      .auto-pilot-toggle__dot {
        position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
        background: var(--ps-bg, #060610);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .auto-pilot-toggle.is-on .auto-pilot-toggle__dot { transform: translateX(12px); }
      .auto-pilot-toggle__hint {
        font-size: 0.66rem; font-weight: 500;
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff) 30%);
      }
      .auto-pilot-toggle input:focus-visible + .auto-pilot-toggle__track {
        outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px;
      }
      .auto-pilot-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border-radius: 999px; cursor: pointer; font-family: inherit;
        font-size: 0.74rem; font-weight: 600;
        background: transparent;
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 12%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 78%, transparent);
        transition: all 0.18s ease;
      }
      .auto-pilot-btn:hover {
        color: var(--ps-ink, #f4f4ff);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
      }
      .auto-pilot-btn:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) {
        .auto-pilot-toggle, .auto-pilot-toggle__track, .auto-pilot-toggle__dot, .auto-pilot-btn { transition: none !important; }
      }

      /* ── Auto-Pilot dialog ── */
      .ap-dlg-icon { color: var(--ps-accent, #00e5ff); display: inline-flex; }
      .ap-dlg-badge {
        font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
        padding: 3px 8px; border-radius: 999px;
        background: color-mix(in oklch, #34d399 16%, transparent); color: #6ee7b7;
      }
      .ap-dlg-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
      .ap-dlg-blurb { margin: 0; font-size: 0.82rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent); }
      .ap-dlg-blurb strong { color: var(--ps-accent, #00e5ff); }
      .ap-dlg-lbl {
        display: block; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); margin-bottom: 6px;
      }
      /* .ap-dlg-ta/.ap-dlg-input removed — now Spartan hlmInput [multiline] / hlmSelect. */
      .paste-opt { font-weight: 500; text-transform: none; letter-spacing: 0; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 40%, transparent); }
      .paste-err {
        font-size: 0.78rem; line-height: 1.4; padding: 8px 11px; border-radius: 8px;
        background: color-mix(in oklch, #ff5c7a 14%, transparent);
        border: 1px solid color-mix(in oklch, #ff5c7a 38%, transparent);
        color: color-mix(in oklch, #ff5c7a 78%, var(--ps-ink, #f4f4ff));
      }
      .ap-dlg-help {
        font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      }
      .ap-dlg-help code {
        font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.66rem;
        padding: 1px 5px; border-radius: 4px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
        color: var(--ps-accent, #00e5ff);
      }
      .ap-dlg-link {
        background: none; border: none; cursor: pointer; padding: 0; margin-left: auto;
        color: var(--ps-accent, #00e5ff); font-size: 0.72rem; font-weight: 600; font-family: inherit;
        text-decoration: underline;
      }
      .ap-dlg-link:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
      .ap-dlg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media (max-width: 560px) { .ap-dlg-grid { grid-template-columns: 1fr; } }
      .ap-dlg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .ap-dlg-chip {
        --brand: var(--ps-accent, #00e5ff);
        display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px;
        border-radius: 999px; font-family: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer;
        background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        transition: all 0.16s ease;
      }
      .ap-dlg-chip:hover { color: var(--ps-ink, #f4f4ff); }
      .ap-dlg-chip.is-on {
        background: color-mix(in oklch, var(--brand) 16%, transparent);
        color: var(--brand);
        border-color: color-mix(in oklch, var(--brand) 45%, transparent);
      }
      .ap-dlg-chip:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
      .ap-dlg-preview {
        display: flex; flex-direction: column; gap: 8px;
        padding: 12px; border-radius: 12px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 80%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent);
      }
      .ap-dlg-preview__h {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      }
      .ap-dlg-preview__body {
        margin: 0; padding: 10px; border-radius: 8px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 50%, transparent);
        color: var(--ps-ink, #f4f4ff); font-family: inherit; font-size: 0.82rem; line-height: 1.55;
        white-space: pre-wrap; word-break: break-word;
      }
      .ap-dlg-preview__media {
        font-size: 0.72rem; color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff) 30%);
      }
      .ap-dlg-preview__empty {
        font-size: 0.78rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); font-style: italic;
      }
      .ap-dlg-footer {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 14px 22px; border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .ap-dlg-btn {
        padding: 8px 16px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 0.78rem; font-weight: 600;
        transition: all 0.16s ease;
      }
      .ap-dlg-btn.ghost {
        background: transparent;
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 12%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 78%, transparent);
      }
      .ap-dlg-btn.ghost:hover { color: var(--ps-ink, #f4f4ff); border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent); }
      .ap-dlg-btn.primary {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent);
        color: var(--ps-accent, #00e5ff);
      }
      .ap-dlg-btn.primary:hover { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 28%, transparent); }
      .ap-dlg-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .ap-dlg-btn:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }

      .tab-row {
        display: inline-flex; gap: 4px; padding: 4px;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 5%, transparent);
        border-radius: 12px; border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        flex-wrap: wrap;
      }
      .tab {
        padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
        background: transparent; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent);
        font-size: 0.78rem; font-weight: 600; font-family: inherit; transition: all 0.18s ease;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .tab:hover { color: var(--ps-ink, #f4f4ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 6%, transparent); }
      .tab.is-active {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
        color: var(--ps-accent, #00e5ff);
        box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
      }
      .tab-count {
        display: inline-flex; min-width: 18px; height: 18px; padding: 0 5px; align-items: center;
        justify-content: center; border-radius: 999px; font-size: 0.62rem;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent); color: inherit;
      }

      /* ── 3-pane layout ── */
      .three-pane {
        display: grid; grid-template-columns: 220px 1fr 320px;
        gap: 16px; min-height: 0; flex: 1;
      }
      @media (max-width: 1200px) { .three-pane { grid-template-columns: 200px 1fr; } .pane-previews { display: none; } }
      @media (max-width: 800px)  { .three-pane { grid-template-columns: 1fr; } .pane-accounts { display: none; } }

      .pane-h {
        font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); margin-bottom: 8px;
      }

      /* ── Accounts ── */
      .pane-accounts { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      .acct-list { display: flex; flex-direction: column; gap: 6px; }
      .acct-card {
        --brand: var(--ps-accent, #00e5ff);
        display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 8px;
        padding: 9px 10px; border-radius: 10px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        transition: all 0.18s ease;
      }
      .acct-card.is-on { border-color: color-mix(in oklch, var(--brand) 35%, transparent); }
      .acct-card:hover { transform: translateY(-1px); box-shadow: 0 4px 14px color-mix(in oklch, var(--brand) 14%, transparent); }
      /* While accounts reload, dim the cards so the provisional "Off" states read
         as loading (not a definitive "Not connected"). Wires the .is-loading host. */
      .social-wrap.is-loading .acct-card { opacity: 0.5; transition: opacity 0.2s ease; }
      .acct-glyph {
        width: 28px; height: 28px; border-radius: 8px;
        background: color-mix(in oklch, var(--brand) 14%, transparent);
        color: var(--brand); display: grid; place-items: center;
      }
      .acct-meta { min-width: 0; grid-column: 2; }
      .acct-label { font-size: 0.76rem; font-weight: 600; color: var(--ps-ink, #f4f4ff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .acct-handle { font-size: 0.66rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .acct-handle.dim { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); }
      .acct-pill {
        grid-row: 1; grid-column: 3; font-size: 0.56rem; font-weight: 700; text-transform: uppercase;
        padding: 2px 7px; border-radius: 999px;
        background: color-mix(in oklch, #ff5470 14%, transparent); color: #ff8a9d;
      }
      .acct-pill.is-on { background: color-mix(in oklch, #34d399 18%, transparent); color: #6ee7b7; }
      .acct-btn {
        grid-column: 1 / -1; padding: 5px 10px; border-radius: 7px; border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        background: transparent; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
        font-size: 0.7rem; cursor: pointer; transition: all 0.16s ease; font-family: inherit; font-weight: 600;
      }
      .acct-btn:hover { color: var(--ps-ink, #f4f4ff); border-color: color-mix(in oklch, var(--brand) 40%, transparent); }
      .acct-btn.primary { background: color-mix(in oklch, var(--brand) 14%, transparent); border-color: color-mix(in oklch, var(--brand) 35%, transparent); color: var(--brand); }

      /* ── Center / composer ── */
      .pane-main { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
      .composer {
        background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        border-radius: var(--ps-radius-xl, 22px);
        padding: 18px;
        backdrop-filter: blur(14px);
        display: flex; flex-direction: column; gap: 14px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25),
                    0 0 0 1px color-mix(in oklch, var(--ps-accent, #00e5ff) 5%, transparent);
        position: relative;
      }

      .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        --brand: var(--ps-accent, #00e5ff);
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 10px; border-radius: 999px; cursor: pointer;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
        font-size: 0.74rem; font-weight: 600; font-family: inherit; transition: all 0.16s ease;
      }
      .chip:hover:not(:disabled) { transform: translateY(-1px); border-color: color-mix(in oklch, var(--brand) 40%, transparent); color: var(--ps-ink, #f4f4ff); }
      .chip.is-on { background: color-mix(in oklch, var(--brand) 16%, transparent); border-color: color-mix(in oklch, var(--brand) 45%, transparent); color: var(--brand); }
      .chip.is-override { box-shadow: 0 0 0 2px color-mix(in oklch, var(--brand) 24%, transparent); }
      .chip.is-off { opacity: 0.45; cursor: not-allowed; }
      .chip-ct { font-size: 0.62rem; opacity: 0.85; padding-left: 4px; border-left: 1px solid currentColor; margin-left: 2px; }
      .chip-ct.over { color: #ff6b8a; font-weight: 700; }

      /* .composer-ta removed — composer textareas now Spartan hlmInput [multiline] (min-h via Tailwind). */

      .mention-pop {
        position: absolute; left: 18px; right: 18px; max-width: 320px; z-index: 50;
        background: color-mix(in oklch, var(--ps-bg, #060610) 95%, black);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 24%, transparent);
        border-radius: 10px; padding: 6px; display: flex; flex-direction: column; gap: 2px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
      }
      .mention-row {
        display: flex; gap: 8px; padding: 6px 8px; border-radius: 6px; border: none; background: transparent;
        text-align: left; cursor: pointer; color: var(--ps-ink, #f4f4ff); font-family: inherit; font-size: 0.78rem;
      }
      .mention-row.is-active, .mention-row:hover { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent); }
      .mention-handle { color: var(--ps-accent, #00e5ff); font-weight: 700; }
      .mention-name { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }

      .override-row {
        --brand: var(--ps-accent, #00e5ff);
        padding: 10px; border-radius: 12px;
        background: color-mix(in oklch, var(--brand) 5%, transparent);
        border: 1px solid color-mix(in oklch, var(--brand) 28%, transparent);
        display: flex; flex-direction: column; gap: 8px;
      }
      .override-h {
        display: flex; align-items: center; gap: 8px; font-size: 0.74rem; font-weight: 700; color: var(--brand);
      }
      .override-ct { margin-left: auto; font-size: 0.62rem; opacity: 0.85; }
      .override-ct.over { color: #ff6b8a; }
      .override-x { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 1.1rem; line-height: 1; }

      /* ── Media zone ── */
      .media-zone {
        border: 1.5px dashed color-mix(in oklch, var(--ps-ink, #f4f4ff) 16%, transparent);
        border-radius: 12px; padding: 14px; cursor: pointer; transition: all 0.18s ease;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 2%, transparent);
      }
      .media-zone:hover, .media-zone.is-drag {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 4%, transparent);
      }
      .media-zone:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
      .media-empty { display: flex; align-items: center; gap: 10px; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); font-size: 0.82rem; }
      .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
      .media-tile {
        position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; margin: 0;
        background: color-mix(in oklch, var(--ps-bg, #060610) 85%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
      }
      .media-tile img, .media-tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .media-alt {
        position: absolute; left: 4px; right: 4px; bottom: 4px;
        background: rgba(0, 0, 0, 0.75); color: white; border: none; border-radius: 5px;
        padding: 4px 6px; font-size: 0.62rem; font-family: inherit; outline: none;
      }
      .media-x {
        position: absolute; top: 4px; right: 4px; width: 22px; height: 22px;
        background: rgba(0, 0, 0, 0.7); color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 1rem; line-height: 1;
      }
      .media-add {
        aspect-ratio: 1; border-radius: 10px; cursor: pointer; font-size: 1.5rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
        border: 1px dashed color-mix(in oklch, var(--ps-ink, #f4f4ff) 18%, transparent);
      }

      /* ── Meta grid ── */
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 700px) { .meta-grid { grid-template-columns: 1fr; } }
      .meta-col { display: flex; flex-direction: column; gap: 6px; }
      .meta-lbl { font-size: 0.7rem; font-weight: 600; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); display: flex; align-items: center; gap: 6px; }
      .meta-aux { margin-left: auto; opacity: 0.65; font-weight: 400; }
      /* .meta-input removed — now Spartan hlmInput. */
      .tag-input {
        display: flex; flex-wrap: wrap; gap: 5px; padding: 6px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 80%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent); border-radius: 9px;
      }
      .tag-input input { flex: 1; min-width: 140px; background: transparent; border: none; outline: none; color: var(--ps-ink, #f4f4ff); font-family: inherit; font-size: 0.8rem; padding: 4px; }
      .tag-chip {
        display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
        color: var(--ps-accent, #00e5ff); font-size: 0.7rem; font-weight: 600;
      }
      .tag-chip button { background: transparent; border: none; color: inherit; cursor: pointer; padding: 0; line-height: 1; }

      .og-card {
        display: grid; grid-template-columns: 70px 1fr; gap: 10px; padding: 8px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 75%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        border-radius: 9px;
      }
      .og-card--fallback {
        grid-template-columns: 1fr;
        border-style: dashed;
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
      }
      .og-card img { width: 70px; height: 70px; object-fit: cover; border-radius: 6px; }
      .og-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .og-site { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .og-title { font-size: 0.78rem; font-weight: 600; color: var(--ps-ink, #f4f4ff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .og-desc { font-size: 0.68rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

      /* ── AI row ── */
      .ai-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px; border-radius: 10px; background: color-mix(in oklch, var(--ps-accent, #00e5ff) 4%, transparent); }
      /* .ai-tone removed — now Spartan hlmSelect. */
      .btn-ai {
        display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 7px;
        background: linear-gradient(135deg, var(--ps-accent, #00e5ff), var(--ps-accent-secondary, #7c3aed));
        color: #000; border: none; cursor: pointer; font-weight: 700; font-size: 0.76rem; font-family: inherit;
        transition: all 0.18s ease;
      }
      .btn-ai:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent); }
      .btn-ai:disabled { opacity: 0.45; cursor: not-allowed; }
      .ai-variants { display: flex; align-items: center; gap: 6px; margin-left: auto; }
      .ai-nav {
        width: 26px; height: 26px; border-radius: 50%; border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 12%, transparent);
        background: transparent; color: var(--ps-ink, #f4f4ff); cursor: pointer; font-size: 0.9rem; line-height: 1; font-family: inherit;
      }
      .ai-vidx { font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); font-variant-numeric: tabular-nums; }
      .ai-use {
        padding: 4px 10px; border-radius: 7px; background: color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        color: var(--ps-accent, #00e5ff); cursor: pointer; font-family: inherit; font-size: 0.7rem; font-weight: 700;
      }

      /* ── Schedule ── */
      .sched-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .sched-btns { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .sched-btn {
        padding: 6px 12px; border-radius: 7px; cursor: pointer; font-family: inherit; font-size: 0.74rem; font-weight: 600;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
      }
      .sched-btn.is-on { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 16%, transparent); border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent); color: var(--ps-accent, #00e5ff); }
      /* .sched-dt/.sched-tz removed — now Spartan hlmInput/hlmSelect. */
      .best-times { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-left: auto; }
      .best-h { font-size: 0.66rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .best-chip {
        padding: 3px 9px; border-radius: 999px; cursor: pointer; font-family: inherit; font-size: 0.66rem; font-weight: 600;
        background: color-mix(in oklch, #a78bfa 14%, transparent);
        border: 1px solid color-mix(in oklch, #a78bfa 35%, transparent);
        color: #c4b5fd;
      }

      .status-line {
        display: flex; gap: 8px; font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        padding-top: 4px; flex-wrap: wrap;
      }

      .action-row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .publish-hint {
        display: flex; align-items: center; gap: 6px; justify-content: flex-end;
        margin: 6px 0 0; font-size: 0.7rem;
        color: color-mix(in oklch, #fbbf24 82%, var(--ps-ink, #f4f4ff) 18%);
      }
      .publish-hint svg { flex-shrink: 0; }
      .btn-ghost {
        padding: 8px 14px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 0.78rem; font-weight: 600;
        background: transparent; border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 12%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 80%, transparent);
        transition: all 0.16s ease;
      }
      .btn-ghost:hover { color: var(--ps-ink, #f4f4ff); border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent); }
      .btn-ghost.sm { padding: 5px 10px; font-size: 0.72rem; }
      .btn-ghost.danger { color: #ff8a9d; border-color: color-mix(in oklch, #ff5470 26%, transparent); }
      .btn-primary {
        padding: 8px 16px; border-radius: 8px; cursor: pointer; border: none; font-family: inherit; font-size: 0.8rem; font-weight: 700;
        background: linear-gradient(135deg, var(--ps-accent, #00e5ff), color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-accent-secondary, #7c3aed) 30%));
        color: #000; transition: all 0.18s ease;
      }
      .btn-primary.sm { padding: 5px 10px; font-size: 0.72rem; }
      .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent); }
      .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

      .rss-row details { border-top: 1px dashed color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent); padding-top: 10px; }
      .rss-row summary { cursor: pointer; font-size: 0.74rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent); }
      .rss-body { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
      .rss-body input {
        padding: 7px 10px; border-radius: 7px; background: color-mix(in oklch, var(--ps-bg, #060610) 80%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        color: var(--ps-ink, #f4f4ff); font-family: inherit; font-size: 0.78rem; outline: none;
      }
      .rss-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.74rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent); }
      .rss-list a { color: var(--ps-accent, #00e5ff); }
      .rss-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .rss-hint { font-size: 0.68rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }

      /* ── Post list ── */
      .list-pane { display: flex; flex-direction: column; gap: 10px; }
      .empty-state {
        display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 50px 18px;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
      }
      .empty-state svg { opacity: 0.4; }
      .empty-state h3 { color: var(--ps-ink, #f4f4ff); margin: 0; font-size: 1rem; }
      .empty-state p { font-size: 0.82rem; margin: 0; }
      .post-card {
        padding: 14px; border-radius: 14px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 65%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        display: flex; flex-direction: column; gap: 10px;
      }
      .post-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .post-platforms { display: inline-flex; gap: 4px; }
      .post-pglyph {
        width: 20px; height: 20px; border-radius: 5px;
        background: color-mix(in oklch, var(--brand) 14%, transparent);
        color: var(--brand); display: grid; place-items: center;
      }
      .post-status { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
      .post-status.is-draft     { background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent); color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent); }
      .post-status.is-scheduled { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 16%, transparent); color: var(--ps-accent, #00e5ff); }
      .post-status.is-published { background: color-mix(in oklch, #34d399 18%, transparent); color: #6ee7b7; }
      .post-status.is-partial   { background: color-mix(in oklch, #fbbf24 18%, transparent); color: #fcd34d; }
      .post-status.is-failed    { background: color-mix(in oklch, #ff5470 18%, transparent); color: #ff8a9d; }
      .post-time { font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); margin-left: auto; }
      .post-body { color: var(--ps-ink, #f4f4ff); font-size: 0.85rem; margin: 0; line-height: 1.5; white-space: pre-wrap; }
      .post-thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
      .post-thumbs img { width: 60px; height: 60px; object-fit: cover; border-radius: 6px; }
      .post-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
      .stat-tile {
        --brand: var(--ps-accent, #00e5ff);
        padding: 8px 10px; border-radius: 10px;
        background: color-mix(in oklch, var(--brand) 5%, transparent);
        border: 1px solid color-mix(in oklch, var(--brand) 22%, transparent);
      }
      .stat-h { display: flex; align-items: center; gap: 5px; font-size: 0.68rem; font-weight: 700; color: var(--brand); margin-bottom: 5px; }
      .stat-glyph { display: inline-grid; place-items: center; }
      .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-variant-numeric: tabular-nums; }
      .stat-grid > div { display: flex; flex-direction: column; gap: 1px; font-size: 0.85rem; font-weight: 700; color: var(--ps-ink, #f4f4ff); }
      .stat-k { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.08em; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); font-weight: 600; }
      .post-links { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.74rem; }
      .post-links a { color: var(--ps-accent, #00e5ff); text-decoration: none; }
      .post-links a:hover { text-decoration: underline; }
      .post-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }

      /* ── Calendar ── */
      .cal-pane {
        background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        border-radius: var(--ps-radius-xl, 22px); padding: 14px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .cal-h { display: flex; align-items: center; gap: 10px; }
      .cal-h h3 { margin: 0; font-size: 1rem; color: var(--ps-ink, #f4f4ff); flex: 1; text-align: center; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .cal-dh {
        text-align: center; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); padding: 5px;
      }
      .cal-cell {
        aspect-ratio: 1; min-height: 76px; padding: 4px; border-radius: 8px;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 3%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent);
        display: flex; flex-direction: column; gap: 3px; overflow: hidden;
      }
      .cal-cell.is-today { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent); }
      .cal-cell.is-out  { opacity: 0.35; }
      .cal-num { font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent); font-weight: 600; }
      .cal-event {
        --brand: var(--ps-accent, #00e5ff);
        border: none; cursor: grab; padding: 3px 6px; border-radius: 5px;
        background: color-mix(in oklch, var(--brand) 18%, transparent);
        color: var(--brand);
        font-size: 0.62rem; text-align: left; display: flex; gap: 4px; font-family: inherit;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cal-event:active { cursor: grabbing; }
      .cal-time { font-weight: 700; }
      .cal-txt { opacity: 0.85; text-overflow: ellipsis; overflow: hidden; }

      /* ── Right: previews ── */
      .pane-previews { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      .prev-empty {
        padding: 40px 14px; text-align: center; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
        display: flex; flex-direction: column; align-items: center; gap: 8px;
      }
      .prev-empty svg { opacity: 0.4; }
      .prev-card {
        --brand: var(--ps-accent, #00e5ff);
        padding: 12px; border-radius: 14px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 75%, transparent);
        border: 1px solid color-mix(in oklch, var(--brand) 22%, transparent);
        backdrop-filter: blur(8px);
        box-shadow: 0 1px 0 color-mix(in oklch, var(--brand) 18%, transparent);
      }
      .prev-h { display: flex; align-items: center; gap: 7px; padding-bottom: 8px; border-bottom: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent); }
      .prev-glyph { width: 22px; height: 22px; border-radius: 5px; background: color-mix(in oklch, var(--brand) 16%, transparent); color: var(--brand); display: grid; place-items: center; }
      .prev-name { font-size: 0.74rem; font-weight: 700; color: var(--brand); }
      .prev-handle { margin-left: auto; font-size: 0.66rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .prev-body { display: grid; grid-template-columns: 34px 1fr; gap: 8px; padding-top: 10px; }
      .prev-avatar {
        width: 34px; height: 34px; border-radius: 50%;
        background: linear-gradient(135deg, var(--brand), color-mix(in oklch, var(--brand) 60%, var(--ps-accent-secondary, #7c3aed)));
      }
      .prev-content { min-width: 0; }
      .prev-author { font-size: 0.76rem; font-weight: 700; color: var(--ps-ink, #f4f4ff); }
      .prev-txt { font-size: 0.78rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 90%, transparent); margin: 4px 0; white-space: pre-wrap; line-height: 1.45; }
      .prev-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
      .prev-tags span { color: var(--brand); font-size: 0.72rem; }
      .prev-media { display: grid; gap: 3px; border-radius: 9px; overflow: hidden; margin-top: 6px; }
      .prev-media[data-count="1"] { grid-template-columns: 1fr; }
      .prev-media[data-count="2"] { grid-template-columns: 1fr 1fr; }
      .prev-media[data-count="3"], .prev-media[data-count="4"] { grid-template-columns: 1fr 1fr; }
      .prev-media img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
      .prev-og {
        margin-top: 8px; padding: 6px; display: grid; grid-template-columns: 50px 1fr; gap: 7px;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent); border-radius: 8px;
      }
      .prev-og img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; }
      .prev-og-site { font-size: 0.58rem; text-transform: uppercase; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .prev-og-title { font-size: 0.72rem; font-weight: 600; color: var(--ps-ink, #f4f4ff); }
      .prev-actions { display: flex; gap: 18px; margin-top: 10px; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); font-size: 0.86rem; }

      @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

      @media (prefers-reduced-motion: reduce) {
        .acct-card:hover, .chip:hover, .btn-ai:hover, .btn-primary:hover { transform: none; }
        .social-wrap { animation: none; }
      }
    `,
  ],
})
export class AdminSocialComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly state = inject(AdminStateService);

  /** Guards the site-reactive load effect — see constructor + _ULTIMATE_CONVERGENCE.md §7. */
  private loadedSiteId: string | null = null;

  constructor() {
    // Site-reactive load: accounts + posts are site-scoped. On a deep-link the
    // selected site resolves AFTER mount, and there is NO data-refresh timer
    // here (the only setInterval is the per-OAuth popup poll), so an ngOnInit
    // one-shot would leave the panels empty forever. Fire on site resolve/switch.
    // (Reactivity class-bug — same fix as analytics/webhooks/recipes/pseo/mcp/forms.)
    effect(() => {
      const id = this.state.selectedSite()?.id ?? null;
      if (id !== this.loadedSiteId) {
        this.loadedSiteId = id;
        this.loadAccounts();
        this.loadPosts();
      }
    });
  }

  readonly platforms = PLATFORMS;
  readonly weekDayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ── Signals ── */
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly tab = signal<Tab>('compose');
  readonly accounts = signal<SocialAccount[]>([]);
  /** Set when the accounts load fails so connected platforms don't silently look "Not connected". */
  readonly accountsError = signal<boolean>(false);
  readonly posts = signal<SocialPost[]>([]);
  readonly analyticsCache = signal<Record<string, AnalyticsRow[]>>({});

  /* Composer state */
  readonly content = signal('');
  readonly selected = signal<PlatformId[]>([]);
  readonly perPlatform = signal<Partial<Record<PlatformId, string>>>({});
  readonly media = signal<MediaItem[]>([]);
  readonly hashtags = signal<string[]>([]);
  readonly link = signal('');
  readonly og = signal<OgData | null>(null);
  /** Hostname of the entered link (for the fallback card when OG data is absent). */
  readonly linkHost = computed(() => {
    const u = this.link().trim();
    if (!u) return '';
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
  });
  readonly scheduleAt = signal<string | null>(null);
  readonly scheduleTz = signal('America/Los_Angeles');
  readonly bestTimes = signal<string[]>([]);
  readonly editingId = signal<string | null>(null);
  /** Per-post in-flight publish lock — blocks a double-click from publishing twice
   *  to the user's real social accounts (no undo on a duplicate post). */
  readonly publishingIds = signal<Set<string>>(new Set());
  isPublishing(id: string): boolean {
    return this.publishingIds().has(id);
  }
  /** Post ids with an in-flight delete — guards the toast-armed destructive
   *  delete against a double-DELETE + drives the row's "Deleting…" state. */
  readonly deletingPostIds = signal<Set<string>>(new Set());
  isDeletingPost(id: string): boolean {
    return this.deletingPostIds().has(id);
  }
  /** Platform ids with an in-flight account disconnect — guards the toast-armed
   *  action against a double-DELETE + drives the row's "Disconnecting…" state. */
  readonly disconnectingPids = signal<Set<string>>(new Set());
  isDisconnectingAcct(pid: string): boolean {
    return this.disconnectingPids().has(pid);
  }

  /* Auto-Pilot */
  readonly autoPilotEnabled = signal(false);
  readonly autoPilotPrompt = signal('');
  readonly autoPilotCadenceHours = signal(24);
  readonly autoPilotTargetNetworks = signal<PlatformId[]>([]);
  readonly autoPilotDefaultPrompt = signal('');
  readonly autoPilotSaving = signal(false);
  readonly autoPilotDialogOpen = signal(false);
  readonly autoPilotPromptDraft = signal('');
  readonly autoPilotCadenceDraft = signal(24);
  readonly autoPilotNetworksDraft = signal<PlatformId[]>([]);
  readonly autoPilotPreviewNetwork = signal<PlatformId>('twitter');
  readonly autoPilotPreviewing = signal(false);
  readonly autoPilotPreviewText = signal('');
  readonly autoPilotPreviewMedia = signal('');

  /* Hashtag draft */
  hashtagDraft = '';

  /* AI assist */
  readonly aiLoading = signal(false);
  readonly aiVariants = signal<string[]>([]);
  readonly variantIdx = signal(0);
  aiTone: 'punchy' | 'warm' | 'authoritative' | 'playful' | 'story' = 'punchy';

  /* Mention picker */
  readonly mentionOpen = signal(false);
  readonly mentionResults = signal<{ handle: string; name?: string }[]>([]);
  readonly mentionIdx = signal(0);
  private mentionAnchor = -1;

  /* Drag/drop */
  readonly dragOver = signal(false);

  /* RSS */
  rssUrl = '';
  readonly rssItems = signal<{ title: string; url: string }[]>([]);
  readonly importingRss = signal(false);

  /* Calendar */
  readonly calCursor = signal(new Date());
  private dragPostId: string | null = null;

  @ViewChild('mainTa') private taRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') private fileInputRef?: ElementRef<HTMLInputElement>;

  /* ── Computed ── */
  readonly connectedCount = computed(() => this.accounts().filter((a) => a.connected).length);
  readonly draftsCount = computed(() => this.posts().filter((p) => p.status === 'draft').length);
  readonly scheduledCount = computed(() => this.posts().filter((p) => p.status === 'scheduled').length);
  readonly publishedCount = computed(
    () => this.posts().filter((p) => ['published', 'partial', 'failed'].includes(p.status)).length
  );
  readonly filteredPosts = computed(() => {
    const t = this.tab();
    const all = this.posts();
    if (t === 'drafts') return all.filter((p) => p.status === 'draft');
    if (t === 'queue') return all.filter((p) => p.status === 'scheduled').sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));
    if (t === 'sent') return all.filter((p) => ['published', 'partial', 'failed'].includes(p.status));
    return [];
  });

  readonly calLabel = computed(() => {
    const d = this.calCursor();
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  });
  readonly calCells = computed(() => {
    const cursor = this.calCursor();
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const cells: { iso: string; day: number; outOfMonth: boolean; today: boolean }[] = [];
    const today = new Date();
    const todayIso = isoDay(today);
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      const iso = isoDay(dt);
      cells.push({ iso, day: dt.getDate(), outOfMonth: dt.getMonth() !== m, today: iso === todayIso });
    }
    return cells;
  });

  /* ── Lifecycle ── */
  ngOnInit(): void {
    // Slash command `/social new` → focus composer
    this.route.queryParamMap.subscribe((q) => {
      if (q.get('action') === 'new') {
        this.tab.set('compose');
        queueMicrotask(() => this.taRef?.nativeElement?.focus());
      }
    });
    // Site-scoped loads (accounts + posts) are owned by the constructor effect
    // so a deep-link populates them when selectedSite() resolves. Auto-pilot
    // config is org-level (no site param) — load it once on mount.
    this.loadAutoPilotConfig();
  }

  /* ── Listener: cross-window OAuth callback ── */
  @HostListener('window:message', ['$event'])
  onWindowMessage(ev: MessageEvent): void {
    const data = ev.data as { type?: string; platform?: PlatformId; handle?: string };
    if (data?.type === 'social-oauth-success' && data.platform) {
      this.toast.success(`Connected ${this.defOf(data.platform)?.label}`);
      this.loadAccounts();
    }
    if (data?.type === 'social-oauth-error') {
      this.toast.error('Connection failed — try again.');
    }
  }

  /* ── Account methods ── */
  private siteId(): string | null {
    return this.state.selectedSite()?.id ?? null;
  }
  accountFor(pid: PlatformId): SocialAccount | undefined {
    return this.accounts().find((a) => a.platform === pid);
  }
  isConnected(pid: PlatformId): boolean {
    return !!this.accountFor(pid)?.connected;
  }
  defOf(pid: PlatformId | undefined): PlatformDef | undefined {
    return this.platforms.find((p) => p.id === pid);
  }

  /** Public retry for the inline accounts-load-error banner. */
  retryAccounts(): void { this.loadAccounts(); }

  private loadAccounts(): void {
    const sid = this.siteId();
    if (!sid) return;
    this.accountsError.set(false);
    // {silent} so the inline banner is the only signal (not a generic toast on
    // top) when connection states can't load.
    this.api.get<{ data: SocialAccount[] }>(`/social/accounts`, { site_id: sid }, { silent: true }).subscribe({
      next: (r) => { this.accounts.set(r.data ?? []); this.accountsError.set(false); },
      error: () => {
        // Keep the platforms list visible, but flag that the "Not connected"
        // badges may be stale so the operator doesn't reconnect a duplicate.
        this.accounts.set(this.platforms.map((p) => ({ platform: p.id, connected: false })));
        this.accountsError.set(true);
      },
    });
  }

  connect(pid: PlatformId): void {
    const sid = this.siteId();
    if (!sid) { this.toast.error('Pick a site first'); return; }
    // Paste-key platforms (no OAuth dance) — the worker's GET /connect returns a
    // paste_key spec (JSON), so opening a popup at it just shows raw JSON. Open
    // the paste-key form instead. OAuth platforms keep the popup flow below.
    if (this.defOf(pid)?.pasteKey) { this.openPaste(pid); return; }
    const url = `/api/social/${pid}/connect?site_id=${encodeURIComponent(sid)}`;
    const popup = window.open(url, 'social-oauth', 'width=620,height=720,popup=yes');
    if (!popup) {
      this.toast.error('Popup blocked — allow popups and try again');
      return;
    }
    const poll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(poll);
        this.loadAccounts();
      }
    }, 600);
  }

  // ── Paste-key connect (Bluesky / Mastodon / Telegram / Discord) ──────────
  readonly pasteOpen = signal<PlatformId | null>(null);
  readonly pasteSubmitting = signal(false);
  readonly pasteError = signal<string | null>(null);
  /** Per-platform form fields (only the relevant ones are shown/sent). */
  pasteF: { identifier: string; app_password: string; instance_url: string; access_token: string; chat_id: string; channel_id: string; display_name: string } =
    { identifier: '', app_password: '', instance_url: '', access_token: '', chat_id: '', channel_id: '', display_name: '' };

  openPaste(pid: PlatformId): void {
    this.pasteF = { identifier: '', app_password: '', instance_url: '', access_token: '', chat_id: '', channel_id: '', display_name: '' };
    this.pasteError.set(null);
    this.pasteOpen.set(pid);
  }
  closePaste(): void { this.pasteOpen.set(null); }

  /** Build the worker's per-platform paste body ({@link PasteSchema}); null if invalid/unsupported. */
  private pasteBody(pid: PlatformId): Record<string, unknown> | null {
    const f = this.pasteF;
    switch (pid) {
      case 'bluesky':
        return f.identifier.trim() && f.app_password.trim() ? { kind: 'bluesky', identifier: f.identifier.trim(), app_password: f.app_password.trim() } : null;
      case 'mastodon':
        // instance_url is FETCHED/authenticated against server-side → require a
        // real public https URL (rejects http://, localhost, single-label + internal
        // hosts) via the shared isValidHttpsUrl guard, NOT a permissive http?-regex
        // (SSRF-adjacent). See [[server-fetched-url-validation-sweep]].
        return this.isValidHttpsUrl(f.instance_url.trim()) && f.access_token.trim().length >= 20 ? { kind: 'mastodon', instance_url: f.instance_url.trim(), access_token: f.access_token.trim() } : null;
      case 'telegram':
        return f.chat_id.trim() ? { kind: 'telegram', chat_id: f.chat_id.trim(), ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) } : null;
      case 'discord':
        return f.channel_id.trim().length >= 5 ? { kind: 'discord', channel_id: f.channel_id.trim(), ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) } : null;
      default:
        return null;
    }
  }

  submitPasteConnect(): void {
    const pid = this.pasteOpen();
    if (!pid || this.pasteSubmitting()) return;
    const body = this.pasteBody(pid);
    if (!body) { this.pasteError.set('Fill in the required fields above.'); return; }
    this.pasteSubmitting.set(true);
    this.pasteError.set(null);
    // {silent}: this inline form surfaces its own error in the dialog.
    this.api.post(`/social/${pid}/paste`, body, { silent: true }).subscribe({
      next: () => {
        this.pasteSubmitting.set(false);
        this.toast.success(`Connected ${this.defOf(pid)?.label}`);
        this.closePaste();
        this.loadAccounts();
      },
      error: (err: { error?: { error?: { message?: string } } }) => {
        this.pasteSubmitting.set(false);
        this.pasteError.set(err?.error?.error?.message ?? `Couldn't connect ${this.defOf(pid)?.label} — check the values and retry.`);
      },
    });
  }

  disconnect(pid: PlatformId): void {
    const sid = this.siteId();
    if (!sid) return;
    // The worker disconnects by account UUID (DELETE /social/accounts/:id), not
    // by platform — resolve the connected account for this platform first.
    const acct = this.accounts().find((a) => a.platform === pid && a.connected);
    if (!acct?.id) {
      this.toast.error(`No connected ${this.defOf(pid)?.label} account to disconnect.`);
      return;
    }
    // Destructive — re-OAuth required to restore. Confirm via the action-armed toast.
    this.toast.warning(`Disconnect ${this.defOf(pid)?.label}? You’ll need to reconnect via OAuth to use it again.`, {
      action: { label: 'Disconnect', run: () => this.performDisconnect(pid, acct.id as string) },
      duration: 7000,
    });
  }
  private performDisconnect(pid: PlatformId, acctId: string): void {
    if (this.disconnectingPids().has(pid)) return; // re-armed toast action while in flight = no-op
    this.disconnectingPids.update((s) => new Set(s).add(pid));
    const done = () => this.disconnectingPids.update((s) => { const n = new Set(s); n.delete(pid); return n; });
    this.api.delete(`/social/accounts/${acctId}`, { silent: true }).subscribe({
      next: () => {
        done();
        this.toast.success(`Disconnected ${this.defOf(pid)?.label}`);
        this.loadAccounts();
        this.selected.update((s) => s.filter((id) => id !== pid));
      },
      error: () => { done(); this.toast.error('Disconnect failed'); },
    });
  }

  /* ── Auto-Pilot ── */

  /**
   * Hydrate auto-pilot signals from the worker. Silent on failure — the
   * controls render in their "off" default state, which is the safest UX
   * for a setting the user can always re-toggle.
   */
  private loadAutoPilotConfig(): void {
    this.api.get<{ data: {
      enabled: boolean;
      prompt: string;
      cadence_hours: number;
      target_networks: PlatformId[];
      default_prompt: string;
    } }>('/social/auto-pilot/config').subscribe({
      next: (r) => {
        const d = r?.data;
        if (!d) return;
        this.autoPilotEnabled.set(!!d.enabled);
        this.autoPilotPrompt.set(d.prompt ?? '');
        this.autoPilotCadenceHours.set(d.cadence_hours ?? 24);
        this.autoPilotTargetNetworks.set(d.target_networks ?? []);
        this.autoPilotDefaultPrompt.set(d.default_prompt ?? '');
      },
      error: () => {
        // Backend may not have shipped yet — defaults keep the toggle usable
      },
    });
  }

  /** Persist toggle change immediately (header checkbox UX). */
  setAutoPilot(enabled: boolean): void {
    this.autoPilotSaving.set(true);
    const previous = this.autoPilotEnabled();
    this.autoPilotEnabled.set(enabled);
    this.api
      .post<{ data: { enabled: boolean; cadence_hours: number; target_networks: PlatformId[] } }>(
        '/social/auto-pilot/config',
        { enabled },
      )
      .subscribe({
        next: (r) => {
          if (r?.data) {
            this.autoPilotEnabled.set(!!r.data.enabled);
            this.autoPilotCadenceHours.set(r.data.cadence_hours);
            this.autoPilotTargetNetworks.set(r.data.target_networks);
          }
          this.autoPilotSaving.set(false);
          this.toast.success(enabled ? 'Auto-Pilot on — drafts will appear in the Drafts tab.' : 'Auto-Pilot off.');
        },
        error: () => {
          this.autoPilotEnabled.set(previous);
          this.autoPilotSaving.set(false);
          this.toast.error('Auto-Pilot toggle failed');
        },
      });
  }

  /** Open the prompt-editor dialog, copying current settings into draft signals. */
  openAutoPilotPrompt(): void {
    this.autoPilotPromptDraft.set(this.autoPilotPrompt() || this.autoPilotDefaultPrompt());
    this.autoPilotCadenceDraft.set(this.autoPilotCadenceHours());
    this.autoPilotNetworksDraft.set([...this.autoPilotTargetNetworks()]);
    if (this.autoPilotTargetNetworks().length > 0) {
      this.autoPilotPreviewNetwork.set(this.autoPilotTargetNetworks()[0]);
    }
    this.autoPilotPreviewText.set('');
    this.autoPilotPreviewMedia.set('');
    this.autoPilotDialogOpen.set(true);
  }

  closeAutoPilotDialog(): void {
    this.autoPilotDialogOpen.set(false);
  }

  resetAutoPilotPromptToDefault(): void {
    this.autoPilotPromptDraft.set(this.autoPilotDefaultPrompt());
  }

  toggleAutoPilotNetwork(pid: PlatformId): void {
    this.autoPilotNetworksDraft.update((nets) =>
      nets.includes(pid) ? nets.filter((n) => n !== pid) : [...nets, pid],
    );
    if (!this.autoPilotNetworksDraft().includes(this.autoPilotPreviewNetwork())) {
      const first = this.autoPilotNetworksDraft()[0];
      if (first) this.autoPilotPreviewNetwork.set(first);
    }
  }

  previewAutoPilotPost(): void {
    if (this.autoPilotPreviewing()) return;
    this.autoPilotPreviewing.set(true);
    this.autoPilotPreviewText.set('');
    this.autoPilotPreviewMedia.set('');
    this.api
      .post<{ data: { text: string; mediaSuggestion?: string } }>('/social/auto-pilot/preview', {
        network: this.autoPilotPreviewNetwork(),
        prompt: this.autoPilotPromptDraft(),
      })
      .subscribe({
        next: (r) => {
          this.autoPilotPreviewText.set(r?.data?.text ?? '');
          this.autoPilotPreviewMedia.set(r?.data?.mediaSuggestion ?? '');
          this.autoPilotPreviewing.set(false);
        },
        error: () => {
          this.autoPilotPreviewing.set(false);
          this.toast.error('Preview failed — check that an AI provider is configured.');
        },
      });
  }

  saveAutoPilotConfig(): void {
    if (this.autoPilotSaving()) return;
    this.autoPilotSaving.set(true);
    this.api
      .post<{ data: {
        enabled: boolean;
        prompt: string;
        cadence_hours: number;
        target_networks: PlatformId[];
      } }>('/social/auto-pilot/config', {
        prompt: this.autoPilotPromptDraft(),
        cadence_hours: this.autoPilotCadenceDraft(),
        target_networks: this.autoPilotNetworksDraft(),
      })
      .subscribe({
        next: (r) => {
          const d = r?.data;
          if (d) {
            this.autoPilotPrompt.set(d.prompt);
            this.autoPilotCadenceHours.set(d.cadence_hours);
            this.autoPilotTargetNetworks.set(d.target_networks);
          }
          this.autoPilotSaving.set(false);
          this.autoPilotDialogOpen.set(false);
          this.toast.success('Auto-Pilot prompt saved.');
        },
        error: () => {
          this.autoPilotSaving.set(false);
          this.toast.error('Save failed');
        },
      });
  }

  /* ── Composer state ── */
  isPlatformSelected(pid: PlatformId): boolean {
    return this.selected().includes(pid);
  }
  hasOverride(pid: PlatformId): boolean {
    return Object.prototype.hasOwnProperty.call(this.perPlatform(), pid);
  }
  togglePlatform(pid: PlatformId): void {
    if (!this.isConnected(pid)) return;
    if (this.isPlatformSelected(pid)) {
      // 2nd click → toggle override
      if (this.hasOverride(pid)) {
        this.removeOverride(pid);
      } else {
        this.setOverride(pid, this.content());
      }
    } else {
      this.selected.update((s) => [...s, pid]);
      this.refreshBestTimes();
    }
  }
  removePlatform(pid: PlatformId): void {
    this.selected.update((s) => s.filter((id) => id !== pid));
    this.removeOverride(pid);
    this.refreshBestTimes();
  }
  setOverride(pid: PlatformId, text: string): void {
    this.perPlatform.update((m) => ({ ...m, [pid]: text }));
  }
  removeOverride(pid: PlatformId): void {
    this.perPlatform.update((m) => {
      const { [pid]: _drop, ...rest } = m;
      return rest;
    });
  }
  charsFor(pid: PlatformId): number {
    return (this.perPlatform()[pid] ?? this.content()).length;
  }

  onContentChange(v: string): void {
    this.content.set(v);
    this.checkMentionTrigger();
  }
  onContentKeydown(ev: KeyboardEvent): void {
    if (this.mentionOpen()) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); this.mentionIdx.update((i) => Math.min(this.mentionResults().length - 1, i + 1)); }
      if (ev.key === 'ArrowUp')   { ev.preventDefault(); this.mentionIdx.update((i) => Math.max(0, i - 1)); }
      if (ev.key === 'Escape')    { this.mentionOpen.set(false); }
      if (ev.key === 'Enter' && this.mentionResults().length > 0) {
        ev.preventDefault();
        this.insertMention(this.mentionResults()[this.mentionIdx()], ev);
      }
    }
    // Cmd+Enter = publish
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && this.canPublish()) {
      ev.preventDefault();
      this.publish();
    }
  }

  private checkMentionTrigger(): void {
    const ta = this.taRef?.nativeElement;
    if (!ta) return;
    const caret = ta.selectionStart ?? 0;
    const slice = this.content().slice(0, caret);
    const m = slice.match(/@([\w]{0,20})$/);
    if (!m) { this.mentionOpen.set(false); return; }
    this.mentionAnchor = caret - m[0].length;
    const q = m[1];
    const sel = this.selected()[0];
    if (!sel) return;
    this.api
      .get<{ items: { handle: string; name?: string }[] }>(`/social/mentions`, { platform: sel, q })
      .subscribe({
        next: (r) => {
          this.mentionResults.set(r.items ?? []);
          this.mentionIdx.set(0);
          this.mentionOpen.set((r.items ?? []).length > 0);
        },
        error: () => this.mentionOpen.set(false),
      });
  }

  insertMention(m: { handle: string }, ev: Event): void {
    ev.preventDefault();
    const ta = this.taRef?.nativeElement;
    if (!ta) return;
    const before = this.content().slice(0, this.mentionAnchor);
    const after = this.content().slice(ta.selectionStart ?? this.mentionAnchor);
    const next = `${before}@${m.handle} ${after}`;
    this.content.set(next);
    this.mentionOpen.set(false);
    queueMicrotask(() => {
      ta.focus();
      const pos = before.length + m.handle.length + 2;
      ta.setSelectionRange(pos, pos);
    });
  }

  /* ── Hashtags ── */
  onHashtagKeydown(ev: KeyboardEvent): void {
    if (ev.key === ' ' || ev.key === ',' || ev.key === 'Enter') {
      ev.preventDefault();
      this.commitHashtag();
    } else if (ev.key === 'Backspace' && !this.hashtagDraft && this.hashtags().length > 0) {
      this.hashtags.update((t) => t.slice(0, -1));
    }
  }
  private commitHashtag(): void {
    const raw = this.hashtagDraft.trim().replace(/^#/, '');
    if (!raw) return;
    if (this.hashtags().length >= 30) {
      this.toast.warning('Max 30 hashtags');
      return;
    }
    if (!this.hashtags().includes(raw)) {
      this.hashtags.update((t) => [...t, raw]);
    }
    this.hashtagDraft = '';
  }
  removeHashtag(i: number): void {
    this.hashtags.update((t) => t.filter((_, ix) => ix !== i));
  }

  /* ── Media ── */
  onDragOver(ev: DragEvent): void { ev.preventDefault(); this.dragOver.set(true); }
  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (files.length) this.uploadFiles(files);
  }
  onFiles(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.uploadFiles(files);
    input.value = '';
  }
  private uploadFiles(files: File[]): void {
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      const sid = this.siteId();
      if (sid) fd.append('site_id', sid);
      this.api.postFormData<{ media: MediaItem }>('/social/media', fd).subscribe({
        next: (r: { media: MediaItem }) => {
          this.media.update((m) => [...m, r.media]);
        },
        error: () => {
          // Optimistic local preview fallback when backend not yet wired
          const url = URL.createObjectURL(f);
          this.media.update((m) => [
            ...m,
            {
              id: `local-${Date.now()}-${Math.random()}`,
              url,
              thumb_url: url,
              alt: '',
              bytes: f.size,
              type: f.type.startsWith('video/') ? 'video' : 'image',
            },
          ]);
          console.warn('[social] media upload backend missing, local preview only');
        },
      });
    }
  }
  updateAlt(id: string, alt: string): void {
    this.media.update((m) => m.map((x) => (x.id === id ? { ...x, alt } : x)));
  }
  removeMedia(id: string): void {
    this.media.update((m) => m.filter((x) => x.id !== id));
  }

  /* ── OG fetch ── */
  fetchOg(): void {
    const u = this.link().trim();
    if (!u) { this.og.set(null); return; }
    this.api.post<{ og: OgData }>('/social/og-preview', { url: u }, { silent: true }).subscribe({
      next: (r) => this.og.set(r.og),
      error: () => this.og.set(null),
    });
  }

  /* ── AI assist ── */
  generate(): void {
    if (this.selected().length === 0) {
      this.toast.warning('Select at least one platform first');
      return;
    }
    this.aiLoading.set(true);
    this.api
      .post<{ variants: string[] }>('/social/generate', {
        topic: this.content() || 'a tasteful update from our team',
        platforms: this.selected(),
        tone: this.aiTone,
      })
      .subscribe({
        next: (r) => {
          this.aiVariants.set(r.variants ?? []);
          this.variantIdx.set(0);
          this.aiLoading.set(false);
        },
        error: () => {
          this.aiLoading.set(false);
          this.toast.error('AI assist unavailable right now');
        },
      });
  }
  prevVariant(): void { this.variantIdx.update((i) => Math.max(0, i - 1)); }
  nextVariant(): void { this.variantIdx.update((i) => Math.min(this.aiVariants().length - 1, i + 1)); }
  useVariant(): void {
    const v = this.aiVariants()[this.variantIdx()];
    if (v) this.content.set(v);
  }

  /* ── Scheduling ── */
  openScheduler(): void {
    if (!this.scheduleAt()) {
      const d = new Date();
      d.setHours(d.getHours() + 1, 0, 0, 0);
      this.scheduleAt.set(toDatetimeLocal(d));
    }
  }
  private refreshBestTimes(): void {
    const plats = this.selected();
    if (plats.length === 0) { this.bestTimes.set([]); return; }
    this.api
      .get<{ times: string[] }>('/social/best-times', { platforms: plats.join(',') })
      .subscribe({
        next: (r) => this.bestTimes.set(r.times ?? []),
        error: () => this.bestTimes.set([]),
      });
  }
  applyBestTime(label: string): void {
    // label like "Tue 9am" — pick the next matching slot
    const m = label.match(/^(\w{3})\s+(\d{1,2})(am|pm)/i);
    if (!m) return;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(m[1]);
    const hour = (parseInt(m[2], 10) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    const next = new Date();
    while (next.getDay() !== wd || next < new Date()) next.setDate(next.getDate() + 1);
    next.setHours(hour, 0, 0, 0);
    this.scheduleAt.set(toDatetimeLocal(next));
  }

  /* ── Status line helpers ── */
  mediaSummary(): string {
    const items = this.media();
    if (items.length === 0) return 'no media';
    const kb = Math.round(items.reduce((s, m) => s + (m.bytes || 0), 0) / 1024);
    return `${items.length} media · ${kb} KB`;
  }
  scheduleSummary(): string {
    const at = this.scheduleAt();
    if (!at) return 'posting now';
    try {
      return `scheduled for ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} ${this.scheduleTz()}`;
    } catch { return 'scheduled'; }
  }
  canPublish(): boolean {
    if (!this.content().trim() && this.media().length === 0) return false;
    if (this.selected().length === 0) return false;
    // Char-limit enforcement per selected platform
    for (const pid of this.selected()) {
      const def = this.defOf(pid);
      if (def && this.charsFor(pid) > def.charLimit) return false;
    }
    return true;
  }

  /**
   * Human reason the Publish button is disabled, or `null` when ready. Surfaced
   * inline so a greyed-out Publish is explained — not a silent dead-end. Mirrors
   * the billing custom-amount + domains add-domain validation hints. Order is
   * UX-prioritised: pick a platform → add content → fix an over-limit platform.
   */
  publishBlockReason(): string | null {
    if (this.selected().length === 0) return 'Select at least one platform to publish.';
    if (!this.content().trim() && this.media().length === 0) return 'Write a message or attach media first.';
    for (const pid of this.selected()) {
      const def = this.defOf(pid);
      if (def && this.charsFor(pid) > def.charLimit) {
        return `${def.label} is ${this.charsFor(pid) - def.charLimit} character${this.charsFor(pid) - def.charLimit === 1 ? '' : 's'} over its ${def.charLimit.toLocaleString()} limit.`;
      }
    }
    return null;
  }

  /* ── Posts ── */
  loadPosts(filter?: PostStatus): void {
    const sid = this.siteId();
    if (!sid) return;
    this.loading.set(true);
    const params: Record<string, string> = { site_id: sid };
    if (filter) params['status'] = filter;
    this.api.get<{ data: SocialPost[] }>('/social/posts', params).subscribe({
      next: (r) => { this.posts.set(r.data ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  /** Selected platforms → their connected account UUIDs (the worker keys posts by account, not platform). */
  private accountIdsForSelected(): string[] {
    const sel = new Set(this.selected());
    return this.accounts()
      .filter((a) => a.connected && !!a.id && sel.has(a.platform))
      .map((a) => a.id as string);
  }

  /** Build the worker `CreatePostSchema` payload (also valid for PATCH = .partial()). */
  private buildCreatePayload(): Record<string, unknown> {
    const overrides: Record<string, { content: string }> = {};
    for (const [plat, txt] of Object.entries(this.perPlatform())) {
      if (txt && txt.trim()) overrides[plat] = { content: txt };
    }
    const ids = this.accountIdsForSelected();
    const payload: Record<string, unknown> = {
      site_id: this.siteId()!,
      content: this.content(),
    };
    if (ids.length) payload['account_ids'] = ids;
    if (Object.keys(overrides).length) payload['per_platform_overrides'] = overrides;
    if (this.hashtags().length) payload['hashtags'] = this.hashtags();
    if (this.link()) payload['link'] = this.link();
    if (this.scheduleAt()) payload['schedule_at'] = this.scheduleAt();
    return payload;
  }

  saveDraft(): void {
    if (!this.siteId()) { this.toast.error('Pick a site first'); return; }
    const id = this.editingId();
    const payload = this.buildCreatePayload();
    // POST (new) requires ≥1 account; PATCH (edit) may omit.
    if (!id && !(payload['account_ids'] as string[] | undefined)?.length) {
      this.toast.error('Connect an account for the selected platform(s) first.');
      return;
    }
    this.saving.set(true);
    const req = id
      ? this.api.patch<{ data: { id: string } }>(`/social/posts/${id}`, payload, { silent: true })
      : this.api.post<{ data: { id: string } }>('/social/posts', payload, { silent: true });
    req.subscribe({
      next: () => { this.saving.set(false); this.toast.success('Draft saved'); this.resetComposer(); this.loadPosts(); },
      error: () => { this.saving.set(false); this.toast.error('Save failed'); },
    });
  }

  publish(): void {
    if (!this.canPublish()) return;
    const payload = this.buildCreatePayload();
    if (!(payload['account_ids'] as string[] | undefined)?.length) {
      this.toast.error('Connect an account for the selected platform(s) first.');
      return;
    }
    const scheduled = !!this.scheduleAt();
    this.saving.set(true);
    // Create the post, then trigger it (worker create doesn't auto-send;
    // immediate posts call publish-now, scheduled posts keep their schedule_at).
    this.api.post<{ data: { id: string } }>('/social/posts', payload, { silent: true }).subscribe({
      next: (r) => {
        const id = r.data?.id;
        if (id && !scheduled) {
          this.api.post(`/social/posts/${id}/publish-now`, {}, { silent: true }).subscribe({
            next: () => { this.saving.set(false); this.toast.success(`Posting to ${this.selected().length} platform${this.selected().length === 1 ? '' : 's'}…`); this.resetComposer(); this.loadPosts(); },
            error: () => { this.saving.set(false); this.toast.error('Created the post but publishing failed — see Drafts.'); this.resetComposer(); this.loadPosts(); },
          });
        } else {
          this.saving.set(false);
          this.toast.success(scheduled ? 'Post scheduled' : 'Draft created');
          this.resetComposer();
          this.loadPosts();
        }
      },
      error: () => { this.saving.set(false); this.toast.error('Publish failed'); },
    });
  }

  publishNow(post: SocialPost): void {
    if (this.publishingIds().has(post.id)) return; // guard double-submit → no duplicate publish
    this.publishingIds.update((s) => new Set(s).add(post.id));
    const release = () =>
      this.publishingIds.update((s) => {
        const n = new Set(s);
        n.delete(post.id);
        return n;
      });
    this.api.post(`/social/posts/${post.id}/publish-now`, {}, { silent: true }).subscribe({
      next: () => { release(); this.toast.success('Publishing…'); this.loadPosts(); },
      error: () => { release(); this.toast.error('Publish failed'); },
    });
  }
  editPost(post: SocialPost): void {
    this.editingId.set(post.id);
    this.content.set(post.content);
    this.selected.set([...post.platforms]);
    this.perPlatform.set({ ...(post.per_platform_content ?? {}) });
    this.media.set([...post.media]);
    this.hashtags.set([...post.hashtags]);
    this.link.set(post.link ?? '');
    this.og.set(post.og ?? null);
    this.scheduleAt.set(post.scheduled_at ?? null);
    this.tab.set('compose');
  }
  deletePost(post: SocialPost): void {
    // Destructive (deletes a draft / cancels a user-scheduled queued post) with no
    // undo — confirm first via the file's action-armed toast pattern.
    this.toast.warning('Delete this post? This can’t be undone.', {
      action: { label: 'Delete', run: () => this.performDeletePost(post) },
      duration: 7000,
    });
  }
  private performDeletePost(post: SocialPost): void {
    if (this.deletingPostIds().has(post.id)) return; // re-armed toast action while in flight = no-op
    this.deletingPostIds.update((s) => new Set(s).add(post.id));
    const done = () => this.deletingPostIds.update((s) => { const n = new Set(s); n.delete(post.id); return n; });
    this.api.delete(`/social/posts/${post.id}`, { silent: true }).subscribe({
      next: () => { done(); this.toast.success('Deleted'); this.loadPosts(); },
      error: () => { done(); this.toast.error('Delete failed'); },
    });
  }
  duplicatePost(post: SocialPost): void {
    this.editingId.set(null);
    this.content.set(post.content);
    this.selected.set([...post.platforms]);
    this.media.set([...post.media]);
    this.hashtags.set([...post.hashtags]);
    this.tab.set('compose');
    this.toast.info('Duplicated as new draft');
  }
  discard(): void {
    if (!this.content().trim() && this.media().length === 0) return this.resetComposer();
    // Action-armed toast (cockpit pattern) — non-blocking, consistent with the
    // rest of admin; replaces the native confirm() z-stack/focus break.
    this.toast.warning('Discard this post? Your draft will be cleared.', {
      action: { label: 'Discard', run: () => this.resetComposer() },
      duration: 7000,
    });
  }
  private resetComposer(): void {
    this.editingId.set(null);
    this.content.set('');
    this.perPlatform.set({});
    this.media.set([]);
    this.hashtags.set([]);
    this.hashtagDraft = '';
    this.link.set('');
    this.og.set(null);
    this.scheduleAt.set(null);
    this.aiVariants.set([]);
    this.variantIdx.set(0);
  }

  /* ── Analytics ── */
  analyticsFor(postId: string): AnalyticsRow[] {
    const cached = this.analyticsCache()[postId];
    if (cached) return cached;
    // Lazily fetch + cache
    this.api.get<{ data: { per_platform: AnalyticsRow[] } }>(`/social/posts/${postId}/analytics`).subscribe({
      next: (r) => this.analyticsCache.update((m) => ({ ...m, [postId]: r.data?.per_platform ?? [] })),
      error: () => this.analyticsCache.update((m) => ({ ...m, [postId]: [] })),
    });
    return [];
  }

  /* ── RSS ── */
  /**
   * The RSS feed URL is fetched server-side (SSRF-adjacent), so accept only a
   * well-formed https URL with a dotted public hostname — rejecting http://,
   * junk, and bare internal hosts before the import call.
   */
  private isValidHttpsUrl(raw: string): boolean {
    if (!raw) return false;
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && u.hostname.includes('.') && !u.hostname.endsWith('.');
    } catch {
      return false;
    }
  }
  /** Button gate: the typed RSS URL is a valid https feed URL. */
  rssUrlValid(): boolean {
    return this.isValidHttpsUrl(this.rssUrl.trim());
  }
  /** Inline-hint gate: a non-empty value that fails validation. */
  rssUrlInvalid(): boolean {
    const v = this.rssUrl.trim();
    return v.length > 0 && !this.isValidHttpsUrl(v);
  }
  /** Mastodon paste: inline-hint gate — a non-empty instance URL that isn't a valid public https URL. */
  mastoUrlInvalid(): boolean {
    const v = this.pasteF.instance_url.trim();
    return v.length > 0 && !this.isValidHttpsUrl(v);
  }

  rssPreview(): void {
    const url = this.rssUrl.trim();
    if (!this.isValidHttpsUrl(url)) {
      this.toast.error('Enter a valid https:// feed URL (e.g. https://example.com/feed.xml).');
      return;
    }
    this.api.post<{ items: { title: string; url: string }[] }>('/social/import-rss', {
      url,
      preview: true,
    }, { silent: true }).subscribe({
      next: (r) => this.rssItems.set((r.items ?? []).slice(0, 10)),
      error: () => this.toast.error('Could not parse feed'),
    });
  }
  /**
   * Copy the previewed feed items to the clipboard as `Title — URL` lines, ready
   * to paste into the composer. A real, working interim while auto-scheduling
   * (which needs the worker schedule path) is built — replaces a button that
   * previously 501'd with a misleading "RSS import failed" toast.
   */
  async copyRssLinks(): Promise<void> {
    const items = this.rssItems();
    if (items.length === 0) return;
    const text = items.map((it) => `${it.title} — ${it.url}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(`Copied ${items.length} link${items.length === 1 ? '' : 's'} — paste into your post.`);
    } catch {
      this.toast.error('Could not copy — select the links manually.');
    }
  }

  /** Import the previewed feed items as draft posts (assign accounts + schedule in the composer). */
  importRssDrafts(): void {
    if (this.rssItems().length === 0 || this.importingRss()) return;
    const url = this.rssUrl.trim();
    if (!this.isValidHttpsUrl(url)) {
      this.toast.error('Enter a valid https:// feed URL before importing.');
      return;
    }
    this.importingRss.set(true);
    this.api.post<{ ok: boolean; created: number }>('/social/import-rss', { url, site_id: this.siteId() ?? undefined }, { silent: true }).subscribe({
      next: (r) => {
        this.importingRss.set(false);
        this.toast.success(`Imported ${r.created} draft${r.created === 1 ? '' : 's'} — find them in Drafts.`);
        this.rssItems.set([]);
        this.rssUrl = '';
        this.loadPosts();
      },
      error: (err: unknown) => {
        this.importingRss.set(false);
        const msg = (err as { error?: { error?: { message?: string } } })?.error?.error?.message ?? 'Could not import the feed.';
        this.toast.error(msg);
      },
    });
  }

  /* ── Calendar ── */
  calPrev(): void {
    const d = new Date(this.calCursor());
    d.setMonth(d.getMonth() - 1);
    this.calCursor.set(d);
  }
  calNext(): void {
    const d = new Date(this.calCursor());
    d.setMonth(d.getMonth() + 1);
    this.calCursor.set(d);
  }
  calToday(): void { this.calCursor.set(new Date()); }

  postsOnDay(iso: string): SocialPost[] {
    return this.posts().filter((p) => {
      const at = p.scheduled_at || p.published_at;
      return at && isoDay(new Date(at)) === iso;
    });
  }
  onCalEventDrag(ev: DragEvent, post: SocialPost): void {
    this.dragPostId = post.id;
    ev.dataTransfer?.setData('text/plain', post.id);
  }
  onCalDragOver(ev: DragEvent): void { ev.preventDefault(); }
  onCalDrop(ev: DragEvent, iso: string): void {
    ev.preventDefault();
    const id = this.dragPostId ?? ev.dataTransfer?.getData('text/plain');
    if (!id) return;
    const post = this.posts().find((p) => p.id === id);
    if (!post || !post.scheduled_at) return;
    const old = new Date(post.scheduled_at);
    const nextDay = new Date(iso + 'T00:00:00');
    nextDay.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const newAt = nextDay.toISOString();
    this.api.patch(`/social/posts/${id}`, { scheduled_at: newAt }, { silent: true }).subscribe({
      next: () => { this.toast.success('Rescheduled'); this.loadPosts(); },
      error: () => this.toast.error('Reschedule failed'),
    });
    this.dragPostId = null;
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Pure helpers                                                        */
/* ──────────────────────────────────────────────────────────────────── */

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDatetimeLocal(d: Date): string {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
