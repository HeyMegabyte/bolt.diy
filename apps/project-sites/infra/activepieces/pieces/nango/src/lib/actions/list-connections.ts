import { createAction } from '@activepieces/piece-framework';
import { nangoApi } from '../common';

export const nangoListConnections = createAction({
  name: 'list_connections',
  displayName: 'List OAuth Connections',
  description: 'List all Nango OAuth connections for a customer, optionally filtered by provider.',
  requireAuth: true,
  props: {
    provider: {
      name: 'provider',
      displayName: 'Provider Filter',
      description: 'Optional — only list connections for this provider (google, slack, github, etc.).',
      type: 'SHORT_TEXT' as const,
      required: false,
    },
  },
  async run({ auth, propsValue }) {
    const { provider } = propsValue;
    let path = '/api/v1/connection';
    if (provider) {
      path += `?provider=${encodeURIComponent(provider)}`;
    }

    const data = await nangoApi(auth.nango_api_key as string, path) as {
      connections: Array<{ id: string; provider: string; created_at: string }>;
    };

    return {
      count: data.connections?.length ?? 0,
      connections: (data.connections ?? []).map(c => ({
        id: c.id,
        provider: c.provider,
        created: c.created_at,
      })),
    };
  },
});
