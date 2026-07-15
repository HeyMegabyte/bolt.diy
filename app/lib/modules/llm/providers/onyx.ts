import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

/**
 * OnyxProvider — AI knowledge platform at ai.projectsites.dev.
 *
 * Routes chat through Onyx's OpenAI-compatible API. Onyx enriches each
 * request with RAG context from indexed knowledge sources before forwarding
 * to the underlying model. Uses a service-level API key (not per-user).
 *
 * Graceful fallback: the chat handler wraps calls with a 3s timeout.
 * On timeout, retry with a direct provider (no RAG). The provider itself
 * is a thin OpenAI-compatible passthrough — Onyx is the value-add layer.
 */
export default class OnyxProvider extends BaseProvider {
  name = 'Onyx';
  getApiKeyLink = 'https://ai.projectsites.dev/admin/api-keys';

  config = {
    apiTokenKey: 'ONYX_API_KEY',
    baseUrlKey: 'ONYX_BASE_URL',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'onyx-default',
      label: 'Onyx (RAG-enhanced)',
      provider: 'Onyx',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 16384,
    },
    {
      name: 'onyx-fast',
      label: 'Onyx Fast (RAG-enhanced)',
      provider: 'Onyx',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey, baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'ONYX_BASE_URL',
      defaultApiTokenKey: 'ONYX_API_KEY',
    });

    if (!apiKey) {
      return this.staticModels;
    }

    const onyxBase = baseUrl || 'https://ai.projectsites.dev';

    try {
      const res = await fetch(`${onyxBase}/api/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        return this.staticModels;
      }

      const data = (await res.json()) as any;
      const models = data.models || data.data || [];

      return models.map((m: any) => ({
        name: m.id || m.name,
        label: `${m.label || m.id || m.name} (RAG)`,
        provider: this.name,
        maxTokenAllowed: m.context_window || 200000,
        maxCompletionTokens: 16384,
      }));
    } catch {
      return this.staticModels;
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey, baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'ONYX_BASE_URL',
      defaultApiTokenKey: 'ONYX_API_KEY',
    });

    const onyxBase = baseUrl || 'https://ai.projectsites.dev';

    if (!apiKey) {
      throw new Error(
        `Missing ONYX_API_KEY for ${this.name} provider. ` +
        `Get one at ${this.getApiKeyLink}`
      );
    }

    const openai = createOpenAI({
      baseURL: `${onyxBase}/api/chat`,
      apiKey,
      fetch: async (url, init) => {
        // Add Onyx-specific headers for RAG context and source attribution
        const headers = new Headers(init?.headers);
        headers.set('X-Onyx-Include-Sources', 'true');
        headers.set('X-Onyx-Stream', 'true');

        return fetch(url, { ...init, headers });
      },
    });

    return openai(model);
  }
}
