/**
 * @module pages/developers
 *
 * @description
 * Public `/developers` marketing page — acquisition surface for developers
 * living in Claude Code / Cursor / Cline. Hero IS the MCP connect snippet:
 * a ready-to-paste `.mcp.json` block that wires the ProjectSites MCP server
 * in 30 seconds.
 *
 * @remarks
 * - Standalone OnPush, signals-only.
 * - Brand tokens from `_polish.scss` — no hard-coded hex.
 * - Copy button uses the Clipboard API; degrades silently when unavailable.
 * - No fake stats, no rolling-counter on prose (per cinematic-ui-patterns rule).
 * - Tools list sourced from `libs/features/platform_mcp/README.md` truth.
 *
 * @example
 * ```html
 * <app-developers />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MetaService } from '../../services/meta.service';
import { RevealDirective } from '../../directives/reveal.directive';

/** One MCP tool row shown in the tool table. */
interface McpTool {
  readonly name: string;
  readonly scope: string;
  readonly description: string;
}

/** One step in the "Connect in 30 seconds" guide. */
interface Step {
  readonly n: number;
  readonly title: string;
  readonly body: string;
  readonly url?: string;
  readonly urlLabel?: string;
}

/**
 * `/developers` marketing page — hero-as-MCP-snippet acquisition surface.
 *
 * @remarks
 * Deployed at `projectsites.dev/developers`. No auth required. No admin guard.
 */
@Component({
  selector: 'app-developers',
  standalone: true,
  imports: [RouterLink, RevealDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './developers.component.html',
  styleUrl: './developers.component.scss',
})
export class DevelopersComponent implements OnInit {
  private readonly meta = inject(MetaService);

  /** Clipboard copy state: null=idle, 'copied'=success, 'error'=fail. */
  readonly copyState = signal<null | 'copied' | 'error'>(null);

  /** The exact snippet a developer pastes into .mcp.json or ~/.claude.json. */
  readonly mcpSnippet = `{
  "mcpServers": {
    "projectsites": {
      "type": "http",
      "url": "https://projectsites.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer psk_YOUR_TOKEN"
      }
    }
  }
}`;

  /**
   * OAuth one-click variant — NO token in the file. On first use Claude Code hits
   * a 401 + WWW-Authenticate, auto-discovers the authorization server (RFC 9728 →
   * RFC 8414), opens the browser to approve, and stores the issued token itself.
   */
  readonly oauthSnippet = `{
  "mcpServers": {
    "projectsites": {
      "type": "http",
      "url": "https://projectsites.dev/api/mcp"
    }
  }
}`;
  readonly oauthCopyState = signal<null | 'copied' | 'error'>(null);

  /** 3-step connect guide — text only, no fake time claims. */
  readonly steps: readonly Step[] = [
    {
      n: 1,
      title: 'Mint a token',
      body: 'Open the API Tokens panel in your admin and create a scoped token. Choose `sites:read` for inspection or `sites:write` to also deploy.',
      url: 'https://projectsites.dev/admin/api-tokens',
      urlLabel: 'projectsites.dev/admin/api-tokens →',
    },
    {
      n: 2,
      title: 'Add to .mcp.json',
      body: 'Paste the snippet above into your project `.mcp.json` (or `~/.claude.json` for global access). Replace `psk_YOUR_TOKEN` with the key you just minted.',
    },
    {
      n: 3,
      title: 'Connect in Claude Code',
      body: 'Run `/mcp` inside Claude Code. Select `projectsites` from the list — it\'s live. Ask "list my projectsites" to verify.',
    },
  ];

  /** Tool list sourced from platform_mcp README — only ship what\'s live. */
  readonly tools: readonly McpTool[] = [
    {
      name: 'whoami',
      scope: 'sites:read',
      description: 'Return your org context and active scopes.',
    },
    {
      name: 'list_sites',
      scope: 'sites:read',
      description: 'Enumerate every site in your org with slug, status, and URL.',
    },
    {
      name: 'get_site',
      scope: 'sites:read',
      description: 'Fetch full metadata and config for a specific site by slug or ID.',
    },
    {
      name: 'get_build_status',
      scope: 'sites:read',
      description: 'Poll the latest build and publish status for a site.',
    },
    {
      name: 'deploy_site',
      scope: 'sites:write',
      description: 'Write files to R2, update the manifest, bust the cache, and return the live URL.',
    },
    {
      name: 'create_site',
      scope: 'sites:write',
      description: 'Create a draft site with a unique slug. Follow up with deploy_site to go live.',
    },
  ];

  ngOnInit(): void {
    this.meta.setMeta({
      title: 'Developers — ProjectSites',
      description:
        'Connect ProjectSites to Claude Code in 30 seconds. MCP server at projectsites.dev/api/mcp. Manage and deploy sites without leaving your editor.',
      canonical: 'https://projectsites.dev/developers',
      ogImage: 'https://projectsites.dev/og-developers.png',
    });
  }

  /** Copy the MCP JSON snippet to the system clipboard. */
  async copySnippet(): Promise<void> {
    if (!navigator?.clipboard) {
      this.copyState.set('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(this.mcpSnippet);
      this.copyState.set('copied');
      setTimeout(() => this.copyState.set(null), 2200);
    } catch {
      this.copyState.set('error');
      setTimeout(() => this.copyState.set(null), 2200);
    }
  }

  /** Copy the no-token OAuth MCP JSON snippet to the system clipboard. */
  async copyOauthSnippet(): Promise<void> {
    if (!navigator?.clipboard) {
      this.oauthCopyState.set('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(this.oauthSnippet);
      this.oauthCopyState.set('copied');
      setTimeout(() => this.oauthCopyState.set(null), 2200);
    } catch {
      this.oauthCopyState.set('error');
      setTimeout(() => this.oauthCopyState.set(null), 2200);
    }
  }
}
