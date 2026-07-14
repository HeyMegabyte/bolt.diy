import { createPiece } from '@activepieces/piece-framework';
import { nangoGetConnection } from './src/lib/actions/get-connection';
import { nangoListConnections } from './src/lib/actions/list-connections';

export const nangoPiece = createPiece({
  displayName: 'Nango OAuth',
  logoUrl: 'https://nango.projectsites.dev/favicon.ico',
  authors: ['Brian Zalewski'],
  auth: [{
    name: 'nango_api_key',
    displayName: 'Nango Secret Key',
    description: 'Your Nango secret key from nango.projectsites.dev',
    required: true,
  }],
  actions: [
    nangoGetConnection,
    nangoListConnections,
  ],
  triggers: [],
});
