/**
 * @file ApiExplorerTab — walks the WebContainer FS for Remix API routes
 * and lets you fire ad-hoc requests against them.
 *
 * @remarks
 * Scans `app/routes/api.*.ts` (and `.tsx`) inside the running WebContainer
 * via the `@webcontainer/api` FS bindings. Each match is rendered as a
 * row with an inferred HTTP method (best-effort: greps the file for
 * `export const action` → POST, otherwise GET). Clicking a row expands a
 * tester pane with URL/headers/body inputs + a Send button that uses the
 * browser `fetch()` and displays the response status, headers, and body.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { webcontainer } from '~/lib/webcontainer';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface ApiRoute {
  file: string;
  path: string;
  method: 'GET' | 'POST';
}

interface SendResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ms: number;
}

function fileToPath(file: string): string {
  // app/routes/api.bolt-tabs.deploy.ts → /api/bolt-tabs/deploy
  const base = file.replace(/^app\/routes\//, '').replace(/\.(ts|tsx)$/, '');
  return '/' + base.replace(/\./g, '/').replace(/\$/g, ':');
}

async function walk(fs: Awaited<typeof webcontainer>['fs'], dir: string, acc: string[]): Promise<void> {
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return;
  }
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      await walk(fs, full, acc);
    } else if (e.isFile() && /^api\..+\.(ts|tsx)$/.test(e.name)) {
      acc.push(full.replace(/^\//, ''));
    }
  }
}

const ApiExplorerTab = memo(function ApiExplorerTab() {
  const [routes, setRoutes] = useState<ApiRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [body, setBody] = useState('{}');
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('GET');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const wc = await webcontainer;
      const files: string[] = [];
      await walk(wc.fs, '/app/routes', files);
      const sourced: ApiRoute[] = [];
      for (const f of files) {
        let inferred: 'GET' | 'POST' = 'GET';
        try {
          const src = await wc.fs.readFile(`/${f}`, 'utf-8');
          if (/export\s+(const|async\s+function)\s+action\b/.test(src)) inferred = 'POST';
        } catch {
          // ignore unreadable files
        }
        sourced.push({ file: f, path: fileToPath(f), method: inferred });
      }
      sourced.sort((a, b) => a.path.localeCompare(b.path));
      setRoutes(sourced);
    } catch (err) {
      console.warn('[ApiExplorerTab] scan failed', err);
      setError(err instanceof Error ? err.message : 'Scan failed — WebContainer may not be ready');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const open = (r: ApiRoute) => {
    setActiveFile(r.file === activeFile ? null : r.file);
    setUrl(r.path);
    setMethod(r.method);
    setResult(null);
  };

  const send = useCallback(async () => {
    setSending(true);
    setResult(null);
    const start = performance.now();
    try {
      const parsedHeaders = headers.trim() ? (JSON.parse(headers) as Record<string, string>) : {};
      const init: RequestInit = { method, headers: parsedHeaders };
      if (method !== 'GET' && method !== 'DELETE' && body.trim()) init.body = body;
      const res = await fetch(url, init);
      const text = await res.text();
      const hdrs: Record<string, string> = {};
      res.headers.forEach((v, k) => (hdrs[k] = v));
      setResult({
        status: res.status,
        statusText: res.statusText,
        headers: hdrs,
        body: text,
        ms: Math.round(performance.now() - start),
      });
    } catch (err) {
      console.warn('[ApiExplorerTab] send failed', err);
      setResult({
        status: 0,
        statusText: 'fetch error',
        headers: {},
        body: err instanceof Error ? err.message : String(err),
        ms: Math.round(performance.now() - start),
      });
    } finally {
      setSending(false);
    }
  }, [url, method, headers, body]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-terminals-background">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:plug-duotone text-lg text-bolt-elements-textSecondary" />
        <span className="text-xs text-bolt-elements-textSecondary font-medium">API Explorer</span>
        <span className="text-xs text-bolt-elements-textTertiary">({routes.length} routes)</span>
        <IconButton className="ml-auto" icon="i-ph:arrow-clockwise" title="Rescan" size="md" onClick={scan} disabled={loading} />
      </div>

      <div className="flex-1 overflow-auto">
        {error && <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm">{error}</div>}

        {loading && (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
            ))}
          </div>
        )}

        {!loading && !error && routes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary p-6">
            <div className="i-ph:plugs-duotone text-4xl mb-2 opacity-50" />
            <div className="text-sm">No API routes detected.</div>
            <div className="text-xs mt-1">Add a file under <code>app/routes/api.*.ts</code> to populate this view.</div>
          </div>
        )}

        {routes.map((r) => (
          <div key={r.file} className="border-b border-bolt-elements-borderColor">
            <button
              onClick={() => open(r)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-bolt-elements-background-depth-1"
            >
              <span
                className={classNames(
                  'px-2 py-0.5 rounded-full text-[10px] font-mono border',
                  r.method === 'POST'
                    ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
                    : 'text-green-400 bg-green-400/10 border-green-400/20',
                )}
              >
                {r.method}
              </span>
              <span className="text-bolt-elements-textPrimary font-mono text-xs flex-1 truncate">{r.path}</span>
              <span className="text-bolt-elements-textTertiary text-[10px] truncate max-w-[50%]">{r.file}</span>
              <div className={classNames('i-ph:caret-down transition-transform', activeFile === r.file && 'rotate-180')} />
            </button>

            {activeFile === r.file && (
              <div className="px-3 pb-3 bg-bolt-elements-background-depth-1 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as typeof method)}
                    className="bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-xs px-2 py-1 rounded border border-bolt-elements-borderColor"
                  >
                    {(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="flex-1 bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-xs px-2 py-1 rounded border border-bolt-elements-borderColor font-mono"
                  />
                  <button
                    onClick={send}
                    disabled={sending || !url}
                    className="text-xs px-3 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive disabled:opacity-40 flex items-center gap-1"
                  >
                    <div className={classNames('i-ph:paper-plane-tilt-duotone', sending && 'animate-pulse')} />
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] uppercase text-bolt-elements-textTertiary mb-1">Headers</div>
                    <textarea
                      value={headers}
                      onChange={(e) => setHeaders(e.target.value)}
                      spellCheck={false}
                      className="w-full h-24 bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary font-mono text-[11px] p-2 rounded border border-bolt-elements-borderColor outline-none resize-none"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-bolt-elements-textTertiary mb-1">Body</div>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      spellCheck={false}
                      disabled={method === 'GET' || method === 'DELETE'}
                      className="w-full h-24 bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary font-mono text-[11px] p-2 rounded border border-bolt-elements-borderColor outline-none resize-none disabled:opacity-40"
                    />
                  </div>
                </div>
                {result && (
                  <div className="border border-bolt-elements-borderColor rounded">
                    <div className="flex items-center gap-2 px-2 py-1 bg-bolt-elements-background-depth-2 text-xs">
                      <span
                        className={classNames(
                          'font-mono px-2 py-0.5 rounded',
                          result.status >= 200 && result.status < 300 && 'text-green-400 bg-green-400/10',
                          result.status >= 400 && 'text-red-400 bg-red-400/10',
                          result.status === 0 && 'text-red-400 bg-red-400/10',
                        )}
                      >
                        {result.status} {result.statusText}
                      </span>
                      <span className="text-bolt-elements-textTertiary">{result.ms}ms</span>
                    </div>
                    <pre className="text-[11px] font-mono p-2 max-h-48 overflow-auto whitespace-pre-wrap text-bolt-elements-textSecondary">
                      {result.body}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

export default ApiExplorerTab;
