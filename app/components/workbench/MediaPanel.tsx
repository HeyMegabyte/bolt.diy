/**
 * @file Media tab — site-scoped media manager.
 *
 * @remarks
 * Compact asset browser supporting uploaded, AI-generated, external URL,
 * and R2-backed media. Tracks provenance, dimensions, alt text, and usage.
 * Virtualized/paginated. Never loads full R2 inventories eagerly.
 */
import React, { memo, useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';

/*
 * ---------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------
 */

type MediaKind = 'uploaded' | 'ai_generated' | 'external_url' | 'r2_object';
type MediaApproval = 'pending' | 'approved' | 'rejected';

interface MediaItem {
  id: string;
  filename: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  altText?: string;
  sourceUrl?: string;
  approvalStatus: MediaApproval;
  r2Key?: string;
  createdAt: string;
}

/*
 * ---------------------------------------------------------------------------
 * Mock data
 * ---------------------------------------------------------------------------
 */

const MOCK_MEDIA: MediaItem[] = [
  {
    id: '1',
    filename: 'hero-banner.avif',
    kind: 'ai_generated',
    mimeType: 'image/avif',
    sizeBytes: 245_000,
    width: 1920,
    height: 1080,
    altText: 'Construction crew at work',
    approvalStatus: 'approved',
    createdAt: '2026-06-30T00:00:00Z',
  },
  {
    id: '2',
    filename: 'logo-dark.svg',
    kind: 'uploaded',
    mimeType: 'image/svg+xml',
    sizeBytes: 4_200,
    width: 240,
    height: 80,
    altText: 'BrickLabor logo',
    approvalStatus: 'approved',
    createdAt: '2026-06-30T00:00:00Z',
  },
  {
    id: '3',
    filename: 'job-site-1.jpg',
    kind: 'uploaded',
    mimeType: 'image/jpeg',
    sizeBytes: 1_200_000,
    width: 4000,
    height: 3000,
    altText: '',
    approvalStatus: 'pending',
    createdAt: '2026-06-29T00:00:00Z',
  },
  {
    id: '4',
    filename: 'power-washing.jpg',
    kind: 'external_url',
    mimeType: 'image/jpeg',
    sizeBytes: 0,
    width: 800,
    height: 600,
    altText: 'Power washing service',
    sourceUrl: 'https://images.unsplash.com/photo-example',
    approvalStatus: 'approved',
    createdAt: '2026-06-28T00:00:00Z',
  },
  {
    id: '5',
    filename: 'hero-video.mp4',
    kind: 'r2_object',
    mimeType: 'video/mp4',
    sizeBytes: 8_500_000,
    r2Key: 'media/bricklabor/hero-video.mp4',
    approvalStatus: 'approved',
    createdAt: '2026-06-27T00:00:00Z',
  },
];

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

const KIND_LABELS: Record<MediaKind, string> = {
  uploaded: 'Uploaded',
  ai_generated: 'AI Generated',
  external_url: 'External URL',
  r2_object: 'R2 Object',
};

const KIND_ICONS: Record<MediaKind, string> = {
  uploaded: 'i-ph:upload-simple',
  ai_generated: 'i-ph:sparkle',
  external_url: 'i-ph:link',
  r2_object: 'i-ph:cloud',
};

const APPROVAL_ICONS: Record<MediaApproval, string> = {
  approved: 'i-ph:check-circle text-green-500',
  pending: 'i-ph:clock text-yellow-500',
  rejected: 'i-ph:x-circle text-red-500',
};

function formatSize(bytes: number): string {
  if (bytes === 0) {
    return 'external';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1_048_576) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatDims(w?: number, h?: number): string {
  if (!w || !h) {
    return '—';
  }

  return `${w}×${h}`;
}

/*
 * ---------------------------------------------------------------------------
 * Component
 * ---------------------------------------------------------------------------
 */

export const MediaPanel = memo(() => {
  const [kindFilter, setKindFilter] = useState<MediaKind | 'all'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let items = MOCK_MEDIA;

    if (kindFilter !== 'all') {
      items = items.filter((m) => m.kind === kindFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter((m) => m.filename.toLowerCase().includes(q) || (m.altText ?? '').toLowerCase().includes(q));
    }

    return items;
  }, [kindFilter, search]);

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor">
        <div className="i-ph:image-duotone text-bolt-elements-textSecondary" />
        <input
          type="text"
          placeholder="Search media…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-bolt-elements-textPrimary text-xs placeholder:text-bolt-elements-textTertiary focus:outline-none"
        />
        <span className="text-bolt-elements-textTertiary text-[10px] tabular-nums">{filtered.length} items</span>
      </div>

      {/* Kind filter pills */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-bolt-elements-borderColor/50 overflow-x-auto">
        {(['all', 'uploaded', 'ai_generated', 'external_url', 'r2_object'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setKindFilter(kind)}
            className={classNames(
              'px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap transition-colors',
              kindFilter === kind
                ? 'bg-bolt-elements-item-backgroundActive text-bolt-elements-textPrimary'
                : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary',
            )}
          >
            {kind === 'all' ? 'All' : KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-auto modern-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:image-duotone text-3xl" />
            <span>No media assets</span>
            <span className="text-[10px]">Upload images or generate with AI to populate</span>
          </div>
        ) : (
          <div className="divide-y divide-bolt-elements-borderColor/30">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-bolt-elements-item-backgroundActive cursor-pointer transition-colors"
              >
                {/* Thumb / icon */}
                <div className="flex-shrink-0 w-10 h-10 rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 flex items-center justify-center overflow-hidden">
                  {item.mimeType.startsWith('image/') ? (
                    <div className="i-ph:image text-bolt-elements-textTertiary text-lg" />
                  ) : item.mimeType.startsWith('video/') ? (
                    <div className="i-ph:video text-bolt-elements-textTertiary text-lg" />
                  ) : (
                    <div className="i-ph:file text-bolt-elements-textTertiary text-lg" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-bolt-elements-textPrimary truncate">{item.filename}</span>
                    <div className={classNames(APPROVAL_ICONS[item.approvalStatus], 'text-xs flex-shrink-0')} />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-bolt-elements-textTertiary">
                    <span className="inline-flex items-center gap-0.5">
                      <div className={KIND_ICONS[item.kind]} />
                      {KIND_LABELS[item.kind]}
                    </span>
                    <span>{formatSize(item.sizeBytes)}</span>
                    <span>{formatDims(item.width, item.height)}</span>
                  </div>
                  {item.altText && (
                    <div className="text-[10px] text-bolt-elements-textTertiary italic truncate mt-0.5">
                      alt: {item.altText}
                    </div>
                  )}
                  {!item.altText && item.kind !== 'external_url' && (
                    <div className="text-[10px] text-yellow-500/70 mt-0.5">Missing alt text</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                      title="Open source URL"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="i-ph:arrow-square-out text-xs" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-bolt-elements-borderColor/50 text-[10px] text-bolt-elements-textTertiary">
        <span>Mock adapter — R2/media live later</span>
        <span>{MOCK_MEDIA.filter((m) => m.approvalStatus === 'pending').length} pending approval</span>
      </div>
    </div>
  );
});

MediaPanel.displayName = 'MediaPanel';
