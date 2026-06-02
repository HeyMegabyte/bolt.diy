import {
  vanityWordSchema,
  voiceAgentSettingsSchema,
  updateVoiceAgentSettingsSchema,
  purchaseNumberRequestSchema,
  numberSearchResultSchema,
} from '../schemas/voice.js';

/**
 * Coverage for the voice/SMS-agent boundary schemas (voice.ts) — previously a
 * zero-test exported module. Focuses on the input validators (settings update,
 * number purchase) + the E.164 / vanity-word rules that gate Twilio operations.
 */
describe('vanityWordSchema', () => {
  it('accepts 3-7 uppercase letters and uppercases the result', () => {
    expect(vanityWordSchema.parse('STAR')).toBe('STAR');
  });
  it('rejects too-short / too-long / non-letter words', () => {
    expect(vanityWordSchema.safeParse('AB').success).toBe(false);
    expect(vanityWordSchema.safeParse('TOOLONGX').success).toBe(false);
    expect(vanityWordSchema.safeParse('ST4R').success).toBe(false);
  });
});

describe('voiceAgentSettingsSchema defaults', () => {
  it('applies provider + cap + toggle defaults', () => {
    const out = voiceAgentSettingsSchema.parse({
      id: 'a', site_id: 's', created_at: 't', updated_at: 't',
    });
    expect(out.voice_provider).toBe('twilio-callgpt');
    expect(out.max_call_seconds).toBe(600);
    expect(out.recording_enabled).toBe(1);
    expect(out.video_browse_enabled).toBe(1);
  });
});

describe('updateVoiceAgentSettingsSchema', () => {
  it('accepts a valid partial update', () => {
    expect(
      updateVoiceAgentSettingsSchema.safeParse({
        siteId: 'site-1',
        voice_system_prompt: 'Be helpful.',
        max_call_seconds: 900,
        escalation_phone: '+14155551234',
        knowledge_base_urls: ['https://acme.example.com/faq'],
      }).success,
    ).toBe(true);
  });
  it('requires siteId', () => {
    expect(updateVoiceAgentSettingsSchema.safeParse({ voice_model: 'x' }).success).toBe(false);
  });
  it('enforces the max_call_seconds 30-3600 range', () => {
    expect(updateVoiceAgentSettingsSchema.safeParse({ siteId: 's', max_call_seconds: 10 }).success).toBe(false);
    expect(updateVoiceAgentSettingsSchema.safeParse({ siteId: 's', max_call_seconds: 99999 }).success).toBe(false);
  });
  it('rejects a non-E.164 escalation_phone', () => {
    expect(updateVoiceAgentSettingsSchema.safeParse({ siteId: 's', escalation_phone: '4155551234' }).success).toBe(false);
  });
  it('caps mcp_connection_ids + knowledge_base_urls at 20 and rejects bad URLs', () => {
    expect(updateVoiceAgentSettingsSchema.safeParse({ siteId: 's', mcp_connection_ids: Array(21).fill('x') }).success).toBe(false);
    expect(updateVoiceAgentSettingsSchema.safeParse({ siteId: 's', knowledge_base_urls: ['not a url'] }).success).toBe(false);
  });
  it('rejects an over-long voice_system_prompt (> 8000)', () => {
    expect(updateVoiceAgentSettingsSchema.safeParse({ siteId: 's', voice_system_prompt: 'x'.repeat(8001) }).success).toBe(false);
  });
});

describe('purchaseNumberRequestSchema', () => {
  it('accepts a valid E.164 purchase + uppercases the vanity word', () => {
    const out = purchaseNumberRequestSchema.parse({ siteId: 's', phoneNumber: '+14155551234', vanityWord: 'star' });
    expect(out.vanityWord).toBe('STAR');
  });
  it('rejects a non-E.164 phoneNumber and missing siteId', () => {
    expect(purchaseNumberRequestSchema.safeParse({ siteId: 's', phoneNumber: '4155551234' }).success).toBe(false);
    expect(purchaseNumberRequestSchema.safeParse({ phoneNumber: '+14155551234' }).success).toBe(false);
  });
});

describe('numberSearchResultSchema', () => {
  it('requires a 2-char iso_country + full capabilities object', () => {
    const base = {
      phone_number: '+14155551234', friendly_name: '(415) 555-1234',
      locality: 'SF', region: 'CA', iso_country: 'US',
      capabilities: { voice: true, sms: true, mms: false, fax: false },
    };
    expect(numberSearchResultSchema.safeParse(base).success).toBe(true);
    expect(numberSearchResultSchema.safeParse({ ...base, iso_country: 'USA' }).success).toBe(false);
  });
});
