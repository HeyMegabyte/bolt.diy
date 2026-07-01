/**
 * @module services/chatwoot_translate
 * @description Multi-language translation pipeline for Chatwoot conversations.
 *
 * Auto-detects message language, translates between agent and customer
 * using Workers AI, and stores bilingual message pairs for audit.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

// ────────────────────────────────────────────────────────
// Language detection
// ────────────────────────────────────────────────────────

const LANG_PATTERNS: Record<string, RegExp[]> = {
  es: [/[áéíóúñ¿¡]/, /\b(el|la|los|las|de|que|en|por|para|con|sin|más|muy)\b/i],
  fr: [/[àâçéèêëîïôûùüÿœæ]/, /\b(le|la|les|de|du|des|est|pas|pour|avec|dans|sur|que)\b/i],
  de: [/[äöüß]/, /\b(der|die|das|und|ist|nicht|mit|auf|für|von|bei|zum|zur)\b/i],
  pt: [/[ãõáéíóúâêôàç]/, /\b(o|a|os|as|de|da|do|em|no|na|que|não|para|com|uma)\b/i],
  it: [/[àèéìòù]/, /\b(il|la|le|di|che|non|per|con|una|sono|del|dal|nel)\b/i],
  nl: [/\b(het|een|van|dat|niet|zijn|voor|met|aan|als|ook|worden|deze|maar)\b/i],
  ja: [/[぀-ゟ゠-ヿ一-鿿]/, /\b(です|ます|した|から|まで|これ|それ|あれ)\b/],
  zh: [/[一-鿿]/, /\b(的|了|是|我|在|不|人|有|这|他|中|大|来|上|国)\b/],
  ar: [/[؀-ۿ]/, /\b(في|من|على|أن|هذا|ذلك|مع|هو|هي|كان|ليس)\b/],
  hi: [/[ऀ-ॿ]/, /\b(है|में|से|का|की|के|और|यह|वह|नहीं|एक)\b/],
  ko: [/[가-힯]/, /\b(입니다|합니다|그리고|하지만|그래서|입니다|있습니다|없습니다)\b/],
};

export function detectLanguage(text: string): string {
  if (!text?.trim()) return 'en';
  let best = 'en';
  let bestScore = 0;
  for (const [lang, patterns] of Object.entries(LANG_PATTERNS)) {
    const score = patterns.filter((p) => p.test(text)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

// ────────────────────────────────────────────────────────
// Translation
// ────────────────────────────────────────────────────────

const TRANSLATE_PROMPT =
  'Translate the following text to {target}. Return ONLY the translated text, no explanation. Preserve formatting, URLs, and email addresses. Text: ';

export async function translateMessage(
  env: Env,
  text: string,
  targetLang: string,
): Promise<string> {
  if (!text?.trim()) return text;
  try {
    const langNames: Record<string, string> = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      pt: 'Portuguese',
      it: 'Italian',
      nl: 'Dutch',
      ja: 'Japanese',
      zh: 'Chinese',
      ar: 'Arabic',
      hi: 'Hindi',
      ko: 'Korean',
    };
    const target = langNames[targetLang] || targetLang;
    const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: TRANSLATE_PROMPT.replace('{target}', target) + text }],
      temperature: 0.1,
      max_tokens: 1000,
    });
    return (result as { response?: string }).response ?? text;
  } catch {
    return text;
  }
}

// ────────────────────────────────────────────────────────
// Translation pair
// ────────────────────────────────────────────────────────

export interface TranslationPair {
  original: string;
  original_lang: string;
  translated: string;
  target_lang: string;
  auto_detected: boolean;
}

export async function translatePair(
  env: Env,
  text: string,
  targetLang = 'en',
): Promise<TranslationPair> {
  const detected = detectLanguage(text);
  if (detected === targetLang) {
    return {
      original: text,
      original_lang: detected,
      translated: text,
      target_lang: targetLang,
      auto_detected: false,
    };
  }
  const translated = await translateMessage(env, text, targetLang);
  return {
    original: text,
    original_lang: detected,
    translated,
    target_lang: targetLang,
    auto_detected: true,
  };
}
