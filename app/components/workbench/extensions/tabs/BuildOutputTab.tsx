/**
 * @file BuildOutputTab — pick a script from the workspace `package.json`,
 * spawn it inside the WebContainer, and stream stdout/stderr into a
 * scrolling monospace log with exit-code + ms-elapsed footer.
 *
 * @remarks
 * The spawned `WebContainerProcess` is killed when the user re-runs
 * mid-stream OR the component unmounts (via the `useEffect` cleanup).
 * Output is appended in chunks, capped at `MAX_LINES` to keep the DOM
 * cheap on long-running builds.
 *
 * @example
 * import BuildOutputTab from '~/components/workbench/extensions/tabs/BuildOutputTab';
 * // mount inside BottomPanelTabs body
 */
import type { WebContainerProcess } from '@webcontainer/api';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { webcontainer } from '~/lib/webcontainer';
import { WORK_DIR } from '~/utils/constants';
import { classNames } from '~/utils/classNames';

const MAX_LINES = 2000;
const FALLBACK_SCRIPTS = ['build', 'dev', 'start', 'test', 'lint'];

interface RunState {
  running: boolean;
  exitCode: number | null;
  startedAt: number | null;
  elapsedMs: number | null;
}

function BuildOutputTab(): JSX.Element {
  const [scripts, setScripts] = useState<string[]>([]);
  const [script, setScript] = useState<string>('build');
  const [lines, setLines] = useState<string[]>([]);
  const [run, setRun] = useState<RunState>({
    running: false,
    exitCode: null,
    startedAt: null,
    elapsedMs: null,
  });

  const procRef = useRef<WebContainerProcess | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Load scripts from package.json on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wc = await webcontainer;
        const raw = await wc.fs.readFile(`${WORK_DIR}/package.json`, 'utf-8');
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
        const keys = Object.keys(pkg.scripts ?? {});
        if (cancelled) {
          return;
        }
        if (keys.length > 0) {
          setScripts(keys);
          setScript((prev) => (keys.includes(prev) ? prev : keys[0]));
        } else {
          setScripts(FALLBACK_SCRIPTS);
        }
      } catch (err) {
        console.warn('BuildOutputTab: could not load package.json scripts', err);
        if (!cancelled) {
          setScripts(FALLBACK_SCRIPTS);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll log to bottom on new lines.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  // Kill on unmount.
  useEffect(() => {
    return () => {
      procRef.current?.kill();
      procRef.current = null;
    };
  }, []);

  const appendChunk = useCallback((chunk: string) => {
    setLines((prev) => {
      const incoming = chunk.split(/\r?\n/);
      const merged = prev.length > 0 ? [...prev.slice(0, -1), prev[prev.length - 1] + incoming[0], ...incoming.slice(1)] : incoming;
      if (merged.length > MAX_LINES) {
        return merged.slice(merged.length - MAX_LINES);
      }
      return merged;
    });
  }, []);

  const runScript = useCallback(async () => {
    procRef.current?.kill();
    setLines([]);
    const startedAt = Date.now();
    setRun({ running: true, exitCode: null, startedAt, elapsedMs: null });
    try {
      const wc = await webcontainer;
      const proc = await wc.spawn('npm', ['run', script]);
      procRef.current = proc;
      proc.output.pipeTo(
        new WritableStream<string>({
          write(data) {
            appendChunk(data);
          },
        }),
      );
      const exitCode = await proc.exit;
      setRun({ running: false, exitCode, startedAt, elapsedMs: Date.now() - startedAt });
      if (procRef.current === proc) {
        procRef.current = null;
      }
    } catch (err) {
      appendChunk(`\n[spawn error] ${String(err)}\n`);
      setRun({ running: false, exitCode: -1, startedAt, elapsedMs: Date.now() - startedAt });
    }
  }, [appendChunk, script]);

  const stopScript = useCallback(() => {
    procRef.current?.kill();
    procRef.current = null;
    setRun((r) => ({ ...r, running: false, elapsedMs: r.startedAt ? Date.now() - r.startedAt : null }));
  }, []);

  const footerLabel = run.running
    ? 'running…'
    : run.exitCode === null
      ? 'idle'
      : `exit ${run.exitCode} · ${run.elapsedMs ?? 0} ms`;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-background-depth-1">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:hammer-duotone text-lg text-bolt-elements-textSecondary" />
        <span className="text-sm text-bolt-elements-textPrimary font-medium">Build Output</span>
        <select
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={run.running}
          className="ml-2 text-xs font-mono px-2 py-1 rounded-md bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary border border-bolt-elements-borderColor"
        >
          {scripts.map((s) => (
            <option key={s} value={s}>
              npm run {s}
            </option>
          ))}
        </select>
        {run.running ? (
          <button
            type="button"
            onClick={stopScript}
            className="ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bolt-elements-button-danger-background hover:bg-bolt-elements-button-danger-backgroundHover text-bolt-elements-button-danger-text text-xs font-medium"
          >
            <div className="i-ph:stop-fill text-sm" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={runScript}
            className="ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text text-xs font-medium"
          >
            <div className="i-ph:play-fill text-sm" />
            Run Build
          </button>
        )}
        <IconButton
          icon="i-ph:eraser"
          size="md"
          title="Clear log"
          onClick={() => setLines([])}
          disabled={run.running}
        />
      </div>
      <div className="flex-1 overflow-auto bg-bolt-elements-terminals-background px-3 py-2">
        <pre className="font-mono text-xs leading-relaxed text-bolt-elements-textPrimary whitespace-pre-wrap break-words">
          {lines.length === 0 ? (
            <span className="text-bolt-elements-textTertiary">
              No output yet. Pick a script and click Run Build.
            </span>
          ) : (
            lines.join('\n')
          )}
        </pre>
        <div ref={logEndRef} />
      </div>
      <div
        className={classNames(
          'px-3 py-1.5 text-xs font-mono border-t border-bolt-elements-borderColor',
          run.exitCode !== null && run.exitCode !== 0
            ? 'text-bolt-elements-icon-error'
            : 'text-bolt-elements-textTertiary',
        )}
      >
        {footerLabel}
      </div>
    </div>
  );
}

export default memo(BuildOutputTab);
