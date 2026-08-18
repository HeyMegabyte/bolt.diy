import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { createOpenAI } from '@ai-sdk/openai';

/**
 * ProjectSites AI — the worker's custom AI layer (tier routing + conditional
 * Cloudflare AI Gateway). Bolt's chat MUST use this, not per-user provider
 * keys: the worker owns the provider secrets and routes every call through
 * `chooseProviderForTier` → `gatewayFetch` (AI Gateway when `CF_ACCOUNT_ID`
 * is set and `AI_GATEWAY_ENABLED !== "false"`, else the provider directly).
 * This kills the "credit balance too low on the user's Anthropic key" class —
 * the editor never depends on a cookie key again.
 *
 * The endpoint is OpenAI-compatible (`chat/completions` pass-through), so the
 * AI SDK just needs `createOpenAI` pointed at it. The API key is a fixed
 * placeholder — the worker's soft-auth gate accepts the bolt-iframe signal,
 * and provider secrets never reach this process.
 */
export default class ProjectsitesAiProvider extends BaseProvider {
  name = 'ProjectSites AI';

  config = {
    baseUrlKey: 'PS_BOLT_AI_ENDPOINT',
  };

  staticModels: ModelInfo[] = [
    // The worker maps every name to its tier model; these mirror the fork's
    // historical defaults so existing chats/model chips keep resolving.
    { name: 'claude-opus-4-6', label: 'PS AI · Pro (AI Gateway)', provider: this.name, maxTokenAllowed: 200000, maxCompletionTokens: 32000 },
    { name: 'claude-sonnet-4-6', label: 'PS AI · Sonnet (AI Gateway)', provider: this.name, maxTokenAllowed: 200000, maxCompletionTokens: 32000 },
    { name: 'deepseek-chat', label: 'PS AI · Fast (DeepSeek)', provider: this.name, maxTokenAllowed: 64000, maxCompletionTokens: 8192 },
    { name: 'glm-4.6', label: 'PS AI · GLM-4.6', provider: this.name, maxTokenAllowed: 200000, maxCompletionTokens: 65536 },
  ];

  async getDynamicModels(): Promise<ModelInfo[]> {
    return this.staticModels;
  }

  getModelInstance(options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    // Env-overridable endpoint; the default is the M2M workers.dev URL. The
    // projectsites.dev ZONE challenges non-browser POSTs (Bot Fight Mode)
    // before they reach the worker — the fork's server-side fetch has no
    // browser fingerprint and was 403'd there. workers.dev has no zone WAF.
    // (Per bot-fight-mode-blocks-inbound-webhooks.)
    // BASE ends at /api/bolt: createOpenAI appends /chat/completions → the
    // registered worker route /api/bolt/chat/completions (ending at /chat made
    // the SDK produce /chat/chat/completions → 404 'Unknown API route').
    const serverEnv = options.serverEnv as unknown as Record<string, string> | undefined;
    const endpoint = serverEnv?.PS_BOLT_AI_ENDPOINT || 'https://project-sites.manhattan.workers.dev/api/bolt';
    const openai = createOpenAI({
      baseURL: endpoint,
      apiKey: 'ps-internal',
      // The fork's chat calls the worker SERVER-SIDE (no session cookie, no
      // Origin header) — the worker's soft-auth gate requires this explicit
      // bolt-iframe signal, else every chat 403s ("Custom error: Forbidden").
      headers: { 'x-bolt-origin-check': 'bolt-iframe' },
    });

    return openai(options.model);
  }
}
