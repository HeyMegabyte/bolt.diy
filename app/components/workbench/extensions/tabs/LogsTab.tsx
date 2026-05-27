/**
 * @file LogsTab — live-tailing log stream for the active project.
 *
 * @remarks
 * Polls `GET /api/bolt-tabs/logs?project={p}` every 5 seconds while in
 * Live mode. Auto-scrolls to the bottom unless the user has scrolled up
 * (tracked via a near-bottom threshold). Each log line is colored by
 * severity. The Clear button wipes the local buffer without touching the
 * server.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface LogLine {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

interface LogsResponse {
  lines: LogLine[];
}

const LEVEL_TONE: Record<LogLine['level'], string> = {
  info: 'text-bolt-elements-textSecondary',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-bolt-elements-textTertiary',
};

const POLL_INTERVAL_MS = 5000;
const NEAR_BOTTOM_PX = 40;

const LogsTab = memo(function LogsTab() {
  const [project, setProject] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const sinceCursorRef = useRef<string | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!project.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const since = sinceCursorRef.current ? `&since=${encodeURIComponent(sinceCursorRef.current)}` : '';
      const res = await fetch(`/api/bolt-tabs/logs?project=${encodeURIComponent(project.trim())}${since}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LogsResponse;
      const next = data.lines ?? [];
      if (next.length) {
        sinceCursorRef.current = next[next.length - 1].timestamp;
        setLines((prev) => [...prev, ...next].slice(-2000));
      }
    } catch (err) {
      console.warn('[LogsTab] fetch failed', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (!live || !project.trim()) return undefined;
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, project, fetchOnce]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distFromBottom < NEAR_BOTTOM_PX;
  }, []);

  useLayoutEffect(() => {
    if (stickToBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const clear = useCallback(() => {
    setLines([]);
    sinceCursorRef.current = null;
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-terminals-background">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:list-magnifying-glass-duotone text-lg text-bolt-elements-textSecondary" />
        <input
          className="flex-1 max-w-xs bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary text-sm px-2 py-1 rounded border border-bolt-elements-borderColor focus:outline-none focus:border-bolt-elements-borderColorActive"
          placeholder="project name"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <button
          onClick={() => setLive((v) => !v)}
          className={classNames(
            'flex items-center gap-1 px-2 py-1 text-xs rounded-full border',
            live
              ? 'bg-green-400/10 border-green-400/30 text-green-400'
              : 'bg-bolt-elements-background-depth-1 border-bolt-elements-borderColor text-bolt-elements-textTertiary',
          )}
        >
          <div className={classNames('w-1.5 h-1.5 rounded-full', live ? 'bg-green-400 animate-pulse' : 'bg-bolt-elements-textTertiary')} />
          {live ? 'Live' : 'Paused'}
        </button>
        <IconButton icon="i-ph:trash" title="Clear" size="md" onClick={clear} />
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto font-mono text-xs leading-relaxed p-3">
        {error && (
          <div className="mb-2 p-2 rounded border border-red-400/30 bg-red-400/10 text-red-300">{error}</div>
        )}
        {!error && lines.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary">
            <div className="i-ph:terminal-window-duotone text-4xl mb-2 opacity-50" />
            <div className="text-sm">No log lines yet.</div>
            <div className="text-xs mt-1">Enter a project name and keep Live on to tail the worker.</div>
          </div>
        )}
        {lines.map((l) => (
          <div key={l.id} className={classNames('whitespace-pre-wrap break-words', LEVEL_TONE[l.level])}>
            <span className="text-bolt-elements-textTertiary mr-2">{l.timestamp}</span>
            <span className="uppercase mr-2">[{l.level}]</span>
            {l.source && <span className="text-bolt-elements-textTertiary mr-2">{l.source}</span>}
            <span>{l.message}</span>
          </div>
        ))}
        {loading && lines.length === 0 && (
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-3 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default LogsTab;
