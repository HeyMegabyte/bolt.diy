import { createAction } from '@activepieces/piece-framework';
import { nangoApi } from '../common';

export const nangoGetConnection = createAction({
  name: 'get_connection',
  displayName: 'Get OAuth Connection',
  description: 'Retrieve an OAuth connection and access token from Nango for a specific provider.',
  requireAuth: true,
  props: {
    connectionId: {
      name: 'connection_id',
      displayName: 'Connection ID',
      description: 'The Nango connection ID (e.g. "google-123" or UUID).',
      type: 'SHORT_TEXT' as const,
      required: true,
    },
    provider: {
      name: 'provider',
      displayName: 'Provider',
      description: 'Provider config key (google, github, slack, etc.).',
      type: 'SHORT_TEXT' as const,
      required: true,
    },
  },
  async run({ auth, propsValue }) {
    const { connectionId, provider } = propsValue;
    const connections = await nangoApi(
      auth.nango_api_key as string,
      `/api/v1/connection?connectionId=${encodeURIComponent(connectionId)}&provider=${encodeURIComponent(provider)}`,
    ) as { connections: Array<{ id: string; provider: string }> };

    if (!connections.connections?.length) {
      throw new Error(`No connection found for ${provider}/${connectionId}`);
    }

    // Return the connection metadata (token is resolved server-side by Nango)
    return {
      id: connections.connections[0].id,
      provider: connections.connections[0].provider,
      _nango_token_hint: 'Use this connection ID in API calls — Nango injects the live token server-side.',
    };
  },
});
