/**
 * @module commands/auth
 * @description `psctl auth login` — persist a psk_* token to ~/.config/psctl/config.json
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { saveConfig, clearConfig, loadConfig, getClient } from '../index.js';

export async function authLogin(args: string[]): Promise<void> {
  const tokenArg = args[0];
  let token: string;

  if (tokenArg && tokenArg.startsWith('psk_')) {
    token = tokenArg;
  } else {
    const rl = readline.createInterface({ input, output });
    token = (await rl.question('Enter your API token (psk_...): ')).trim();
    rl.close();
  }

  if (!token.startsWith('psk_')) {
    console.error('Invalid token format — must start with psk_');
    process.exit(1);
  }

  const baseUrl = args.find((a) => a.startsWith('--base-url='))?.split('=')[1];

  saveConfig({ apiToken: token, ...(baseUrl ? { baseUrl } : {}) });

  // Verify the token works
  const client = getClient();
  try {
    const me = await client.auth.me();
    console.log(`Logged in as org ${me.org.name ?? me.org.id} (${me.scopes.join(', ')})`);
  } catch {
    console.warn('Token saved but could not verify — check the token is valid.');
  }
}

export async function authWhoami(): Promise<void> {
  const config = loadConfig();
  if (!config?.apiToken) {
    console.log('Not logged in. Run: psctl auth login');
    return;
  }
  const client = getClient();
  try {
    const me = await client.auth.me();
    console.log(JSON.stringify(me, null, 2));
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

export function authLogout(): void {
  clearConfig();
  console.log('Logged out — token removed from ~/.config/psctl/config.json');
}
