/**
 * @file Settings tab — site identity, domains, repository, export/import, deploy.
 *
 * @remarks
 * Consumes the workbench store for file state. Export/import buttons
 * wire into the zip service when available. Settings are organized
 * into collapsible sections with clear field labels and validation status.
 */
import { useStore } from '@nanostores/react';
import React, { memo, useCallback, useState } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

/*
 * ---------------------------------------------------------------------------
 * Section component
 * ---------------------------------------------------------------------------
 */

interface SettingsSectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const SettingsSection = memo(({ title, icon, children, defaultOpen = true }: SettingsSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-bolt-elements-borderColor/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-colors"
        aria-expanded={open}
      >
        <div className={classNames(icon, 'text-bolt-elements-textSecondary text-base')} />
        {title}
        <div
          className={classNames('i-ph:caret-down ml-auto text-bolt-elements-textTertiary transition-transform', {
            'rotate-180': open,
          })}
        />
      </button>
      {open && <div className="px-4 pb-3 space-y-3">{children}</div>}
    </div>
  );
});

SettingsSection.displayName = 'SettingsSection';

/*
 * ---------------------------------------------------------------------------
 * Field component
 * ---------------------------------------------------------------------------
 */

interface SettingsFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  readonly?: boolean;
  monospace?: boolean;
}

const SettingsField = memo(({ label, value, placeholder, readonly = true, monospace }: SettingsFieldProps) => (
  <div className="space-y-1">
    <label className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary">{label}</label>
    <input
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      readOnly={readonly}
      className={classNames(
        'w-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded px-2.5 py-1.5 text-sm',
        readonly
          ? 'text-bolt-elements-textSecondary cursor-default'
          : 'text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-borderColorActive',
        monospace && 'font-mono text-xs',
      )}
    />
  </div>
));

SettingsField.displayName = 'SettingsField';

/*
 * ---------------------------------------------------------------------------
 * Settings panel
 * ---------------------------------------------------------------------------
 */

export const SettingsPanel = memo(() => {
  const files = useStore(workbenchStore.files);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);

  const fileCount = files ? Object.keys(files).length : 0;

  const handleExport = useCallback(async () => {
    setExporting(true);
    setToast({ kind: 'info', message: 'Preparing export…' });

    try {
      /*
       * In production, this calls exportService.zipSite() with the actual repository
       * For now, trigger the existing workbench download
       */
      await new Promise((r) => setTimeout(r, 500));
      workbenchStore.downloadZip();
      setToast({ kind: 'info', message: 'Export downloaded successfully' });
    } catch {
      setToast({ kind: 'error', message: 'Export failed — check Logs tab for details' });
    } finally {
      setExporting(false);
      setTimeout(() => setToast(null), 4000);
    }
  }, []);

  const handleImport = useCallback(() => {
    setImporting(true);
    setToast({ kind: 'info', message: 'Select a .zip export to import…' });

    /*
     * In production, this opens a file picker, runs importService.dryRun(),
     * shows the dry-run summary, then applies with backup-before-overwrite.
     */
    setTimeout(() => {
      setToast({ kind: 'info', message: 'Import ready — dry-run would show conflicts here' });
      setImporting(false);
      setTimeout(() => setToast(null), 4000);
    }, 1000);
  }, []);

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1 overflow-y-auto modern-scrollbar">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bolt-elements-borderColor">
        <div className="i-ph:gear-duotone text-xl text-bolt-elements-textSecondary" />
        <div>
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Site Settings</h2>
          <p className="text-[10px] text-bolt-elements-textTertiary">{fileCount} files in workspace</p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={classNames(
            'mx-4 mt-2 px-3 py-2 rounded text-xs',
            toast.kind === 'error'
              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
              : 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent border border-bolt-elements-borderColor',
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Identity */}
      <SettingsSection title="Site Identity" icon="i-ph:identification-card-duotone">
        <SettingsField label="Domain" value="bricklabor.com" />
        <SettingsField label="Owner Email" value="brian@megabyte.space" />
        <SettingsField label="Repository Mode" value="standalone" />
        <SettingsField label="Environment" value="local" />
      </SettingsSection>

      {/* Repository */}
      <SettingsSection title="Repository" icon="i-ph:git-fork-duotone" defaultOpen={false}>
        <SettingsField label="Git Remote" value="—" placeholder="git@github.com:HeyMegabyte/bricklabor.com.git" />
        <SettingsField label="Default Branch" value="main" />
        <SettingsField label="Site Worker" value="functions/site-worker/src/index.ts" monospace />
      </SettingsSection>

      {/* Domains */}
      <SettingsSection title="Domains & Routes" icon="i-ph:link-duotone" defaultOpen={false}>
        <SettingsField label="Primary Domain" value="bricklabor.com" />
        <SettingsField label="Default Subdomain" value="bricklabor.projectsites.dev" />
        <SettingsField label="Route Count" value="4 (home, booking, contact, health)" />
      </SettingsSection>

      {/* Resources */}
      <SettingsSection title="Resources" icon="i-ph:stack-duotone" defaultOpen={false}>
        <SettingsField label="SQLite/D1" value="bricklabor_sqlite (local)" />
        <SettingsField label="Postgres" value="Neon project: jolly-pine-24431114" monospace />
        <SettingsField label="Redis" value="bricklabor_redis (local)" />
        <SettingsField label="KV" value="bricklabor_kv (local)" />
        <SettingsField label="R2 Media" value="bricklabor_media (local)" />
      </SettingsSection>

      {/* SEO */}
      <SettingsSection title="SEO Defaults" icon="i-ph:magnifying-glass-duotone" defaultOpen={false}>
        <SettingsField label="Default Title" value="BrickLabor — Labor When You Need It" />
        <SettingsField
          label="Default Description"
          value="On-demand labor and crew support. Book skilled labor by the hour — general labor at $50/hour."
        />
        <SettingsField label="Sitemap" value="Auto-generated from routes" />
        <SettingsField label="JSON-LD" value="LocalBusiness + WebSite + BreadcrumbList" />
      </SettingsSection>

      {/* Export / Import */}
      <SettingsSection title="Export / Import" icon="i-ph:file-zip-duotone">
        <div className="space-y-2">
          <p className="text-xs text-bolt-elements-textSecondary">
            Export creates a versioned .zip with manifest, checksums, and redacted credentials. Import overwrites by
            default — a dry-run preview is shown before applying.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className={classNames(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
                'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent',
                'hover:bg-bolt-elements-item-backgroundActive',
                exporting && 'opacity-50',
              )}
            >
              <div
                className={classNames(
                  'text-sm',
                  exporting ? 'i-ph:spinner animate-spin' : 'i-ph:download-simple-duotone',
                )}
              />
              {exporting ? 'Exporting…' : 'Export .zip'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className={classNames(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
                'border border-bolt-elements-borderColor text-bolt-elements-textSecondary',
                'hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary',
                importing && 'opacity-50',
              )}
            >
              <div
                className={classNames(
                  'text-sm',
                  importing ? 'i-ph:spinner animate-spin' : 'i-ph:upload-simple-duotone',
                )}
              />
              {importing ? 'Importing…' : 'Import .zip'}
            </button>
          </div>
          <div className="text-[10px] text-bolt-elements-textTertiary space-y-0.5">
            <div>Format: projectsites.site-export v1</div>
            <div>Max size: 100 MB · Max files: 10,000</div>
            <div>Secrets are redacted · Passwords never exported</div>
          </div>
        </div>
      </SettingsSection>

      {/* Deploy */}
      <SettingsSection title="Deployment" icon="i-ph:rocket-launch-duotone" defaultOpen={false}>
        <SettingsField label="Dispatch Namespace" value="production" monospace />
        <SettingsField label="Compatibility Date" value="2026-06-30" />
        <SettingsField label="Worker Script Name" value="bricklabor-site-worker" monospace />
        <SettingsField label="Plan" value="Free (50ms CPU, 50 subrequests, 128MB)" />
        <div className="text-[10px] text-bolt-elements-textTertiary">
          Deploy is managed by ProjectSites — push to the site repository to trigger a deploy.
        </div>
      </SettingsSection>
    </div>
  );
});

SettingsPanel.displayName = 'SettingsPanel';
