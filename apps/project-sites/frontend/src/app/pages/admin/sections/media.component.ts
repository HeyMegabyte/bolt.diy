/**
 * AdminMediaComponent — /admin/media
 *
 * @remarks
 * Five-tab media workspace: Library, Stock Search, Image Studio, Video Studio,
 * Podcast Studio. Tab state persists to `localStorage['media.tab']`. Search +
 * filter are signal-driven and debounced (300ms) for the Library tab.
 *
 * Backend contract (sibling agent owns the endpoints, see CLAUDE.md):
 *   GET    /api/media/assets?kind=&q=&limit=     → { data: MediaAsset[] }
 *   GET    /api/media/assets/:id/raw             → binary stream
 *   POST   /api/media/upload                     → multipart FormData (field: file)
 *   DELETE /api/media/assets/:id                 → { ok: true }
 *   POST   /api/media/stock/search               → { data: StockCandidate[] }
 *   POST   /api/media/stock/save                 → { data: MediaAsset }
 *   POST   /api/media/generate/image             → { data: MediaAsset[] }
 *   POST   /api/media/generate/video             → { data: MediaAsset (queued) }
 *   POST   /api/media/generate/podcast           → { data: MediaAsset }
 *   POST   /api/media/send-to-bolt               → { ok: true }
 *
 * The bolt.diy iframe is owned by `BoltEmbedService` (admin shell). This
 * component sends a `PS_MEDIA_ATTACH` postMessage to it AND fires the
 * backend `/api/media/send-to-bolt` so the editor's WebContainer can fetch
 * the file from R2 even if the iframe is cold-booting.
 *
 * @example
 * ```html
 * <app-admin-media />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  ViewChild,
  type AfterViewInit,
  type ElementRef,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HlmInputDirective, HlmSelectDirective, HlmTablistDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { ApiService } from '../../../services/api.service';
import { BoltEmbedService } from '../../../services/bolt-embed.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/** All asset kinds the backend tracks. */
type MediaKind = 'image' | 'video' | 'audio' | 'document';

/** Status reported by the backend for long-running generations (video, podcast). */
type MediaStatus = 'ready' | 'queued' | 'generating' | 'error';

/** Source provenance — which integration produced the asset. */
type MediaSource =
  | 'upload'
  | 'unsplash'
  | 'pexels'
  | 'pexels-video'
  | 'pixabay'
  | 'google-images'
  | 'foursquare'
  | 'yelp'
  | 'dalle'
  | 'sora'
  | 'veo'
  | 'elevenlabs'
  | 'openai-tts';

/** One row from `GET /api/media/assets`. */
interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size_bytes?: number;
  url?: string;
  thumb_url?: string;
  source: MediaSource;
  attribution?: string;
  duration_s?: number;
  width?: number;
  height?: number;
  status: MediaStatus;
  created_at: string;
}

/** Stock-search candidate returned from `POST /api/media/stock/search`. */
interface StockCandidate {
  source: MediaSource;
  thumb_url: string;
  preview_url: string;
  full_url: string;
  width?: number;
  height?: number;
  attribution?: string;
  external_id?: string;
  kind: MediaKind;
}

/** Stock-source toggle entry rendered as a pill in the Stock Search tab. */
interface StockSourceOption {
  id: MediaSource;
  label: string;
  enabled: boolean;
}

/** Tabs rendered in the section header. */
type MediaTab = 'library' | 'stock' | 'image' | 'video' | 'podcast';

/** One podcast script segment authored in the Podcast Studio tab. */
interface PodcastSegment {
  voice: string;
  text: string;
}

/** Bolt postMessage envelope for media attachment. */
interface BoltMediaAttachMessage {
  type: 'PS_MEDIA_ATTACH';
  url: string;
  name: string;
  mime: string;
}

@Component({
  selector: 'app-admin-media',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    HlmInputDirective,
    HlmSelectDirective,
    HlmTablistDirective,
    RevealDirective,
    RollingCounterComponent,
  ],
  template: `
    <section class="space-y-5" [class.media--compact]="compact()" appReveal>
      <!-- ───────────────────────────────── Header ──────────────────────────────── -->
      <header class="med-header">
        <div class="med-header__title-row">
          <h1 class="med-title">Media</h1>
          <span class="count-chip" role="status" [attr.aria-label]="assetCountLabel()">
            <app-rolling-counter [value]="assets().length" [duration]="900" aria-hidden="true" />
            <span aria-hidden="true">{{ assets().length === 1 ? 'asset' : 'assets' }}</span>
          </span>
        </div>
        <div class="med-header__actions">
          <!-- Search / kind-filter / Upload are Library-tab controls; the Studio
               + Stock tabs have their own actions, so gate these to Library. -->
          @if (activeTab() === 'library') {
          <label class="med-search">
            <span class="sr-only">Search media</span>
            <svg class="med-search__icon" aria-hidden="true" width="14" height="14"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              hlmInput class="input-field--search"
              [ngModel]="searchInput()"
              (ngModelChange)="searchInput.set($event)"
              placeholder="Search by name…"
              aria-label="Search media by name"
            />
          </label>
          <select
            hlmSelect
            [ngModel]="kindFilter()"
            (ngModelChange)="kindFilter.set($event); refreshLibrary()"
            aria-label="Filter by kind"
          >
            <option value="all">All kinds</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="document">Documents</option>
          </select>
          <button
            type="button"
            class="btn-primary"
            (click)="openFilePicker()"
            aria-label="Upload files to Media library"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
          </button>
          }
          <input
            #fileInput
            type="file"
            multiple
            class="sr-only"
            (change)="onFilesPicked($event)"
            aria-hidden="true"
            tabindex="-1"
          />
        </div>
      </header>

      <!-- ───────────────────────────────── Tab strip ───────────────────────────── -->
      <!-- Sliding cyan active-tab indicator: a single absolutely-positioned pill
           translates + resizes to the active tab via CSS custom props, so the
           highlight glides instead of cutting. prefers-reduced-motion disables
           the transition (see styles). -->
      <nav
        class="med-tabs"
        role="tablist"
        hlmTablist
        aria-label="Media sub-sections"
        [style.--med-tab-count]="tabs.length"
        [style.--med-tab-active]="activeTabIndex()"
      >
        <span class="med-tab-indicator" aria-hidden="true"></span>
        @for (t of tabs; track t.id) {
          <button
            type="button"
            role="tab"
            class="med-tab"
            [id]="'med-tab-' + t.id"
            [class.is-active]="activeTab() === t.id"
            [attr.aria-selected]="activeTab() === t.id"
            [attr.aria-controls]="'med-panel-' + t.id"
            (click)="setTab(t.id)"
          >
            {{ t.label }}
          </button>
        }
      </nav>

      <!-- ───────────────────────────────── Panels ──────────────────────────────── -->
      @switch (activeTab()) {

        <!-- ═════ Library ═════ -->
        @case ('library') {
          <div id="med-panel-library" role="tabpanel" aria-labelledby="med-tab-library">
            <!-- Multi-select bulk-action bar hidden when embedded in the editor
                 overlay (single-asset workflow only). -->
            @if (selectedIds().size > 0 && !compact()) {
              <div class="bulk-bar" role="toolbar" aria-label="Bulk actions">
                <span class="bulk-count">{{ selectedIds().size }} selected</span>
                <button type="button" class="btn-ghost" (click)="sendSelectedToBolt()">
                  Send {{ selectedIds().size }} to Editor
                </button>
                <button type="button" class="btn-danger" (click)="deleteSelected()">
                  Delete {{ selectedIds().size }}
                </button>
                <button type="button" class="btn-ghost btn-ghost--quiet" (click)="clearSelection()">
                  Clear
                </button>
              </div>
            }

            @if (loadingLibrary() && assets().length === 0) {
              <div class="med-grid" aria-busy="true">
                @for (i of skeletonRows; track i) {
                  <div class="med-card skel"></div>
                }
              </div>
            } @else if (libraryError() && assets().length === 0) {
              <div class="med-empty" role="alert" data-testid="media-load-error">
                <div class="med-empty__glyph" aria-hidden="true">⚠</div>
                <h2 class="med-empty__title">Couldn't load your library</h2>
                <p class="med-empty__body">{{ libraryError() }}</p>
                <div class="med-empty__actions">
                  <button type="button" class="btn-primary" data-testid="media-retry" (click)="refreshLibrary()" [disabled]="loadingLibrary()">Retry</button>
                </div>
              </div>
            } @else if (filteredAssets().length === 0) {
              <div class="med-empty" role="status">
                <div class="med-empty__glyph" aria-hidden="true">✦</div>
                <h2 class="med-empty__title">No media yet</h2>
                <p class="med-empty__body">
                  Upload from your computer or browse stock sources to fill the library.
                </p>
                <div class="med-empty__actions">
                  <button type="button" class="btn-primary" (click)="openFilePicker()">Upload files</button>
                  <button type="button" class="btn-ghost" (click)="setTab('stock')">Browse stock</button>
                </div>
              </div>
            } @else {
              <div class="med-grid" role="list">
                @for (a of filteredAssets(); track a.id) {
                  <article class="med-card" role="listitem">
                    <label class="med-card__select" [attr.aria-label]="'Select ' + a.name">
                      <input
                        type="checkbox"
                        [checked]="selectedIds().has(a.id)"
                        (change)="toggleSelect(a.id, $event)"
                      />
                    </label>
                    <div class="med-thumb">
                      @switch (a.kind) {
                        @case ('image') {
                          <img
                            [src]="a.thumb_url || a.url || rawUrl(a)"
                            [alt]="a.name"
                            loading="lazy"
                            decoding="async"
                          />
                        }
                        @case ('video') {
                          <video
                            [src]="a.url || rawUrl(a)"
                            muted
                            preload="metadata"
                            playsinline
                            [attr.aria-label]="a.name"
                          ></video>
                          <span class="med-thumb__badge">▶</span>
                        }
                        @case ('audio') {
                          <div class="med-thumb__icon" aria-hidden="true">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="1.6"
                                 stroke-linecap="round" stroke-linejoin="round">
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </svg>
                          </div>
                          @if (a.duration_s) {
                            <span class="med-thumb__badge">{{ formatDuration(a.duration_s) }}</span>
                          }
                        }
                        @default {
                          <div class="med-thumb__icon" aria-hidden="true">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="1.6"
                                 stroke-linecap="round" stroke-linejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                          <span class="med-thumb__badge">{{ fileExt(a.name) }}</span>
                        }
                      }
                      @if (a.status === 'queued' || a.status === 'generating') {
                        <span class="med-thumb__status">
                          <span class="dot dot--pulse"></span>
                          {{ a.status === 'queued' ? 'Queued' : 'Generating…' }}
                        </span>
                      }
                      <div class="med-overlay">
                        <button type="button" class="btn-overlay" (click)="sendOneToBolt(a)"
                                aria-label="Send to Editor">
                          Send to Editor
                        </button>
                        <button type="button" class="btn-overlay btn-overlay--danger"
                                (click)="deleteOne(a)" [attr.aria-label]="'Delete ' + a.name">
                          Delete
                        </button>
                      </div>
                    </div>
                    <div class="med-meta">
                      <span class="med-meta__name" [title]="a.name">{{ a.name }}</span>
                      <div class="med-meta__chips">
                        <span class="chip chip--kind">{{ a.kind }}</span>
                        <span class="chip chip--source">{{ sourceLabel(a.source) }}</span>
                      </div>
                    </div>
                  </article>
                }
              </div>
            }
          </div>
        }

        <!-- ═════ Stock Search ═════ -->
        @case ('stock') {
          <div id="med-panel-stock" role="tabpanel" aria-labelledby="med-tab-stock" class="space-y-4">
            <div class="stock-toolbar">
              <label class="med-search med-search--lg">
                <span class="sr-only">Search stock libraries</span>
                <input
                  type="search"
                  hlmInput class="input-field--search"
                  [(ngModel)]="stockQuery"
                  (keydown.enter)="runStockSearch()"
                  placeholder="Try “coffee shop interior”, “mountain sunrise”, “team meeting”…"
                  aria-label="Stock search query"
                />
              </label>
              <button type="button" class="btn-primary" (click)="runStockSearch()"
                      [disabled]="stockLoading() || !stockQuery.trim()">
                {{ stockLoading() ? 'Searching…' : 'Search' }}
              </button>
            </div>
            <div class="stock-pills" role="group" aria-label="Stock sources">
              @for (s of stockSources(); track s.id) {
                <button
                  type="button"
                  class="pill"
                  [class.is-on]="s.enabled"
                  (click)="toggleStockSource(s.id)"
                  [attr.aria-pressed]="s.enabled"
                >
                  {{ s.label }}
                </button>
              }
            </div>

            @if (stockLoading()) {
              <div class="med-grid" aria-busy="true">
                @for (i of skeletonRows; track i) {
                  <div class="med-card skel"></div>
                }
              </div>
            } @else if (stockResults().length === 0) {
              <div class="med-empty" role="status">
                <div class="med-empty__glyph" aria-hidden="true">🔎</div>
                <h2 class="med-empty__title">No results yet</h2>
                <p class="med-empty__body">
                  Type a query above and pick which libraries to include.
                </p>
              </div>
            } @else {
              <div class="med-grid" role="list">
                @for (c of stockResults(); track $index) {
                  <article class="med-card" role="listitem">
                    <div class="med-thumb">
                      <img
                        [src]="c.thumb_url"
                        [alt]="c.attribution || c.source"
                        loading="lazy"
                        decoding="async"
                      />
                      <span class="med-thumb__attrib">{{ sourceLabel(c.source) }}</span>
                      <div class="med-overlay">
                        <button type="button" class="btn-overlay"
                                (click)="saveStock(c)" [disabled]="savingCandidates().has(candidateKey(c))">
                          {{ savingCandidates().has(candidateKey(c)) ? 'Saving…' : 'Save to Library' }}
                        </button>
                      </div>
                    </div>
                    <div class="med-meta">
                      <span class="med-meta__name">{{ c.attribution || 'Untitled' }}</span>
                      <div class="med-meta__chips">
                        <span class="chip chip--kind">{{ c.kind }}</span>
                        @if (c.width && c.height) {
                          <span class="chip">{{ c.width }}×{{ c.height }}</span>
                        }
                      </div>
                    </div>
                  </article>
                }
              </div>
            }
          </div>
        }

        <!-- ═════ Image Studio ═════ -->
        @case ('image') {
          <div id="med-panel-image" role="tabpanel" aria-labelledby="med-tab-image" class="studio">
            <div class="studio__form">
              <span class="studio__chip">DALL·E 3</span>
              <label class="studio__label" for="img-prompt">Prompt</label>
              <textarea
                id="img-prompt"
                hlmInput [multiline]="true" class="input-field--textarea"
                rows="6"
                [(ngModel)]="imagePrompt"
                placeholder="A cozy mountain cabin at golden hour, cinematic, 35mm film, shallow depth of field…"
                aria-label="Image prompt"
              ></textarea>
              <div class="studio__row">
                <label class="studio__field">
                  <span class="studio__sublabel">Size</span>
                  <select hlmSelect [(ngModel)]="imageSize" aria-label="Image size">
                    <option value="1024x1024">1024×1024 (Square)</option>
                    <option value="1792x1024">1792×1024 (Landscape)</option>
                    <option value="1024x1792">1024×1792 (Portrait)</option>
                  </select>
                </label>
                <label class="studio__field">
                  <span class="studio__sublabel">Quantity</span>
                  <select hlmSelect [(ngModel)]="imageCount" aria-label="Number of images">
                    <option [ngValue]="1">1</option>
                    <option [ngValue]="2">2</option>
                    <option [ngValue]="3">3</option>
                    <option [ngValue]="4">4</option>
                  </select>
                </label>
                <button type="button" class="btn-primary studio__cta"
                        (click)="generateImage()"
                        [disabled]="imageGenerating() || !imagePrompt.trim()">
                  @if (imageGenerating()) {
                    <span class="dot dot--pulse"></span>
                    Generating with DALL·E 3…
                  } @else {
                    Generate
                  }
                </button>
              </div>
            </div>
            @if (imageResults().length > 0) {
              <div class="studio__results">
                <h3 class="studio__results-h">Latest generations</h3>
                <div class="med-grid">
                  @for (a of imageResults(); track a.id) {
                    <article class="med-card">
                      <div class="med-thumb">
                        <img [src]="a.thumb_url || a.url || rawUrl(a)" [alt]="a.name"
                             loading="lazy" decoding="async" />
                        <div class="med-overlay">
                          <button type="button" class="btn-overlay" (click)="sendOneToBolt(a)">
                            Send to Editor
                          </button>
                          <button type="button" class="btn-overlay" (click)="goToLibrary(a)">
                            View in Library
                          </button>
                        </div>
                      </div>
                      <div class="med-meta">
                        <span class="med-meta__name">{{ a.name }}</span>
                        <div class="med-meta__chips">
                          <span class="chip chip--kind">image</span>
                          <span class="chip chip--source">DALL·E 3</span>
                        </div>
                      </div>
                    </article>
                  }
                </div>
              </div>
            }
          </div>
        }

        <!-- ═════ Video Studio ═════ -->
        @case ('video') {
          <div id="med-panel-video" role="tabpanel" aria-labelledby="med-tab-video" class="studio">
            <div class="studio__form">
              <div class="studio__chip-row">
                <button type="button" class="pill"
                        [class.is-on]="videoModel === 'sora'"
                        (click)="videoModel = 'sora'"
                        aria-pressed="true">Sora</button>
                <button type="button" class="pill"
                        [class.is-on]="videoModel === 'veo'"
                        (click)="videoModel = 'veo'"
                        aria-pressed="false">Veo</button>
              </div>
              <label class="studio__label" for="vid-prompt">Prompt</label>
              <textarea
                id="vid-prompt"
                hlmInput [multiline]="true" class="input-field--textarea"
                rows="5"
                [(ngModel)]="videoPrompt"
                placeholder="Drone footage flying over a misty redwood forest at dawn, cinematic…"
                aria-label="Video prompt"
              ></textarea>
              <label class="studio__label" for="vid-duration">Duration: {{ videoDuration }}s</label>
              <input
                id="vid-duration"
                type="range"
                min="5"
                max="30"
                step="1"
                [(ngModel)]="videoDuration"
                class="studio__range"
                aria-label="Video duration in seconds"
              />
              <button type="button" class="btn-primary studio__cta"
                      (click)="generateVideo()"
                      [disabled]="videoSubmitting() || !videoPrompt.trim()">
                {{ videoSubmitting() ? 'Queuing…' : 'Generate video' }}
              </button>
            </div>

            @if (lastVideoNote()) {
              <div class="studio__notice" role="status">
                {{ lastVideoNote() }}
              </div>
            }

            <div class="studio__results">
              <h3 class="studio__results-h">Recent video jobs</h3>
              @if (videoJobs().length === 0) {
                <p class="studio__empty">No video jobs yet — queue one above.</p>
              } @else {
                <ul class="job-list">
                  @for (j of videoJobs(); track j.id) {
                    <li class="job-row">
                      <div class="min-w-0">
                        <div class="job-name">{{ j.name }}</div>
                        <div class="job-sub">{{ sourceLabel(j.source) }} · {{ j.created_at | date:'short' }}</div>
                      </div>
                      <span class="chip" [class.chip--warn]="j.status === 'queued' || j.status === 'generating'"
                                          [class.chip--ok]="j.status === 'ready'"
                                          [class.chip--err]="j.status === 'error'">
                        {{ j.status }}
                      </span>
                      @if (j.status === 'ready') {
                        <button type="button" class="btn-ghost btn-ghost--sm" (click)="sendOneToBolt(j)">
                          Send to Editor
                        </button>
                      }
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        <!-- ═════ Podcast Studio ═════ -->
        @case ('podcast') {
          <div id="med-panel-podcast" role="tabpanel" aria-labelledby="med-tab-podcast" class="studio">
            <div class="studio__form">
              <div class="studio__chip-row">
                <button type="button" class="pill"
                        [class.is-on]="podcastProvider === 'elevenlabs'"
                        (click)="podcastProvider = 'elevenlabs'"
                        aria-pressed="true">ElevenLabs</button>
                <button type="button" class="pill"
                        [class.is-on]="podcastProvider === 'openai'"
                        (click)="podcastProvider = 'openai'"
                        aria-pressed="false">OpenAI TTS</button>
              </div>
              <label class="studio__label" for="pod-title">Title</label>
              <input
                id="pod-title"
                type="text"
                hlmInput
                [(ngModel)]="podcastTitle"
                placeholder="Episode 12 — The Future of Edge Compute"
                aria-label="Podcast title"
              />

              <div class="studio__row studio__row--col">
                <span class="studio__sublabel">Script segments</span>
                @for (seg of podcastSegments(); track $index; let i = $index) {
                  <div class="seg-row">
                    <input
                      type="text"
                      hlmInput class="seg-row__voice"
                      [ngModel]="seg.voice"
                      (ngModelChange)="updateSegment(i, 'voice', $event)"
                      [placeholder]="podcastProvider === 'elevenlabs' ? 'Voice ID (e.g. Rachel)' : 'alloy | echo | fable | onyx | nova | shimmer'"
                      [attr.aria-label]="'Segment ' + (i + 1) + ' voice'"
                    />
                    <textarea
                      hlmInput [multiline]="true" class="input-field--textarea seg-row__text"
                      rows="3"
                      [ngModel]="seg.text"
                      (ngModelChange)="updateSegment(i, 'text', $event)"
                      placeholder="Type what this voice should say…"
                      [attr.aria-label]="'Segment ' + (i + 1) + ' text'"
                    ></textarea>
                    <button type="button" class="btn-ghost btn-ghost--icon"
                            (click)="removeSegment(i)"
                            [disabled]="podcastSegments().length <= 1"
                            [attr.aria-label]="'Remove segment ' + (i + 1)">
                      ✕
                    </button>
                  </div>
                }
                <button type="button" class="btn-ghost btn-ghost--sm" (click)="addSegment()">
                  + Add segment
                </button>
              </div>

              <button type="button" class="btn-primary studio__cta"
                      (click)="generatePodcast()"
                      [disabled]="podcastGenerating() || !podcastReady()">
                {{ podcastGenerating() ? 'Synthesizing…' : 'Generate podcast' }}
              </button>
            </div>

            @if (podcastResult(); as p) {
              <div class="studio__results">
                <h3 class="studio__results-h">Latest episode</h3>
                <div class="podcast-result">
                  <div class="podcast-result__meta">
                    <strong>{{ p.name }}</strong>
                    <span class="chip chip--source">{{ sourceLabel(p.source) }}</span>
                  </div>
                  <audio controls preload="metadata" [src]="p.url || rawUrl(p)"></audio>
                  <button type="button" class="btn-ghost btn-ghost--sm" (click)="sendOneToBolt(p)">
                    Send to Editor
                  </button>
                </div>
              </div>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0,0,0,0); border: 0;
      }

      /* ─── Header ─── */
      .med-header { display: flex; flex-direction: column; gap: 0.75rem; }
      .med-header__title-row { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; }
      .med-title {
        font: 700 1.6rem 'Sora', system-ui, sans-serif;
        margin: 0; letter-spacing: -0.02em;
        color: var(--ps-ink, #f4f4ff);
      }
      .count-chip {
        display: inline-flex; align-items: baseline; gap: 0.3em;
        padding: 3px 10px; border-radius: 999px;
        font: 600 0.66rem 'JetBrains Mono', ui-monospace, monospace;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
        color: var(--ps-accent, #00e5ff);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
        letter-spacing: 0.04em; text-transform: uppercase;
      }
      .count-chip app-rolling-counter { font: inherit; color: inherit; }
      .med-header__actions {
        display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
      }

      /* ─── Inputs / buttons ─── */
      /* .input-field base + focus removed — all 10 controls use hlmInput now.
         The --search / --textarea modifier classes below are KEPT (icon-padding,
         Sora font, min-height, resize) and layer on top of hlmInput. */
      .input-field--textarea {
        font-family: 'Sora', system-ui, sans-serif; line-height: 1.5;
        resize: vertical; min-height: 96px;
      }
      .med-search { position: relative; flex: 1; min-width: 220px; }
      .med-search--lg { flex: 1 1 320px; }
      .med-search__icon {
        position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
        color: rgba(255,255,255,0.5); pointer-events: none;
      }
      .input-field--search { padding-left: 32px; width: 100%; }

      .btn-primary {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 0.55rem 1rem; min-height: 40px;
        border-radius: var(--ps-radius-xl, 22px);
        background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610);
        font-weight: 700; font-size: 0.82rem; border: none; cursor: pointer;
        transition: filter 150ms ease, transform 150ms ease;
      }
      .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
      .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-ghost {
        padding: 0.5rem 0.85rem; min-height: 36px;
        border-radius: 10px;
        background: rgba(255,255,255,0.04); color: var(--ps-ink, #fff);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer; font-weight: 600; font-size: 0.78rem;
      }
      .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.09); }
      .btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
      .btn-ghost--sm { padding: 0.35rem 0.7rem; min-height: 30px; font-size: 0.74rem; }
      .btn-ghost--quiet { background: transparent; border-color: transparent; opacity: 0.7; }
      .btn-ghost--icon { padding: 0; width: 36px; min-height: 36px; }
      .btn-danger {
        padding: 0.5rem 0.85rem; min-height: 36px; border-radius: 10px;
        background: rgba(248,113,113,0.14); color: #fecaca;
        border: 1px solid rgba(248,113,113,0.35);
        font-weight: 600; font-size: 0.78rem; cursor: pointer;
      }
      .btn-danger:hover:not(:disabled) { background: rgba(248,113,113,0.22); }

      /* ─── Tabs ─── */
      .med-tabs {
        position: relative;
        display: flex; gap: 0.25rem; padding: 4px;
        background: rgba(255,255,255,0.03); border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.06); width: fit-content;
        max-width: 100%; overflow-x: auto;
      }
      /* Sliding cyan pill that glides under the active tab. Width = one Nth of
         the track (minus the 4px padding both ends); X = active index × that
         width. translate3d keeps it on the compositor. */
      .med-tab-indicator {
        position: absolute; top: 4px; bottom: 4px; left: 4px;
        width: calc((100% - 8px) / var(--med-tab-count, 5));
        border-radius: 8px;
        background: var(--ps-accent, #00e5ff);
        box-shadow: 0 0 14px color-mix(in oklch, var(--ps-accent, #00e5ff) 45%, transparent);
        transform: translate3d(calc(var(--med-tab-active, 0) * 100%), 0, 0);
        transition: transform 240ms cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none; z-index: 0;
      }
      .med-tab {
        position: relative; z-index: 1;
        flex: 1 0 auto;
        padding: 0.5rem 0.95rem; min-height: 36px;
        border: none; background: transparent;
        color: rgba(255,255,255,0.7);
        font-weight: 600; font-size: 0.78rem; cursor: pointer;
        border-radius: 8px; white-space: nowrap;
        transition: color 200ms ease;
      }
      .med-tab:hover:not(.is-active) { color: var(--ps-ink, #fff); }
      /* Active tab text rides ON the cyan indicator → ink flips to canvas color
         for ≥7:1 contrast against #00e5ff (cyan luminance is high). */
      .med-tab.is-active { color: var(--ps-bg, #060610); }
      .med-tab:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) {
        .med-tab-indicator { transition: none !important; }
      }

      /* ─── Bulk-action bar ─── */
      .bulk-bar {
        display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;
        padding: 0.6rem 0.85rem; margin-bottom: 0.75rem;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
        border-radius: var(--ps-radius-xl, 22px);
      }
      .bulk-count {
        font: 700 0.72rem 'JetBrains Mono', ui-monospace, monospace;
        color: var(--ps-accent, #00e5ff); letter-spacing: 0.04em;
      }

      /* ─── Grid + cards ─── */
      .med-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px;
      }
      .med-card {
        position: relative;
        display: flex; flex-direction: column;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: var(--ps-radius-xl, 22px);
        overflow: hidden;
        transition: border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
      }
      .med-card:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        transform: translateY(-2px);
        box-shadow: var(--ps-shadow-modal, 0 12px 28px rgba(0,0,0,0.4));
      }
      .med-card.skel { height: 220px; }

      .med-card__select {
        position: absolute; top: 8px; left: 8px; z-index: 2;
        width: 22px; height: 22px;
        background: rgba(0,0,0,0.55); border-radius: 6px;
        display: grid; place-items: center; cursor: pointer;
      }
      .med-card__select input { accent-color: var(--ps-accent, #00e5ff); cursor: pointer; }

      .med-thumb {
        position: relative; aspect-ratio: 4 / 3;
        background: rgba(0,0,0,0.4);
        display: grid; place-items: center;
        overflow: hidden;
      }
      .med-thumb img,
      .med-thumb video { width: 100%; height: 100%; object-fit: cover; }
      .med-thumb__icon { color: rgba(255,255,255,0.5); }
      .med-thumb__badge {
        position: absolute; right: 8px; bottom: 8px;
        padding: 2px 8px; border-radius: 6px;
        background: rgba(0,0,0,0.7); color: #fff;
        font: 600 0.65rem 'JetBrains Mono', ui-monospace, monospace;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .med-thumb__attrib {
        position: absolute; left: 8px; bottom: 8px;
        padding: 2px 8px; border-radius: 6px;
        background: rgba(0,0,0,0.7); color: var(--ps-accent, #00e5ff);
        font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .med-thumb__status {
        position: absolute; left: 8px; top: 8px;
        display: inline-flex; align-items: center; gap: 4px;
        padding: 2px 8px; border-radius: 999px;
        background: rgba(251,191,36,0.16); color: #fde68a;
        border: 1px solid rgba(251,191,36,0.36);
        font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace;
      }

      .med-overlay {
        position: absolute; inset: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.0) 55%);
        display: flex; align-items: flex-end; justify-content: center; gap: 6px;
        padding: 8px;
        opacity: 0; transition: opacity 180ms ease;
      }
      .med-card:hover .med-overlay,
      .med-card:focus-within .med-overlay { opacity: 1; }
      .btn-overlay {
        padding: 0.35rem 0.65rem; min-height: 30px;
        border-radius: 8px;
        background: rgba(255,255,255,0.92); color: var(--ps-bg, #060610);
        border: none; cursor: pointer;
        font-weight: 700; font-size: 0.7rem;
      }
      .btn-overlay:hover:not(:disabled) { background: #fff; }
      .btn-overlay--danger { background: rgba(248,113,113,0.95); color: #fff; }

      .med-meta { padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 4px; }
      .med-meta__name {
        font: 600 0.78rem 'Sora', system-ui, sans-serif;
        color: var(--ps-ink, #f4f4ff);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .med-meta__chips { display: flex; gap: 4px; flex-wrap: wrap; }
      .chip {
        padding: 1px 7px; border-radius: 999px;
        font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace;
        text-transform: uppercase; letter-spacing: 0.06em;
        background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.7);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .chip--kind {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
        color: var(--ps-accent, #00e5ff);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
      }
      .chip--source { color: rgba(255,255,255,0.78); }
      .chip--ok { background: rgba(52,211,153,0.14); color: #86efac; border-color: rgba(52,211,153,0.34); }
      .chip--warn { background: rgba(251,191,36,0.14); color: #fde68a; border-color: rgba(251,191,36,0.34); }
      .chip--err { background: rgba(248,113,113,0.14); color: #fecaca; border-color: rgba(248,113,113,0.34); }

      /* ─── Empty state ─── */
      .med-empty {
        padding: 3rem 1rem; text-align: center;
        display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
        border: 1px dashed rgba(255,255,255,0.12);
        border-radius: var(--ps-radius-xl, 22px);
        background: rgba(255,255,255,0.015);
      }
      .med-empty__glyph { font-size: 2rem; opacity: 0.6; }
      .med-empty__title {
        font: 700 1.05rem 'Sora', system-ui, sans-serif; margin: 0;
        color: var(--ps-ink, #f4f4ff);
      }
      .med-empty__body {
        font-size: 0.86rem; max-width: 380px;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
        margin: 0;
      }
      .med-empty__actions { display: flex; gap: 0.5rem; margin-top: 0.3rem; flex-wrap: wrap; }

      /* ─── Stock toolbar / pills ─── */
      .stock-toolbar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
      .stock-pills { display: flex; flex-wrap: wrap; gap: 6px; }
      .pill {
        padding: 0.35rem 0.75rem; min-height: 32px;
        border-radius: 999px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.7);
        font-weight: 600; font-size: 0.72rem; cursor: pointer;
        letter-spacing: 0.02em;
        transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
      }
      .pill:hover { color: var(--ps-ink, #fff); }
      .pill.is-on {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 20%, transparent);
        color: var(--ps-accent, #00e5ff);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent);
      }
      .pill:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }

      /* ─── Studios (image / video / podcast) ─── */
      .studio { display: grid; gap: 1.25rem; }
      .studio__form {
        display: flex; flex-direction: column; gap: 0.75rem;
        padding: 1.1rem 1.2rem;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: var(--ps-radius-xl, 22px);
      }
      .studio__chip {
        display: inline-flex; align-self: flex-start;
        padding: 3px 10px; border-radius: 999px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        color: var(--ps-accent, #00e5ff);
        font: 600 0.66rem 'JetBrains Mono', ui-monospace, monospace;
        letter-spacing: 0.06em; text-transform: uppercase;
      }
      .studio__chip-row { display: flex; gap: 6px; }
      .studio__label {
        font: 600 0.72rem 'JetBrains Mono', ui-monospace, monospace;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--ps-accent, #00e5ff);
      }
      .studio__sublabel {
        font: 600 0.66rem 'JetBrains Mono', ui-monospace, monospace;
        color: rgba(255,255,255,0.55); letter-spacing: 0.06em; text-transform: uppercase;
      }
      .studio__row {
        display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: flex-end;
      }
      .studio__row--col { flex-direction: column; align-items: stretch; }
      .studio__field { display: flex; flex-direction: column; gap: 4px; min-width: 140px; flex: 1; }
      .studio__cta { align-self: flex-start; min-width: 180px; justify-content: center; }
      .studio__range { width: 100%; accent-color: var(--ps-accent, #00e5ff); }
      .studio__notice {
        padding: 0.7rem 0.9rem;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
        border-left: 3px solid var(--ps-accent, #00e5ff);
        border-radius: 8px;
        font-size: 0.82rem; color: var(--ps-ink, #f4f4ff);
      }
      .studio__results { display: flex; flex-direction: column; gap: 0.6rem; }
      .studio__results-h {
        font: 700 0.72rem 'JetBrains Mono', ui-monospace, monospace;
        text-transform: uppercase; letter-spacing: 0.1em;
        color: rgba(255,255,255,0.55); margin: 0;
      }
      .studio__empty { font-size: 0.82rem; color: rgba(255,255,255,0.5); margin: 0; }

      /* Podcast segments */
      .seg-row {
        display: grid;
        grid-template-columns: 200px 1fr 36px; gap: 0.5rem;
        align-items: start;
      }
      .seg-row__voice { min-height: 40px; }
      .seg-row__text { min-height: 80px; }
      @media (max-width: 640px) {
        .seg-row { grid-template-columns: 1fr 36px; }
        .seg-row__voice { grid-column: 1 / -1; }
      }

      /* Video job list */
      .job-list { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; }
      .job-row {
        display: flex; align-items: center; gap: 0.6rem;
        padding: 0.6rem 0.85rem;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 12px;
      }
      .job-name { font: 600 0.82rem 'Sora', system-ui, sans-serif; color: var(--ps-ink, #fff); }
      .job-sub { font: 500 0.7rem 'JetBrains Mono', ui-monospace, monospace; color: rgba(255,255,255,0.5); }

      .podcast-result {
        display: flex; flex-direction: column; gap: 0.6rem;
        padding: 1rem 1.1rem;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: var(--ps-radius-xl, 22px);
      }
      .podcast-result__meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
      .podcast-result audio { width: 100%; }

      /* ─── Misc ─── */
      .skel {
        background: rgba(255,255,255,0.04); border-radius: 12px;
        position: relative; overflow: hidden;
      }
      .skel::after {
        content: ""; position: absolute; inset: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
        background-size: 200% 100%; animation: shine 1.5s linear infinite;
      }
      .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .dot--pulse { animation: pulse 1.4s ease-in-out infinite; }
      @keyframes shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
      @keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .skel::after, .dot--pulse, .med-card { animation: none !important; transition: none !important; transform: none !important; }
      }
      /* Unified WCAG 2.4.11 focus appearance — cyan ring ≥3:1 on every
         interactive element, not just buttons (selects, search/text inputs,
         card-select checkboxes, range slider, textareas). */
      button:focus-visible,
      [hlmInput]:focus-visible,
      [hlmSelect]:focus-visible,
      select:focus-visible,
      input:focus-visible,
      textarea:focus-visible,
      a:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px;
      }
      .med-card__select input:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; border-radius: 4px;
      }

      /* ─── Compact mode (rendered inside the editor overlay) ─── */
      /* When the media library is mounted as a half-screen overlay on top of
         the bolt iframe (via [compact]=true), shrink every chrome element so
         the surface still feels generous in ~50vw and the focus stays on
         pick-one-asset workflows rather than bulk management. */
      .media--compact {
        --med-tile-min: 140px;
      }
      .media--compact .med-title { font-size: 1.15rem; }
      .media--compact .count-chip { padding: 2px 7px; font-size: 0.58rem; }
      .media--compact .med-header__actions { gap: 0.35rem; }
      /* compact-density override re-keyed from .input-field → [hlmInput] after Spartan convergence */
      .media--compact [hlmInput] { min-height: 34px; padding: 0.35rem 0.55rem; font-size: 0.74rem; }
      .media--compact .input-field--search { padding-left: 28px; }
      .media--compact .med-search { min-width: 160px; }
      .media--compact .btn-primary { min-height: 34px; padding: 0.4rem 0.8rem; font-size: 0.74rem; }
      .media--compact .med-tabs { padding: 3px; border-radius: 10px; }
      .media--compact .med-tab-indicator { top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--med-tab-count, 5)); }
      .media--compact .med-tab { min-height: 32px; padding: 0.35rem 0.7rem; font-size: 0.7rem; }
      .media--compact .med-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
      .media--compact .med-card { border-radius: 14px; }
      .media--compact .med-thumb { aspect-ratio: 1 / 1; }
      .media--compact section.space-y-5 { gap: 0.85rem; }
      /* Hide ancillary CTAs (secondary upload trigger surfaces, attribution
         line in cards) so the grid breathes. */
      .media--compact .med-empty__actions .btn-ghost { display: none; }
    `,
  ],
})
export class AdminMediaComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly bolt = inject(BoltEmbedService);
  private readonly toast = inject(ToastService);
  private readonly confirmSvc = inject(ConfirmService);

  @ViewChild('fileInput') private fileInputRef?: ElementRef<HTMLInputElement>;

  /**
   * Compact-mode flag. When `true` the component renders inside the editor
   * overlay (half-screen, right-side) and applies the `.media--compact`
   * style branch — smaller grid tiles, shrunken header, no bulk-action bar,
   * tighter tabs. When `false` (default) the component renders standalone
   * at `/admin/media` with full chrome.
   */
  readonly compact = input<boolean>(false);

  /** Skeleton placeholder count for loading grids. */
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  /** Tab definitions rendered in the tab strip. */
  readonly tabs: { id: MediaTab; label: string }[] = [
    { id: 'library', label: 'Library' },
    { id: 'stock', label: 'Stock Search' },
    { id: 'image', label: 'Image Studio' },
    { id: 'video', label: 'Video Studio' },
    { id: 'podcast', label: 'Podcast Studio' },
  ];

  // ─── Tab state ────────────────────────────────────────────────────────────
  readonly activeTab = signal<MediaTab>(this.readStoredTab());

  /** Index of the active tab — drives the sliding cyan indicator's transform. */
  readonly activeTabIndex = computed(() => {
    const idx = this.tabs.findIndex((t) => t.id === this.activeTab());
    return idx === -1 ? 0 : idx;
  });

  // ─── Library state ────────────────────────────────────────────────────────
  readonly assets = signal<MediaAsset[]>([]);
  readonly loadingLibrary = signal(true);
  /** Persistent library-load failure — so a fetch error shows a Retry card, not a fake "No media yet" empty state (which could prompt a re-upload of assets that are safe). */
  readonly libraryError = signal<string | null>(null);
  readonly kindFilter = signal<'all' | MediaKind>('all');
  /** Raw input value — debounced into `searchTerm` via the effect below. */
  readonly searchInput = signal('');
  /** Debounced search term — actually consumed by `filteredAssets`. */
  readonly searchTerm = signal('');
  /** Set of asset IDs the user has multi-selected for bulk actions. */
  readonly selectedIds = signal<Set<string>>(new Set());

  readonly filteredAssets = computed(() => {
    const q = this.searchTerm().toLowerCase().trim();
    const kind = this.kindFilter();
    return this.assets().filter((a) => {
      if (kind !== 'all' && a.kind !== kind) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  readonly assetCountLabel = computed(
    () => `${this.assets().length} assets in library`,
  );

  // ─── Stock Search state ───────────────────────────────────────────────────
  stockQuery = '';
  readonly stockLoading = signal(false);
  readonly stockResults = signal<StockCandidate[]>([]);
  readonly savingCandidates = signal<Set<string>>(new Set());
  readonly stockSources = signal<StockSourceOption[]>([
    { id: 'unsplash', label: 'Unsplash', enabled: true },
    { id: 'pexels', label: 'Pexels', enabled: true },
    { id: 'pexels-video', label: 'Pexels Video', enabled: true },
    { id: 'pixabay', label: 'Pixabay', enabled: true },
    { id: 'google-images', label: 'Google Images', enabled: true },
    { id: 'foursquare', label: 'Foursquare', enabled: true },
    { id: 'yelp', label: 'Yelp', enabled: true },
  ]);

  // ─── Image Studio state ───────────────────────────────────────────────────
  imagePrompt = '';
  imageSize: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024';
  imageCount = 1;
  readonly imageGenerating = signal(false);
  readonly imageResults = signal<MediaAsset[]>([]);

  // ─── Video Studio state ───────────────────────────────────────────────────
  videoPrompt = '';
  videoDuration = 10;
  videoModel: 'sora' | 'veo' = 'sora';
  readonly videoSubmitting = signal(false);
  readonly lastVideoNote = signal('');
  /** Filter `assets()` to just queued/generating/ready video jobs. */
  readonly videoJobs = computed(() =>
    this.assets()
      .filter((a) => a.kind === 'video')
      .sort((x, y) => (x.created_at > y.created_at ? -1 : 1))
      .slice(0, 8),
  );

  // ─── Podcast Studio state ─────────────────────────────────────────────────
  podcastTitle = '';
  podcastProvider: 'elevenlabs' | 'openai' = 'elevenlabs';
  readonly podcastSegments = signal<PodcastSegment[]>([
    { voice: '', text: '' },
  ]);
  readonly podcastGenerating = signal(false);
  readonly podcastResult = signal<MediaAsset | null>(null);

  readonly podcastReady = computed(() => {
    if (!this.podcastTitle.trim()) return false;
    const segs = this.podcastSegments();
    return segs.length > 0 && segs.every((s) => s.voice.trim() && s.text.trim());
  });

  // ─── Visibility-aware polling for queued video jobs ───────────────────────
  private pollTimer?: ReturnType<typeof setInterval>;
  private readonly visibilityHandler = (): void => {
    if (document.hidden) {
      this.stopPolling();
    } else if (this.hasInFlightJobs()) {
      this.startPolling();
      this.refreshLibrary();
    }
  };

  /** Refresh-on-upload listener (set by GlobalDropZoneComponent). */
  private readonly mediaRefreshHandler = (): void => {
    this.refreshLibrary();
  };

  // ─── Debounce search input → searchTerm (300ms) ───────────────────────────
  private searchDebounce?: ReturnType<typeof setTimeout>;
  private readonly searchEffect = effect(() => {
    const v = this.searchInput();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.searchTerm.set(v), 300);
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.refreshLibrary();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('ps:media:refresh', this.mediaRefreshHandler);
    }
  }

  ngAfterViewInit(): void {
    // No-op — file input is created up-front; ElementRef resolves automatically.
  }

  ngOnDestroy(): void {
    this.stopPolling();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('ps:media:refresh', this.mediaRefreshHandler);
    }
  }

  // ─── Tab persistence ──────────────────────────────────────────────────────
  setTab(tab: MediaTab): void {
    this.activeTab.set(tab);
    try {
      localStorage.setItem('media.tab', tab);
    } catch {
      /* private mode — ignore */
    }
  }

  private readStoredTab(): MediaTab {
    try {
      const stored = localStorage.getItem('media.tab') as MediaTab | null;
      if (stored && ['library', 'stock', 'image', 'video', 'podcast'].includes(stored)) {
        return stored;
      }
    } catch {
      /* private mode — ignore */
    }
    return 'library';
  }

  // ─── Library ──────────────────────────────────────────────────────────────
  refreshLibrary(): void {
    this.loadingLibrary.set(true);
    const params: Record<string, string> = { limit: '60' };
    if (this.kindFilter() !== 'all') params['kind'] = this.kindFilter();
    if (this.searchTerm().trim()) params['q'] = this.searchTerm().trim();

    this.libraryError.set(null);
    this.api.get<{ data: MediaAsset[] }>('/media/assets', params).subscribe({
      next: (r) => {
        this.assets.set(r.data ?? []);
        this.libraryError.set(null);
        this.loadingLibrary.set(false);
        if (this.hasInFlightJobs()) this.startPolling();
        else this.stopPolling();
      },
      // Silent error → empty grid masqueraded as "No media yet", risking a re-upload of safe assets. Record it.
      error: () => {
        this.libraryError.set('Could not load your media library — your assets are safe, retry.');
        this.loadingLibrary.set(false);
      },
    });
  }

  openFilePicker(): void {
    this.fileInputRef?.nativeElement.click();
  }

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) return;
    void this.uploadAll(files).then(() => {
      // Reset the input so re-selecting the same file fires `change` again.
      input.value = '';
    });
  }

  private async uploadAll(files: File[]): Promise<void> {
    const pending = this.toast.info(
      files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} files…`,
      { duration: 0 },
    );
    let ok = 0;
    let fail = 0;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        await new Promise<void>((resolve, reject) => {
          this.api.postFormData<{ data?: unknown }>('/media/upload', fd).subscribe({
            next: () => resolve(),
            error: (err: Error) => reject(err),
          });
        });
        ok++;
      } catch (err) {
        fail++;
        // eslint-disable-next-line no-console
        console.warn('[media] upload failed:', file.name, err);
      }
    }
    this.toast.dismiss(pending);
    if (ok > 0 && fail === 0) this.toast.success(`Uploaded ${ok}`);
    else if (ok > 0) this.toast.warning(`Uploaded ${ok}, ${fail} failed`);
    else this.toast.error('Upload failed');
    if (ok > 0) this.refreshLibrary();
  }

  toggleSelect(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedIds.set(next);
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  async deleteOne(asset: MediaAsset): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      title: 'Delete asset',
      message: `Delete "${asset.name}"? This cannot be undone — any site using it will show a broken reference.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    this.api.delete<{ ok: boolean }>(`/media/assets/${asset.id}`).subscribe({
      next: () => {
        this.assets.update((rows) => rows.filter((r) => r.id !== asset.id));
        const sel = new Set(this.selectedIds());
        sel.delete(asset.id);
        this.selectedIds.set(sel);
        this.toast.success(`Deleted ${asset.name}`);
      },
      error: () => {
        this.toast.error(`Failed to delete ${asset.name}`);
      },
    });
  }

  async deleteSelected(): Promise<void> {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;
    const ok = await this.confirmSvc.confirm({
      title: 'Delete assets',
      message: `Delete ${ids.length} ${ids.length === 1 ? 'asset' : 'assets'}? This cannot be undone.`,
      confirmLabel: `Delete ${ids.length}`,
    });
    if (!ok) return;
    let done = 0;
    let fail = 0;
    for (const id of ids) {
      this.api.delete<{ ok: boolean }>(`/media/assets/${id}`).subscribe({
        next: () => {
          done++;
          if (done + fail === ids.length) this.finishBulkDelete(done, fail);
        },
        error: () => {
          fail++;
          if (done + fail === ids.length) this.finishBulkDelete(done, fail);
        },
      });
    }
  }

  private finishBulkDelete(done: number, fail: number): void {
    if (done > 0 && fail === 0) this.toast.success(`Deleted ${done}`);
    else if (done > 0) this.toast.warning(`Deleted ${done}, ${fail} failed`);
    else this.toast.error('Delete failed');
    this.clearSelection();
    this.refreshLibrary();
  }

  // ─── Send to bolt.diy editor ──────────────────────────────────────────────
  sendOneToBolt(asset: MediaAsset): void {
    const url = asset.url || this.rawUrl(asset);
    this.api
      .post<{ ok: boolean }>('/media/send-to-bolt', {
        asset_id: asset.id,
        name: asset.name,
        mime: asset.mime,
      })
      .subscribe({
        next: () => this.postToBoltIframe([{ url, name: asset.name, mime: asset.mime }]),
        error: () =>
          // Fall back to postMessage even if the backend hook fails — the
          // editor can still consume the URL.
          this.postToBoltIframe([{ url, name: asset.name, mime: asset.mime }]),
      });
    this.toast.success(`Sent ${asset.name} to Editor`);
  }

  sendSelectedToBolt(): void {
    const chosen = this.assets().filter((a) => this.selectedIds().has(a.id));
    if (chosen.length === 0) return;
    for (const a of chosen) {
      this.api
        .post<{ ok: boolean }>('/media/send-to-bolt', {
          asset_id: a.id,
          name: a.name,
          mime: a.mime,
        })
        .subscribe({ next: () => undefined, error: () => undefined });
    }
    this.postToBoltIframe(
      chosen.map((a) => ({ url: a.url || this.rawUrl(a), name: a.name, mime: a.mime })),
    );
    this.toast.success(`Sent ${chosen.length} to Editor`);
    this.clearSelection();
  }

  /**
   * postMessage into the persistent bolt.diy iframe owned by the admin shell.
   * Looks up the iframe via the DOM (`.bolt-frame`) rather than poking
   * `BoltEmbedService` internals — that keeps this section decoupled from the
   * editor service's private fields.
   */
  private postToBoltIframe(items: { url: string; name: string; mime: string }[]): void {
    if (typeof document === 'undefined') return;
    const iframe = document.querySelector<HTMLIFrameElement>('.bolt-frame');
    if (!iframe?.contentWindow) {
      // Editor not booted yet — backend send-to-bolt still queued it.
      this.bolt.forwardToast('info', 'Assets queued — open the Editor tab to attach');
      return;
    }
    for (const it of items) {
      const msg: BoltMediaAttachMessage = {
        type: 'PS_MEDIA_ATTACH',
        url: it.url,
        name: it.name,
        mime: it.mime,
      };
      iframe.contentWindow.postMessage(msg, 'https://editor.projectsites.dev');
    }
  }

  // ─── Stock search ─────────────────────────────────────────────────────────
  toggleStockSource(id: MediaSource): void {
    this.stockSources.update((rows) =>
      rows.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }

  runStockSearch(): void {
    const q = this.stockQuery.trim();
    if (!q) return;
    const sources = this.stockSources().filter((s) => s.enabled).map((s) => s.id);
    if (sources.length === 0) {
      this.toast.warning('Select at least one stock source');
      return;
    }
    this.stockLoading.set(true);
    this.api
      .post<{ data: StockCandidate[] }>('/media/stock/search', {
        query: q,
        sources,
        perPage: 20,
      })
      .subscribe({
        next: (r) => {
          this.stockResults.set(r.data ?? []);
          this.stockLoading.set(false);
        },
        error: () => {
          this.stockLoading.set(false);
        },
      });
  }

  candidateKey(c: StockCandidate): string {
    return `${c.source}::${c.external_id ?? c.full_url}`;
  }

  saveStock(c: StockCandidate): void {
    const key = this.candidateKey(c);
    const next = new Set(this.savingCandidates());
    next.add(key);
    this.savingCandidates.set(next);
    this.api
      .post<{ data: MediaAsset }>('/media/stock/save', { candidate: c })
      .subscribe({
        next: (r) => {
          this.removeSaving(key);
          if (r.data) this.assets.update((rows) => [r.data, ...rows]);
          this.toast.success('Saved to Library');
        },
        error: () => {
          this.removeSaving(key);
          this.toast.error('Failed to save');
        },
      });
  }

  private removeSaving(key: string): void {
    const next = new Set(this.savingCandidates());
    next.delete(key);
    this.savingCandidates.set(next);
  }

  // ─── Image Studio ─────────────────────────────────────────────────────────
  generateImage(): void {
    if (!this.imagePrompt.trim()) return;
    this.imageGenerating.set(true);
    this.api
      .post<{ data: MediaAsset[] }>('/media/generate/image', {
        prompt: this.imagePrompt.trim(),
        size: this.imageSize,
        n: this.imageCount,
      })
      .subscribe({
        next: (r) => {
          const data = r.data ?? [];
          this.imageResults.set([...data, ...this.imageResults()].slice(0, 12));
          this.assets.update((rows) => [...data, ...rows]);
          this.imageGenerating.set(false);
          this.toast.success(`Generated ${data.length} ${data.length === 1 ? 'image' : 'images'}`);
        },
        error: () => {
          this.imageGenerating.set(false);
          this.toast.error('Image generation failed');
        },
      });
  }

  goToLibrary(asset: MediaAsset): void {
    this.setTab('library');
    // Filter+search so the user immediately sees the just-generated asset.
    this.kindFilter.set('image');
    this.searchInput.set(asset.name);
    this.searchTerm.set(asset.name);
  }

  // ─── Video Studio ─────────────────────────────────────────────────────────
  generateVideo(): void {
    if (!this.videoPrompt.trim()) return;
    this.videoSubmitting.set(true);
    this.api
      .post<{ data: MediaAsset }>('/media/generate/video', {
        prompt: this.videoPrompt.trim(),
        duration_s: this.videoDuration,
        model: this.videoModel,
      })
      .subscribe({
        next: (r) => {
          this.videoSubmitting.set(false);
          this.lastVideoNote.set(
            `Job queued — ${this.videoModel === 'sora' ? 'Sora' : 'Veo'} API integration pending. Track in Library.`,
          );
          if (r.data) this.assets.update((rows) => [r.data, ...rows]);
          this.toast.success('Video job queued');
          this.startPolling();
        },
        error: () => {
          this.videoSubmitting.set(false);
          this.toast.error('Failed to queue video job');
        },
      });
  }

  // ─── Podcast Studio ───────────────────────────────────────────────────────
  addSegment(): void {
    this.podcastSegments.update((rows) => [...rows, { voice: '', text: '' }]);
  }

  removeSegment(i: number): void {
    this.podcastSegments.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  updateSegment(i: number, field: 'voice' | 'text', value: string): void {
    this.podcastSegments.update((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)),
    );
  }

  generatePodcast(): void {
    if (!this.podcastReady()) return;
    this.podcastGenerating.set(true);
    this.api
      .post<{ data: MediaAsset }>('/media/generate/podcast', {
        title: this.podcastTitle.trim(),
        provider: this.podcastProvider,
        segments: this.podcastSegments(),
      })
      .subscribe({
        next: (r) => {
          this.podcastGenerating.set(false);
          if (r.data) {
            this.podcastResult.set(r.data);
            this.assets.update((rows) => [r.data, ...rows]);
          }
          this.toast.success('Podcast ready');
        },
        error: () => {
          this.podcastGenerating.set(false);
          this.toast.error('Podcast generation failed');
        },
      });
  }

  // ─── Polling (visibility-aware) ───────────────────────────────────────────
  private hasInFlightJobs(): boolean {
    return this.assets().some((a) => a.status === 'queued' || a.status === 'generating');
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.refreshLibrary(), 8000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  rawUrl(asset: MediaAsset): string {
    return `/api/media/assets/${asset.id}/raw`;
  }

  fileExt(name: string): string {
    const i = name.lastIndexOf('.');
    return i === -1 ? 'FILE' : name.slice(i + 1).toUpperCase();
  }

  formatDuration(s?: number): string {
    if (!s && s !== 0) return '—';
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  }

  sourceLabel(s: MediaSource): string {
    const m: Record<MediaSource, string> = {
      upload: 'Upload',
      unsplash: 'Unsplash',
      pexels: 'Pexels',
      'pexels-video': 'Pexels Video',
      pixabay: 'Pixabay',
      'google-images': 'Google',
      foursquare: 'Foursquare',
      yelp: 'Yelp',
      dalle: 'DALL·E 3',
      sora: 'Sora',
      veo: 'Veo',
      elevenlabs: 'ElevenLabs',
      'openai-tts': 'OpenAI TTS',
    };
    return m[s] ?? s;
  }
}
