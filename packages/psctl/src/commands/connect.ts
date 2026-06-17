/**
 * @module commands/connect
 * @description `psctl connect` — wire projectsites.dev into an MCP client
 * (Claude Code / Cursor / Cline) by writing the HTTP MCP server entry into
 * `.mcp.json` (project, default) or `~/.claude.json` (global). Reuses the token
 * saved by `psctl auth login` so connecting is one command, zero prompts —
 * the 30-second connect (ROADMAP #2).
 *
 * @example
 * ```sh
 * psctl auth login psk_xxx   # once
 * psctl connect              # writes ./.mcp.json
 * psctl connect --global     # writes ~/.claude.json (every project)
 * ```
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, saveConfig } from '../index.js';
import {
  DEFAULT_BASE_URL,
  buildMcpEntry,
  mergeMcpConfig,
  resolveConfigPath,
  isPskToken,
} from './connect-config.js';

export async function connectCmd(args: string[]): Promise<void> {
  const scope: 'global' | 'project' = args.includes('--global') ? 'global' : 'project';
  const baseUrl =
    args.find((a) => a.startsWith('--base-url='))?.split('=')[1] ??
    loadConfig()?.baseUrl ??
    DEFAULT_BASE_URL;

  // Token resolution: --token= → positional psk_ → saved login → prompt.
  let token: string | undefined =
    args.find((a) => a.startsWith('--token='))?.split('=')[1] ??
    args.find((a) => a.startsWith('psk_')) ??
    loadConfig()?.apiToken;

  if (!isPskToken(token)) {
    console.log(`Mint a token at ${DEFAULT_BASE_URL}/admin/api-tokens (scopes: sites:read, sites:write).`);
    const rl = readline.createInterface({ input, output });
    token = (await rl.question('Paste your API token (psk_...): ')).trim();
    rl.close();
  }
  if (!isPskToken(token)) {
    console.error('Invalid token — must start with psk_.');
    process.exit(1);
  }

  // Remember the token so future psctl commands are authed too.
  if (loadConfig()?.apiToken !== token) {
    saveConfig({ apiToken: token, ...(baseUrl !== DEFAULT_BASE_URL ? { baseUrl } : {}) });
  }

  const path = resolveConfigPath(scope);
  let existing: unknown = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      console.error(`Refusing to overwrite ${path} — it is not valid JSON. Fix or move it, then retry.`);
      process.exit(1);
    }
  }

  const merged = mergeMcpConfig(existing, buildMcpEntry(token, baseUrl));
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  console.log(`✓ Wrote the projectsites MCP server to ${path}`);
  if (scope === 'project') {
    console.log('  ⚠ This file now holds your token — add ".mcp.json" to .gitignore so you do not commit it.');
  }
  console.log(`  Next: open Claude Code ${scope === 'global' ? 'anywhere' : 'in this project'} and run /mcp — "projectsites" is connected.`);
  console.log('  Try: "list my projectsites" · "what is the build status of <site>" · "deploy ./dist to <site>".');
}
