#!/usr/bin/env node
/**
 * @module cli
 * @description `psctl` — Project Sites CLI entry point.
 *
 * Usage:
 *   psctl auth login [psk_token] [--base-url=https://...]
 *   psctl auth whoami
 *   psctl auth logout
 *   psctl sites list [--limit=20] [--offset=0]
 *   psctl sites get <id>
 *   psctl sites create --from='{"slug":"...","business_name":"..."}'
 *   psctl deploy <site-id>
 *   psctl snapshots list <site-id>
 *   psctl logs tail <site-id>
 *
 * Token stored at ~/.config/psctl/config.json
 * Uses @projectsites/sdk under the hood.
 */

import { authLogin, authWhoami, authLogout } from './commands/auth.js';
import {
  sitesList,
  sitesGet,
  sitesCreate,
  sitesDeploy,
  sitesSnapshots,
  sitesLogs,
} from './commands/sites.js';

const [, , ...argv] = process.argv;
const [command, subcommand, ...rest] = argv;

const HELP = `
psctl — Project Sites CLI

Commands:
  auth login [psk_token] [--base-url=URL]   Save API token to ~/.config/psctl/config.json
  auth whoami                                Show current identity
  auth logout                                Remove saved token
  sites list [--limit=20] [--offset=0]      List your sites
  sites get <id>                             Get a site by ID
  sites create --from='JSON'                 Create a site
  deploy <site-id>                           Trigger a deploy
  snapshots list <site-id>                   List site snapshots
  logs tail <site-id>                        Tail site logs

API docs:   https://projectsites.dev/v1/openapi.json
Admin UI:   https://projectsites.dev/admin/api-tokens
`;

async function main(): Promise<void> {
  switch (command) {
    case 'auth':
      switch (subcommand) {
        case 'login': await authLogin(rest); break;
        case 'whoami': await authWhoami(); break;
        case 'logout': authLogout(); break;
        default: console.log(HELP);
      }
      break;

    case 'sites':
      switch (subcommand) {
        case 'list': await sitesList(rest); break;
        case 'get': await sitesGet(rest); break;
        case 'create': await sitesCreate(rest); break;
        default: console.log(HELP);
      }
      break;

    case 'deploy':
      await sitesDeploy([subcommand, ...rest].filter((s): s is string => typeof s === 'string')); break;

    case 'snapshots':
      switch (subcommand) {
        case 'list': await sitesSnapshots(rest); break;
        default: console.log(HELP);
      }
      break;

    case 'logs':
      switch (subcommand) {
        case 'tail': await sitesLogs(rest); break;
        default: console.log(HELP);
      }
      break;

    case '--help':
    case '-h':
    case 'help':
    case undefined:
      console.log(HELP);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
