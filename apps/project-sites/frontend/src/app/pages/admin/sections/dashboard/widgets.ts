/**
 * Widget renderer + the 11 widget components emitted by the dashboard LLM.
 * Every widget is standalone, uses `var(--ps-*)` tokens, respects
 * `prefers-reduced-motion`, and animates in via the `appReveal` directive
 * with `@starting-style`-style cinematic entrance.
 *
 * Renderer maps `{name → component}`. Unknown names fall back to MarkdownWidget.
 */
import {
  Component,
  ChangeDetectionStrategy,
  Input,
  computed,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RollingCounterComponent } from '../../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../../directives/reveal.directive';
import { CalendarWidgetComponent } from './calendar-widget.component';

// ─── Shared SVG primitives ──────────────────────────────────────────────

function sparkPath(values: number[], w = 88, h = 28): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  return values
    .map((v, i) => `${i ? 'L' : 'M'} ${(i * step).toFixed(1)} ${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ');
}

// ─── Metric Grid ────────────────────────────────────────────────────────

interface MetricTile {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  delta?: number;
  spark?: number[];
}

@Component({
  selector: 'app-w-metric-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RollingCounterComponent, RevealDirective],
  template: `
    <div class="grid" appReveal>
      @for (t of tiles(); track t.label) {
        <div class="tile" appReveal>
          <div class="lbl">{{ t.label }}</div>
          <div class="val">
            <app-rolling-counter
              [value]="t.value"
              [prefix]="t.prefix ?? ''"
              [suffix]="t.suffix ?? ''"
              [duration]="900"
            />
          </div>
          @if (t.delta != null) {
            <div class="delta" [class.up]="t.delta > 0" [class.dn]="t.delta < 0">
              {{ t.delta > 0 ? '+' : '' }}{{ t.delta }}{{ t.suffix }}
            </div>
          }
          @if (t.spark?.length) {
            <svg class="spark" viewBox="0 0 88 28" preserveAspectRatio="none" aria-hidden="true">
              <path [attr.d]="path(t.spark!)" fill="none" stroke="var(--ps-accent, #00e5ff)" stroke-width="1.5" />
            </svg>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
      }
      .tile {
        position: relative;
        padding: 14px 16px;
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(0, 229, 255, 0.04), rgba(124, 58, 237, 0.03));
        border: 1px solid rgba(0, 229, 255, 0.12);
        backdrop-filter: blur(10px);
        overflow: hidden;
      }
      .lbl {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--ps-ink, #f4f4ff);
        opacity: 0.6;
      }
      .val {
        font-family: 'Sora', system-ui, sans-serif;
        font-size: 1.6rem;
        font-weight: 600;
        color: var(--ps-ink, #f4f4ff);
        margin-top: 4px;
      }
      .delta { font-size: 0.72rem; margin-top: 2px; opacity: 0.85; }
      .delta.up { color: #34d399; }
      .delta.dn { color: #f87171; }
      .spark {
        position: absolute; right: 12px; bottom: 10px;
        width: 88px; height: 28px; opacity: 0.75;
      }
    `,
  ],
})
export class WMetricGridComponent {
  @Input() set props(v: { tiles?: MetricTile[] } | undefined) {
    this.tiles.set(v?.tiles ?? []);
  }
  tiles = signal<MetricTile[]>([]);
  path = sparkPath;
}

// ─── Chart (line / bar / donut, inline SVG) ─────────────────────────────

interface ChartSeries {
  name: string;
  data: number[] | [number, number][];
  color?: string;
}

@Component({
  selector: 'app-w-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <div class="wrap" appReveal>
      <div class="hd">
        <span class="t">{{ title() }}</span>
        <span class="legend">
          @for (s of series(); track s.name) {
            <span class="lg"><i [style.background]="color(s, $index)"></i>{{ s.name }}</span>
          }
        </span>
      </div>
      @if (kind() === 'donut') {
        <svg viewBox="0 0 120 120" class="donut" aria-hidden="true">
          @for (seg of donutSegs(); track seg.name) {
            <circle
              cx="60" cy="60" r="48"
              fill="none"
              [attr.stroke]="seg.color"
              stroke-width="16"
              [attr.stroke-dasharray]="seg.dash"
              [attr.stroke-dashoffset]="seg.offset"
              transform="rotate(-90 60 60)"
            />
          }
        </svg>
      } @else {
        <svg viewBox="0 0 600 200" class="line" preserveAspectRatio="none" aria-hidden="true">
          @for (s of normalized(); track s.name) {
            @if (kind() === 'bar') {
              @for (pt of s.points; track $index) {
                <rect [attr.x]="pt.x - 6" [attr.y]="pt.y" width="12" [attr.height]="200 - pt.y"
                      [attr.fill]="s.color" opacity="0.75" rx="2" />
              }
            } @else {
              <path [attr.d]="s.path" fill="none" [attr.stroke]="s.color" stroke-width="2" />
              <path [attr.d]="s.area" [attr.fill]="s.color" opacity="0.12" />
            }
          }
        </svg>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .wrap {
        padding: 16px;
        border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
      }
      .hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .t { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; color: var(--ps-ink, #f4f4ff); }
      .legend { display: flex; gap: 12px; font-size: 0.72rem; opacity: 0.7; }
      .lg { display: inline-flex; align-items: center; gap: 5px; }
      .lg i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
      .line { width: 100%; height: 200px; }
      .donut { width: 200px; height: 200px; display: block; margin: 0 auto; }
    `,
  ],
})
export class WChartComponent {
  @Input() set props(v: {
    kind?: 'line' | 'bar' | 'donut';
    title?: string;
    series?: ChartSeries[];
  } | undefined) {
    this.kind.set(v?.kind ?? 'line');
    this.title.set(v?.title ?? '');
    this.series.set(v?.series ?? []);
  }
  kind = signal<'line' | 'bar' | 'donut'>('line');
  title = signal('');
  series = signal<ChartSeries[]>([]);

  private palette = ['#00e5ff', '#7c3aed', '#34d399', '#fbbf24', '#f87171', '#60a5fa'];
  color = (s: ChartSeries, i: number): string => s.color ?? this.palette[i % this.palette.length]!;

  normalized = computed(() => {
    const seriesArr = this.series();
    const allVals: number[] = [];
    for (const s of seriesArr) {
      for (const d of s.data) allVals.push(Array.isArray(d) ? d[1] : (d as number));
    }
    const max = Math.max(1, ...allVals);
    return seriesArr.map((s, i) => {
      const pts = s.data.map((d, j) => {
        const y = Array.isArray(d) ? d[1] : (d as number);
        const x = (j / Math.max(1, s.data.length - 1)) * 600;
        return { x, y: 200 - (y / max) * 200 };
      });
      const path = pts.map((p, k) => `${k ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
      const area = `${path} L 600 200 L 0 200 Z`;
      return { name: s.name, color: this.color(s, i), points: pts, path, area };
    });
  });

  donutSegs = computed(() => {
    const C = 2 * Math.PI * 48;
    const data = this.series().flatMap((s) =>
      s.data.map((d) => ({
        name: s.name,
        value: Array.isArray(d) ? d[1] : (d as number),
      })),
    );
    const total = data.reduce((a, b) => a + b.value, 0) || 1;
    let acc = 0;
    return data.map((d, i) => {
      const frac = d.value / total;
      const len = C * frac;
      const seg = {
        name: d.name,
        color: this.palette[i % this.palette.length]!,
        dash: `${len} ${C - len}`,
        offset: -acc,
      };
      acc += len;
      return seg;
    });
  });
}

// ─── Table ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-w-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <div class="wrap" appReveal>
      @if (title()) { <div class="t">{{ title() }}</div> }
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr>
              @for (c of columns(); track c) {
                <th>{{ c }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track $index) {
              <tr>
                @for (cell of r; track $index) {
                  <td>{{ cell }}</td>
                }
              </tr>
            }
            @if (!rows().length) {
              <tr><td [attr.colspan]="columns().length" class="empty">No rows.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .wrap {
        padding: 14px;
        border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
      }
      .t { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; margin-bottom: 8px; color: var(--ps-ink, #f4f4ff); }
      .tbl-scroll { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; font-size: 0.85rem; color: var(--ps-ink, #f4f4ff); }
      th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
      th { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; }
      tr:hover td { background: rgba(0, 229, 255, 0.04); }
      .empty { text-align: center; opacity: 0.5; padding: 20px; }
    `,
  ],
})
export class WTableComponent {
  @Input() set props(v: { title?: string; columns?: string[]; rows?: (string | number)[][] } | undefined) {
    this.title.set(v?.title ?? '');
    this.columns.set(v?.columns ?? []);
    this.rows.set(v?.rows ?? []);
  }
  title = signal('');
  columns = signal<string[]>([]);
  rows = signal<(string | number)[][]>([]);
}

// ─── Timeline ───────────────────────────────────────────────────────────

interface TimelineItem {
  at: string;
  title: string;
  body?: string;
  kind?: 'success' | 'warning' | 'error' | 'info';
}

@Component({
  selector: 'app-w-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <ol class="tl" appReveal>
      @for (it of items(); track it.at + it.title) {
        <li [class]="'tl-item k-' + (it.kind ?? 'info')">
          <div class="dot"></div>
          <div class="bd">
            <div class="hd"><span class="tt">{{ it.title }}</span><span class="at">{{ rel(it.at) }}</span></div>
            @if (it.body) { <div class="bb">{{ it.body }}</div> }
          </div>
        </li>
      }
    </ol>
  `,
  styles: [
    `
      :host { display: block; }
      .tl { list-style: none; padding: 0 0 0 16px; margin: 0; position: relative; }
      .tl::before {
        content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px;
        width: 1px; background: rgba(0, 229, 255, 0.18);
      }
      .tl-item { position: relative; padding: 6px 0 12px 16px; }
      .dot {
        position: absolute; left: -1px; top: 8px;
        width: 12px; height: 12px; border-radius: 50%;
        background: var(--ps-accent, #00e5ff);
        box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.18);
      }
      .k-success .dot { background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.2); }
      .k-warning .dot { background: #fbbf24; box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.2); }
      .k-error   .dot { background: #f87171; box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.2); }
      .hd { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
      .tt { font-weight: 600; color: var(--ps-ink, #f4f4ff); font-size: 0.92rem; }
      .at { font-size: 0.7rem; opacity: 0.55; font-family: 'JetBrains Mono', monospace; }
      .bb { margin-top: 4px; font-size: 0.82rem; opacity: 0.75; }
    `,
  ],
})
export class WTimelineComponent {
  @Input() set props(v: { items?: TimelineItem[] } | undefined) {
    this.items.set(v?.items ?? []);
  }
  items = signal<TimelineItem[]>([]);
  rel(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff)) return iso;
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}

// ─── Status Grid ────────────────────────────────────────────────────────

@Component({
  selector: 'app-w-status-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <div class="grid" appReveal>
      @for (c of cells(); track c.label) {
        <div class="cell" [attr.data-state]="c.state">
          <div class="dot"></div>
          <div class="lbl">{{ c.label }}</div>
          <div class="state">{{ c.state }}</div>
          @if (c.note) { <div class="note">{{ c.note }}</div> }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
      .cell {
        position: relative; padding: 14px;
        border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
      }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #34d399; box-shadow: 0 0 12px currentColor; }
      [data-state='warning'] .dot { background: #fbbf24; }
      [data-state='degraded'] .dot { background: #fb923c; }
      [data-state='idle'] .dot { background: rgba(255, 255, 255, 0.3); box-shadow: none; }
      [data-state='error'] .dot { background: #f87171; }
      .lbl { font-weight: 600; color: var(--ps-ink, #f4f4ff); margin-top: 8px; }
      .state { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin-top: 2px; }
      .note { font-size: 0.78rem; opacity: 0.7; margin-top: 6px; font-family: 'JetBrains Mono', monospace; }
    `,
  ],
})
export class WStatusGridComponent {
  @Input() set props(v: {
    cells?: { label: string; state: 'healthy' | 'warning' | 'degraded' | 'error' | 'idle'; note?: string }[];
  } | undefined) {
    this.cells.set(v?.cells ?? []);
  }
  cells = signal<{ label: string; state: string; note?: string }[]>([]);
}

// ─── CTA ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-w-cta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <a class="cta" [attr.href]="href()" appReveal>
      <span class="g" [attr.aria-hidden]="true">{{ glyph() }}</span>
      <span class="lbl">{{ label() }}</span>
      <span class="arr">→</span>
    </a>
  `,
  styles: [
    `
      :host { display: block; }
      .cta {
        display: inline-flex; align-items: center; gap: 10px;
        padding: 12px 18px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(0, 229, 255, 0.18), rgba(124, 58, 237, 0.16));
        border: 1px solid rgba(0, 229, 255, 0.3);
        color: var(--ps-ink, #f4f4ff);
        font-weight: 600;
        text-decoration: none;
        transition: transform 200ms ease, box-shadow 200ms ease;
      }
      .cta:hover { transform: translateY(-2px); box-shadow: 0 16px 36px -16px rgba(0, 229, 255, 0.45); }
      .g { font-size: 1.2rem; }
      .arr { opacity: 0.7; }
    `,
  ],
})
export class WCtaComponent {
  @Input() set props(v: { label?: string; href?: string; glyph?: string } | undefined) {
    this.label.set(v?.label ?? 'Open');
    this.href.set(v?.href ?? '#');
    this.glyph.set(glyphOf(v?.glyph ?? 'rocket'));
  }
  label = signal('Open');
  href = signal('#');
  glyph = signal('🚀');
}

function glyphOf(name: string): string {
  const map: Record<string, string> = {
    rocket: '🚀', camera: '📸', book: '📖', calendar: '📅', chart: '📈',
    inbox: '📥', shield: '🛡', code: '⌨', globe: '🌐', clock: '⏱',
    'credit-card': '💳', grid: '▦', help: '?', download: '⬇',
  };
  return map[name] ?? '✦';
}

// ─── File List ──────────────────────────────────────────────────────────

@Component({
  selector: 'app-w-file-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <ul class="files" appReveal>
      @for (f of files(); track f.name) {
        <li>
          <a [attr.href]="f.href ?? '#'" class="row">
            <span class="kind" [attr.data-kind]="f.kind">{{ f.kind ?? 'file' }}</span>
            <span class="name">{{ f.name }}</span>
            @if (f.size) { <span class="sz">{{ f.size }}</span> }
          </a>
        </li>
      }
    </ul>
  `,
  styles: [
    `
      :host { display: block; }
      .files { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
      .row {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; border-radius: 10px;
        background: rgba(8, 8, 32, 0.4);
        border: 1px solid rgba(0, 229, 255, 0.06);
        color: var(--ps-ink, #f4f4ff);
        text-decoration: none;
      }
      .row:hover { background: rgba(0, 229, 255, 0.06); border-color: rgba(0, 229, 255, 0.18); }
      .kind {
        padding: 2px 8px; border-radius: 6px;
        font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em;
        background: rgba(0, 229, 255, 0.12); color: rgba(0, 229, 255, 0.9);
        font-family: 'JetBrains Mono', monospace;
      }
      [data-kind='tsx'], [data-kind='ts'] { background: rgba(0, 229, 255, 0.18); color: #67e8f9; }
      [data-kind='css'], [data-kind='scss'] { background: rgba(244, 114, 182, 0.18); color: #f9a8d4; }
      [data-kind='json'] { background: rgba(251, 191, 36, 0.18); color: #fcd34d; }
      .name { flex: 1; font-size: 0.88rem; }
      .sz { font-size: 0.7rem; opacity: 0.5; font-family: 'JetBrains Mono', monospace; }
    `,
  ],
})
export class WFileListComponent {
  @Input() set props(v: { files?: { name: string; kind?: string; href?: string; size?: string }[] } | undefined) {
    this.files.set(v?.files ?? []);
  }
  files = signal<{ name: string; kind?: string; href?: string; size?: string }[]>([]);
}

// ─── Map (OpenStreetMap iframe — leaflet swap can come later) ───────────

@Component({
  selector: 'app-w-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <div class="wrap" appReveal>
      <div class="hd">{{ address() }}</div>
      <iframe
        [src]="src()"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        title="Map of {{ address() }}"
      ></iframe>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .wrap {
        padding: 12px;
        border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
      }
      .hd { font-weight: 600; margin-bottom: 8px; color: var(--ps-ink, #f4f4ff); }
      iframe { width: 100%; height: 240px; border: 0; border-radius: 8px; filter: invert(0.92) hue-rotate(180deg); }
    `,
  ],
})
export class WMapComponent {
  @Input() set props(v: { address?: string; lat?: number; lng?: number; zoom?: number } | undefined) {
    this.address.set(v?.address ?? '');
    const lat = v?.lat ?? 40.88;
    const lng = v?.lng ?? -74.39;
    const zoom = v?.zoom ?? 14;
    const d = 0.01;
    const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
    this.src.set(
      `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}&zoom=${zoom}`,
    );
  }
  address = signal('');
  src = signal('');
}

// ─── Code Block ─────────────────────────────────────────────────────────

@Component({
  selector: 'app-w-code',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <figure class="wrap" appReveal>
      <figcaption><span class="lang">{{ language() }}</span>
        <button type="button" (click)="copy()" class="cp">{{ copied() ? 'Copied' : 'Copy' }}</button>
      </figcaption>
      <pre><code>{{ code() }}</code></pre>
    </figure>
  `,
  styles: [
    `
      :host { display: block; }
      .wrap {
        border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
        overflow: hidden;
      }
      figcaption { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid rgba(0, 229, 255, 0.1); }
      .lang { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; font-family: 'JetBrains Mono', monospace; color: var(--ps-ink, #f4f4ff); }
      .cp {
        font-size: 0.7rem; padding: 4px 10px; border-radius: 6px;
        background: rgba(0, 229, 255, 0.12); color: rgba(0, 229, 255, 0.9);
        border: 1px solid rgba(0, 229, 255, 0.2); cursor: pointer;
      }
      pre { margin: 0; padding: 14px; overflow: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--ps-ink, #f4f4ff); }
    `,
  ],
})
export class WCodeComponent {
  @Input() set props(v: { language?: string; code?: string } | undefined) {
    this.language.set(v?.language ?? 'text');
    this.code.set(v?.code ?? '');
  }
  language = signal('text');
  code = signal('');
  copied = signal(false);
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  }
}

// ─── Markdown (fallback) ────────────────────────────────────────────────

@Component({
  selector: 'app-w-markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `<div class="md" appReveal [innerHTML]="html()"></div>`,
  styles: [
    `
      :host { display: block; }
      .md {
        color: var(--ps-ink, #f4f4ff);
        font-size: 0.92rem; line-height: 1.55;
      }
      .md h1, .md h2, .md h3 { font-family: 'Sora', system-ui, sans-serif; margin: 0.6em 0 0.3em; }
      .md p { margin: 0.4em 0; }
      .md code {
        background: rgba(0, 229, 255, 0.1); color: #67e8f9;
        padding: 1px 6px; border-radius: 4px; font-size: 0.85em;
      }
      .md a { color: var(--ps-accent, #00e5ff); }
      .md ul, .md ol { padding-left: 1.4em; margin: 0.4em 0; }
    `,
  ],
})
export class WMarkdownComponent {
  @Input() set props(v: { body?: string } | undefined) {
    this.html.set(miniMarkdown(v?.body ?? ''));
  }
  html = signal('');
}

/**
 * Tiny safe markdown — escapes HTML then maps a handful of markers.
 * Good enough for assistant prose; not a general-purpose renderer.
 */
function miniMarkdown(src: string): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const safe = esc(src);
  return safe
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<h\d|<p)/, '<p>')
    .replace(/$/, '</p>');
}

// ─── Social Performance (Pulse Social analytics) ────────────────────────

interface PlatformTotalsTile {
  platform: string;
  posts: number;
  impressions: number;
  reach: number;
  engagement: number;
}

interface BestPostTile {
  post_id: string;
  publish_id: string;
  platform: string;
  external_url: string | null;
  content_preview: string;
  impressions: number;
  engagement: number;
}

interface BestTimeSlot {
  day: number; // 0-6
  hour: number; // 0-23 UTC
  confidence: number; // 0-1
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const PLATFORM_GLYPH: Record<string, string> = {
  twitter: '𝕏',
  linkedin: 'in',
  facebook: 'f',
  instagram: '📷',
  threads: '@',
  bluesky: '🦋',
  reddit: 'r/',
  mastodon: '🐘',
  discord: '#',
  slack: '⚡',
  telegram: '✈',
};

@Component({
  selector: 'app-w-social-performance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RollingCounterComponent, RevealDirective],
  template: `
    <div class="wrap" appReveal>
      <header class="hd">
        <span class="t">Social performance</span>
        <span class="win">last {{ windowDays() }}d</span>
      </header>

      @if (platforms().length === 0) {
        <div class="empty">No published posts yet. Connect an account → /admin/social.</div>
      } @else {
        <div class="bars">
          @for (p of platforms(); track p.platform) {
            <div class="bar" appReveal>
              <div class="bar-head">
                <span class="glyph">{{ glyph(p.platform) }}</span>
                <span class="name">{{ p.platform }}</span>
                <span class="posts">{{ p.posts }} posts</span>
              </div>
              <div class="bar-fill">
                <div class="bar-inner" [style.width.%]="pct(p.impressions)"></div>
              </div>
              <div class="bar-foot">
                <app-rolling-counter [value]="p.impressions" suffix=" impr." />
                <span class="eng">·  {{ p.engagement }} engagements</span>
              </div>
            </div>
          }
        </div>

        @if (bestPosts().length > 0) {
          <div class="best">
            <div class="best-t">Best performing</div>
            @for (b of bestPosts(); track b.publish_id) {
              <a
                class="best-post"
                [attr.href]="b.external_url ?? '#'"
                [attr.target]="b.external_url ? '_blank' : null"
                [attr.rel]="b.external_url ? 'noopener noreferrer' : null"
                appReveal
              >
                <span class="glyph sm">{{ glyph(b.platform) }}</span>
                <div class="bp-body">
                  <div class="bp-text">{{ b.content_preview }}</div>
                  <div class="bp-meta">
                    <app-rolling-counter [value]="b.impressions" suffix=" impr." />
                    <span class="dot">·</span>
                    <span>{{ b.engagement }} engagements</span>
                  </div>
                </div>
              </a>
            }
          </div>
        }

        @if (slots().length > 0) {
          <div class="heatmap">
            <div class="heat-t">Best time to post ({{ heatPlatform() }})</div>
            <div class="heat-grid">
              @for (s of slots(); track $index) {
                <div
                  class="slot"
                  [style.opacity]="0.4 + s.confidence * 0.6"
                  [attr.title]="dayLabel(s.day) + ' ' + s.hour + ':00 UTC'"
                >
                  <span class="d">{{ dayLabel(s.day) }}</span>
                  <span class="h">{{ pad(s.hour) }}:00</span>
                </div>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .wrap {
        padding: 16px;
        border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
      }
      .hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
      .t { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; color: var(--ps-ink, #f4f4ff); }
      .win {
        font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
        opacity: 0.55; font-family: 'JetBrains Mono', monospace;
      }
      .empty { font-size: 0.85rem; opacity: 0.6; padding: 14px 0; }
      .bars { display: flex; flex-direction: column; gap: 10px; }
      .bar { padding: 10px 12px; border-radius: 10px; background: rgba(0, 229, 255, 0.04); }
      .bar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .glyph {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: 6px;
        background: rgba(0, 229, 255, 0.18); color: var(--ps-accent, #00e5ff);
        font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; font-weight: 700;
      }
      .glyph.sm { width: 18px; height: 18px; font-size: 0.65rem; flex-shrink: 0; }
      .name { font-weight: 600; color: var(--ps-ink, #f4f4ff); text-transform: capitalize; flex: 1; }
      .posts { font-size: 0.72rem; opacity: 0.55; font-family: 'JetBrains Mono', monospace; }
      .bar-fill { height: 6px; border-radius: 3px; background: rgba(0, 229, 255, 0.08); overflow: hidden; }
      .bar-inner {
        height: 100%;
        background: linear-gradient(90deg, var(--ps-accent, #00e5ff), #7c3aed);
        transition: width 600ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .bar-foot { display: flex; align-items: baseline; gap: 6px; margin-top: 6px; font-size: 0.78rem; }
      .eng { opacity: 0.6; }
      .best { margin-top: 16px; }
      .best-t {
        font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
        opacity: 0.55; margin-bottom: 8px;
      }
      .best-post {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 10px 12px; border-radius: 8px;
        background: rgba(0, 229, 255, 0.03);
        border: 1px solid rgba(0, 229, 255, 0.05);
        text-decoration: none; color: var(--ps-ink, #f4f4ff);
        margin-bottom: 6px;
      }
      .best-post:hover { background: rgba(0, 229, 255, 0.06); border-color: rgba(0, 229, 255, 0.18); }
      .bp-body { flex: 1; min-width: 0; }
      .bp-text { font-size: 0.85rem; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .bp-meta { font-size: 0.7rem; opacity: 0.6; margin-top: 4px; display: flex; gap: 6px; align-items: baseline; }
      .dot { opacity: 0.5; }
      .heatmap { margin-top: 16px; }
      .heat-t {
        font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
        opacity: 0.55; margin-bottom: 8px;
      }
      .heat-grid { display: flex; gap: 8px; flex-wrap: wrap; }
      .slot {
        display: flex; flex-direction: column; align-items: center;
        padding: 8px 12px; border-radius: 8px;
        background: linear-gradient(135deg, var(--ps-accent, #00e5ff), #7c3aed);
        color: #060610; font-weight: 600;
        min-width: 56px;
      }
      .slot .d { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .slot .h { font-size: 0.95rem; font-family: 'JetBrains Mono', monospace; margin-top: 2px; }
    `,
  ],
})
export class WSocialPerformanceComponent {
  @Input() set props(
    v:
      | {
          window_days?: number;
          platform_totals?: PlatformTotalsTile[];
          best_posts?: BestPostTile[];
          best_times?: { platform?: string; slots?: BestTimeSlot[] };
        }
      | undefined,
  ) {
    this.windowDays.set(v?.window_days ?? 30);
    this.platforms.set(v?.platform_totals ?? []);
    this.bestPosts.set(v?.best_posts ?? []);
    this.heatPlatform.set(v?.best_times?.platform ?? '');
    this.slots.set(v?.best_times?.slots ?? []);
  }
  windowDays = signal(30);
  platforms = signal<PlatformTotalsTile[]>([]);
  bestPosts = signal<BestPostTile[]>([]);
  heatPlatform = signal('');
  slots = signal<BestTimeSlot[]>([]);

  maxImpressions = computed(() => {
    const list = this.platforms();
    return Math.max(1, ...list.map((p) => p.impressions));
  });

  pct = (value: number): number => Math.max(2, (value / this.maxImpressions()) * 100);
  glyph = (platform: string): string => PLATFORM_GLYPH[platform] ?? platform.slice(0, 2);
  dayLabel = (day: number): string => DAY_LABELS[day % 7] ?? '?';
  pad = (n: number): string => String(n).padStart(2, '0');
}

// ─── Inbox Metrics — REMOVED 2026-05-25 (Pulse Inbox feature deprecated) ──
// The WInboxMetricsComponent + InboxMetricsProps + `inbox-metrics` renderer
// case were dropped when the Inbox surface was removed. Legacy dashboard
// configs that still reference `inbox-metrics` now fall through to the
// markdown default in the renderer below.

// ─── Renderer ───────────────────────────────────────────────────────────

@Component({
  selector: 'app-widget-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    WMetricGridComponent,
    WChartComponent,
    WTableComponent,
    WTimelineComponent,
    WStatusGridComponent,
    WCtaComponent,
    WFileListComponent,
    WMapComponent,
    WCodeComponent,
    WMarkdownComponent,
    CalendarWidgetComponent,
    WSocialPerformanceComponent,
  ],
  template: `
    @switch (name()) {
      @case ('metric-grid')        { <app-w-metric-grid [props]="props()" /> }
      @case ('chart')              { <app-w-chart [props]="props()" /> }
      @case ('table')              { <app-w-table [props]="props()" /> }
      @case ('timeline')           { <app-w-timeline [props]="props()" /> }
      @case ('status-grid')        { <app-w-status-grid [props]="props()" /> }
      @case ('cta')                { <app-w-cta [props]="props()" /> }
      @case ('file-list')          { <app-w-file-list [props]="props()" /> }
      @case ('map')                { <app-w-map [props]="props()" /> }
      @case ('code')               { <app-w-code [props]="props()" /> }
      @case ('calendar')           { <app-calendar-widget [props]="props()" /> }
      @case ('social-performance') { <app-w-social-performance [props]="props()" /> }
      @default                     { <app-w-markdown [props]="props()" /> }
    }
  `,
})
export class WidgetRendererComponent {
  name = input.required<string>();
  props = input<Record<string, unknown>>({});
}
