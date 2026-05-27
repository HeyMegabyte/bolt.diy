/**
 * @file EnvVarsTab — read/edit `.env`, `.env.local`, `.env.production`
 * from the WebContainer workspace root and surface them as a masked,
 * editable key/value table.
 *
 * @remarks
 * Parses KEY=VALUE lines, ignoring comments (`#`) and blank lines.
 * Quoted values (`"…"` / `'…'`) are unwrapped on read and re-wrapped on
 * write when the value contains whitespace or `#`. Writes go directly
 * back to WebContainer FS via `wc.fs.writeFile` — there's no backend.
 *
 * @example
 * import EnvVarsTab from '~/components/workbench/extensions/tabs/EnvVarsTab';
 * // mount inside BottomPanelTabs registry
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { webcontainer } from '~/lib/webcontainer';
import { WORK_DIR } from '~/utils/constants';
import { classNames } from '~/utils/classNames';

type EnvFile = '.env' | '.env.local' | '.env.production';
const ENV_FILES: readonly EnvFile[] = ['.env', '.env.local', '.env.production'] as const;

interface EnvRow {
  key: string;
  value: string;
  revealed: boolean;
  editing: boolean;
  draftKey: string;
  draftValue: string;
}

function parseEnv(text: string): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    rows.push({ key, value });
  }
  return rows;
}

function serializeEnv(rows: EnvRow[]): string {
  return rows
    .map((r) => {
      const needsQuote = /[\s#]/.test(r.value);
      const v = needsQuote ? `"${r.value.replace(/"/g, '\\"')}"` : r.value;
      return `${r.key}=${v}`;
    })
    .join('\n') + '\n';
}

function EnvVarsTab(): JSX.Element {
  const [activeFile, setActiveFile] = useState<EnvFile>('.env');
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const loadFile = useCallback(async (file: EnvFile) => {
    setLoading(true);
    setStatus('');
    try {
      const wc = await webcontainer;
      let text = '';
      try {
        text = await wc.fs.readFile(`${WORK_DIR}/${file}`, 'utf-8');
      } catch {
        text = '';
      }
      setRows(
        parseEnv(text).map((r) => ({
          ...r,
          revealed: false,
          editing: false,
          draftKey: r.key,
          draftValue: r.value,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFile(activeFile);
  }, [activeFile, loadFile]);

  const persist = useCallback(
    async (next: EnvRow[]) => {
      try {
        const wc = await webcontainer;
        await wc.fs.writeFile(`${WORK_DIR}/${activeFile}`, serializeEnv(next));
        setStatus(`Saved ${activeFile}`);
        window.setTimeout(() => setStatus(''), 2000);
      } catch (err) {
        console.warn('EnvVarsTab: write failed', err);
        setStatus('Save failed');
      }
    },
    [activeFile],
  );

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { key: '', value: '', revealed: true, editing: true, draftKey: '', draftValue: '' },
    ]);
  }, []);

  const commitRow = useCallback(
    (idx: number) => {
      setRows((prev) => {
        const next = prev.map((r, i) =>
          i === idx
            ? { ...r, key: r.draftKey.trim(), value: r.draftValue, editing: false }
            : r,
        );
        void persist(next.filter((r) => r.key));
        return next;
      });
    },
    [persist],
  );

  const deleteRow = useCallback(
    (idx: number) => {
      setRows((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-background-depth-1">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:key-duotone text-lg text-bolt-elements-textSecondary" />
        <span className="text-sm text-bolt-elements-textPrimary font-medium">Env Vars</span>
        <div className="flex items-center gap-1 ml-3">
          {ENV_FILES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFile(f)}
              className={classNames(
                'text-xs px-2 py-1 rounded-md font-mono',
                activeFile === f
                  ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary',
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-bolt-elements-textTertiary ml-2">{status}</span>
        <button
          type="button"
          onClick={addRow}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text text-xs font-medium"
        >
          <div className="i-ph:plus text-sm" />
          Add Variable
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-bolt-elements-textTertiary text-sm">
            Loading {activeFile}…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:key-duotone text-3xl" />
            <span>No variables in {activeFile} — click Add Variable.</span>
          </div>
        ) : (
          <ul className="divide-y divide-bolt-elements-borderColor">
            {rows.map((row, idx) => (
              <li key={idx} className="flex items-center gap-2 px-3 py-2 hover:bg-bolt-elements-background-depth-2">
                {row.editing ? (
                  <>
                    <input
                      autoFocus
                      className="font-mono text-xs px-2 py-1 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary border border-bolt-elements-borderColor min-w-[10rem]"
                      placeholder="KEY"
                      value={row.draftKey}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, draftKey: e.target.value } : r)),
                        )
                      }
                    />
                    <input
                      className="font-mono text-xs px-2 py-1 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary border border-bolt-elements-borderColor flex-1"
                      placeholder="value"
                      value={row.draftValue}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, draftValue: e.target.value } : r)),
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitRow(idx);
                        }
                      }}
                    />
                    <IconButton icon="i-ph:check" size="md" title="Save" onClick={() => commitRow(idx)} />
                  </>
                ) : (
                  <>
                    <span className="font-mono text-xs text-bolt-elements-textPrimary min-w-[10rem] truncate">
                      {row.key}
                    </span>
                    <span className="font-mono text-xs text-bolt-elements-textSecondary flex-1 truncate">
                      {row.revealed ? row.value : '•'.repeat(Math.min(row.value.length, 16) || 6)}
                    </span>
                    <IconButton
                      icon={row.revealed ? 'i-ph:eye-slash' : 'i-ph:eye'}
                      size="md"
                      title={row.revealed ? 'Hide value' : 'Reveal value'}
                      onClick={() =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, revealed: !r.revealed } : r)),
                        )
                      }
                    />
                    <IconButton
                      icon="i-ph:pencil-simple"
                      size="md"
                      title="Edit"
                      onClick={() =>
                        setRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, editing: true, draftKey: r.key, draftValue: r.value } : r,
                          ),
                        )
                      }
                    />
                    <IconButton icon="i-ph:trash" size="md" title="Delete" onClick={() => deleteRow(idx)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(EnvVarsTab);
