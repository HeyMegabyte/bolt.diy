import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

/**
 * Item 36 — StatusBar
 *
 * Sits at the bottom of the workbench panel. Shows:
 *   • ws connection (online/offline of `navigator.onLine`)
 *   • current file path
 *   • current file size in bytes
 *   • language inferred from file extension
 *   • encoding (utf-8 — bolt-diy is always utf-8 in WC)
 *   • git branch (best-effort: reads `?branch=` query if the admin shell
 *     supplied it, else falls back to `main`)
 *
 * Pure presentational — no side-effects beyond the online/offline listener.
 */

const EXT_TO_LANG: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript React',
  js: 'JavaScript',
  jsx: 'JavaScript React',
  json: 'JSON',
  md: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  svg: 'SVG',
  sh: 'Shell',
};

function inferLanguage(filePath: string | undefined): string {
  if (!filePath) return '—';

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  return EXT_TO_LANG[ext] ?? (ext.toUpperCase() || 'Plain');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;

  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;

  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function StatusBar() {
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const [online, setOnline] = useState(true);
  const [branch, setBranch] = useState('main');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setOnline(navigator.onLine);

    const on = () => setOnline(true);
    const off = () => setOnline(false);

    window.addEventListener('online', on);
    window.addEventListener('offline', off);

    const params = new URLSearchParams(window.location.search);
    const b = params.get('branch');

    if (b) setBranch(b);

    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const size = currentDocument?.value ? new Blob([currentDocument.value]).size : 0;
  const lang = inferLanguage(selectedFile);
  const shortPath = selectedFile?.split('/').slice(-2).join('/') ?? 'No file open';

  return (
    <div className="ps-statusbar" role="status" aria-label="Workbench status">
      <div className={classNames('ps-statusbar__dot', { 'is-online': online })} aria-hidden="true" />
      <span className="ps-statusbar__seg">{online ? 'connected' : 'offline'}</span>
      <span className="ps-statusbar__sep" aria-hidden="true">·</span>
      <span className="ps-statusbar__seg ps-statusbar__seg--mono" title={selectedFile ?? ''}>
        {shortPath}
      </span>
      <span className="ps-statusbar__sep" aria-hidden="true">·</span>
      <span className="ps-statusbar__seg">{formatBytes(size)}</span>
      <span className="ps-statusbar__sep" aria-hidden="true">·</span>
      <span className="ps-statusbar__seg">{lang}</span>
      <span className="ps-statusbar__sep" aria-hidden="true">·</span>
      <span className="ps-statusbar__seg">UTF-8</span>
      <span className="ps-statusbar__spacer" />
      <span className="ps-statusbar__seg ps-statusbar__seg--mono">
        <span className="i-ph:git-branch text-[11px] mr-1" aria-hidden="true" />
        {branch}
      </span>
    </div>
  );
}
