/**
 * @module psctl
 * @description Config + auth helpers for the psctl CLI.
 *
 * Token is stored at `~/.config/psctl/config.json` (XDG-ish).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ProjectSitesClient } from '@projectsites/sdk';

export interface PsctlConfig {
  apiToken: string;
  baseUrl?: string;
}

const CONFIG_DIR = join(homedir(), '.config', 'psctl');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function loadConfig(): PsctlConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as PsctlConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: PsctlConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, '{}', 'utf8');
  }
}

export function getClient(): ProjectSitesClient {
  const config = loadConfig();
  if (!config?.apiToken) {
    console.error('Not logged in. Run: psctl auth login');
    process.exit(1);
  }
  return new ProjectSitesClient({ apiToken: config.apiToken, baseUrl: config.baseUrl });
}
