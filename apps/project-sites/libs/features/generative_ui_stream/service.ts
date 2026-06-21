import type { Env } from '../../../src/types/env.js';
import type { UiDescriptor } from './schemas.js';

export const FLAG_KEY = 'generative_ui_stream';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM_PROMPT = `You are a UI composition engine. Given a natural language prompt, return a JSON array of UI descriptor objects.
Each object must have exactly two fields: "component" (string, component name) and "props" (object, component props).
Return ONLY valid JSON with no markdown or explanation. Example: [{"component":"HeroSection","props":{"title":"Welcome","cta":"Get Started"}}]`;

export async function generateUiDescriptors(
  env: Env,
  prompt: string,
  context?: string,
): Promise<UiDescriptor[]> {
  const userContent = context ? `Context: ${context}\n\nRequest: ${prompt}` : prompt;

  try {
    const ai = env.AI as { run: (model: string, params: { messages: { role: string; content: string }[] }) => Promise<{ response?: string }> };
    const result = await ai.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    if (!result?.response) return fallbackDescriptors(prompt);

    const parsed = JSON.parse(result.response.trim()) as unknown;
    if (!Array.isArray(parsed)) return fallbackDescriptors(prompt);

    return (parsed as unknown[])
      .filter((item): item is UiDescriptor =>
        typeof item === 'object' && item !== null &&
        'component' in item && typeof (item as { component: unknown }).component === 'string' &&
        'props' in item && typeof (item as { props: unknown }).props === 'object',
      )
      .slice(0, 20);
  } catch {
    return fallbackDescriptors(prompt);
  }
}

function fallbackDescriptors(prompt: string): UiDescriptor[] {
  return [{ component: 'TextBlock', props: { content: `Could not generate UI for: ${prompt.slice(0, 100)}` } }];
}
