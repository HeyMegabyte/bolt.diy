import { Injectable, signal, computed } from '@angular/core';

/**
 * SlashCommand — a single `/`-prefixed dashboard verb the user can either
 * type in the chat input or click via the pill row.
 */
export interface SlashCommand {
  /** The raw verb without the leading slash, e.g. `'snapshot'`. */
  id: string;
  /** Display label shown in the palette + pill row. */
  label: string;
  /** Short description shown in the palette + as pill tooltip. */
  description: string;
  /** Lucide-style glyph name routed to a tiny SVG sprite map. */
  glyph: string;
  /** Optional placeholder appended after the verb on click, e.g. `<slug>`. */
  argHint?: string;
  /**
   * If true, clicking the pill submits the command immediately rather than
   * just pre-filling the input. Defaults to true — Perplexity-style "click
   * and answer".
   */
  autoSubmit?: boolean;
  /** Display-only pill grouping (Sites · Forms · Apps · Calendar). */
  pillGroup?: 'core' | 'data' | 'ops' | 'meta';
}

/**
 * Central registry for the 14 dashboard slash commands. Every feature in
 * the app surfaces here. The chat palette + pill row both read from this
 * service so adding a new feature = one entry, two places auto-update.
 */
@Injectable({ providedIn: 'root' })
export class SlashCommandRegistryService {
  private readonly _commands = signal<SlashCommand[]>([
    {
      id: 'site',
      label: 'Sites',
      description: 'Switch the active site or list all of yours',
      glyph: 'globe',
      argHint: '<slug>',
      pillGroup: 'core',
      autoSubmit: false,
    },
    {
      id: 'snapshot',
      label: 'Snapshots',
      description: 'List recent snapshots or `snapshot new <name>` to capture one',
      glyph: 'camera',
      pillGroup: 'core',
    },
    {
      id: 'deploy',
      label: 'Deploy',
      description: 'Kick off a deploy of the current site',
      glyph: 'rocket',
      pillGroup: 'core',
    },
    {
      id: 'forms',
      label: 'Forms',
      description: 'Recent form submissions',
      glyph: 'inbox',
      pillGroup: 'data',
    },
    {
      id: 'inbox',
      label: 'Inbox',
      description: 'Pulse Inbox — `inbox unassigned` jumps to that filter',
      glyph: 'message',
      argHint: 'unassigned|mine|open',
      pillGroup: 'data',
      autoSubmit: false,
    },
    {
      id: 'audit',
      label: 'Audit',
      description: 'Recent privileged actions across your org',
      glyph: 'shield',
      pillGroup: 'data',
    },
    {
      id: 'analytics',
      label: 'Analytics',
      description: 'Show traffic — `analytics 7d|30d|90d`',
      glyph: 'chart',
      argHint: '7d|30d|90d',
      pillGroup: 'data',
    },
    {
      id: 'billing',
      label: 'Billing',
      description: 'Subscription status + 30-day cost forecast',
      glyph: 'credit-card',
      pillGroup: 'ops',
    },
    {
      id: 'import',
      label: 'Import',
      description: 'Paste a URL to clone & enhance — `import https://…`',
      glyph: 'download',
      argHint: '<url>',
      pillGroup: 'ops',
      autoSubmit: false,
    },
    {
      id: 'calendar',
      label: 'Calendar',
      description: 'Full Google-Calendar-like surface (`calendar new event` to create)',
      glyph: 'calendar',
      pillGroup: 'core',
    },
    {
      id: 'schedule',
      label: 'Schedule',
      description: 'Cal.com-style meeting picker',
      glyph: 'clock',
      pillGroup: 'core',
    },
    {
      id: 'app',
      label: 'Apps',
      description: 'Open Apps catalog entry — `app <slug>`',
      glyph: 'grid',
      argHint: '<slug>',
      pillGroup: 'ops',
      autoSubmit: false,
    },
    {
      id: 'social',
      label: 'Social',
      description:
        'Compose, schedule, analyze across 11 networks — `social new`, `social compose <topic>`, `social analytics`',
      glyph: 'megaphone',
      argHint: 'new | compose <topic> | analytics',
      pillGroup: 'ops',
      autoSubmit: false,
    },
    {
      id: 'inbox',
      label: 'Inbox',
      description:
        'Unified conversations — `inbox metrics` for CSAT + response time, `inbox unassigned` for the queue',
      glyph: 'inbox',
      argHint: 'metrics | unassigned',
      pillGroup: 'data',
      autoSubmit: false,
    },
    {
      id: 'draft',
      label: 'Draft reply',
      description:
        'When a conversation is in context, drafts 3 reply tones (concise / warm / formal)',
      glyph: 'inbox',
      argHint: 'reply',
      pillGroup: 'ops',
      autoSubmit: false,
    },
    {
      id: 'docs',
      label: 'Docs',
      description: 'Open the interactive API explorer',
      glyph: 'book',
      pillGroup: 'meta',
    },
    {
      id: 'help',
      label: 'Help',
      description: 'Slash command reference',
      glyph: 'help',
      pillGroup: 'meta',
    },
    {
      id: 'editor',
      label: 'Editor',
      description: 'Jump to the bolt.diy AI code editor',
      glyph: 'code',
      pillGroup: 'meta',
    },
  ]);

  readonly commands = computed(() => this._commands());

  /**
   * Fuzzy-search commands by query — substring + position-scored, returns
   * the top 8 matches. Used by the slash palette.
   */
  search(query: string): SlashCommand[] {
    const raw = query.trim().toLowerCase().replace(/^\//, '');
    if (!raw) return this._commands();
    return this._commands()
      .map((c) => ({ c, score: this.score(raw, c) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.c);
  }

  private score(q: string, cmd: SlashCommand): number {
    const hay = `${cmd.id} ${cmd.label} ${cmd.description}`.toLowerCase();
    if (cmd.id.startsWith(q)) return 100 - cmd.id.length;
    if (cmd.id.includes(q)) return 60;
    if (hay.includes(q)) return 30;
    // Fuzzy in-order character match — every char of q present in order.
    let i = 0;
    for (const ch of hay) if (ch === q[i]) i++;
    return i === q.length ? 10 : 0;
  }

  /**
   * Resolve a raw user input string ("/snapshot new daily") into
   * { id, arg } for downstream routing. Returns null for non-slash input.
   */
  parse(input: string): { id: string; arg: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;
    const [head, ...rest] = trimmed.slice(1).split(/\s+/);
    return { id: (head ?? '').toLowerCase(), arg: rest.join(' ').trim() };
  }
}
