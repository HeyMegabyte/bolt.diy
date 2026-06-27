/**
 * voice_twiml — pure TwiML + persona builders for the Twilio voice receptionist.
 *
 * These are I/O-free transforms, so the suite asserts exact string shape and
 * security-relevant escaping with no mocks:
 *   1. TwiML shape with and without a greeting,
 *   2. XML-escaping of every predefined entity in both URL and greeting,
 *   3. VoiceTwimlError on a non-wss URL,
 *   4. persona defaults, field-by-field overrides, and business_name fallback.
 */
import {
  buildIncomingCallTwiML,
  resolveVoicePersona,
  VoiceTwimlError,
} from '../services/voice_twiml.js';

const WS = 'wss://voice.example.com/relay';

describe('buildIncomingCallTwiML', () => {
  it('emits Connect/Stream without a Say when no greeting given', () => {
    const twiml = buildIncomingCallTwiML({ wsUrl: WS });
    expect(twiml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        `<Response><Connect><Stream url="${WS}"/></Connect></Response>`,
    );
    expect(twiml).not.toContain('<Say>');
  });

  it('includes a Say element when a greeting is provided', () => {
    const twiml = buildIncomingCallTwiML({ wsUrl: WS, greeting: 'Hello there' });
    expect(twiml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Say>Hello there</Say>' +
        `<Connect><Stream url="${WS}"/></Connect></Response>`,
    );
  });

  it('opens with the XML declaration', () => {
    expect(buildIncomingCallTwiML({ wsUrl: WS })).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>/,
    );
  });

  it('XML-escapes an ampersand in the wsUrl', () => {
    const url = 'wss://voice.example.com/relay?a=1&b=2';
    const twiml = buildIncomingCallTwiML({ wsUrl: url });
    expect(twiml).toContain('url="wss://voice.example.com/relay?a=1&amp;b=2"');
    expect(twiml).not.toContain('&b=2'); // raw ampersand must not survive
  });

  it('XML-escapes every predefined entity in the greeting', () => {
    const greeting = `Tom & Jerry's "5 < 10 > 3" diner`;
    const twiml = buildIncomingCallTwiML({ wsUrl: WS, greeting });
    expect(twiml).toContain('<Say>Tom &amp; Jerry&apos;s &quot;5 &lt; 10 &gt; 3&quot; diner</Say>');
    // No raw special characters should remain inside the Say body.
    const sayBody = twiml.slice(twiml.indexOf('<Say>') + 5, twiml.indexOf('</Say>'));
    expect(sayBody).not.toMatch(/[<>"']/);
    expect(sayBody).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('throws VoiceTwimlError for a non-wss URL', () => {
    expect(() => buildIncomingCallTwiML({ wsUrl: 'https://example.com' })).toThrow(VoiceTwimlError);
    expect(() => buildIncomingCallTwiML({ wsUrl: 'ws://insecure.example.com' })).toThrow(
      VoiceTwimlError,
    );
    expect(() => buildIncomingCallTwiML({ wsUrl: '' })).toThrow(VoiceTwimlError);
    // @ts-expect-error — runtime guard against a non-string url
    expect(() => buildIncomingCallTwiML({ wsUrl: null })).toThrow(VoiceTwimlError);
  });

  it('carries a descriptive message on the thrown error', () => {
    try {
      buildIncomingCallTwiML({ wsUrl: 'http://nope' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(VoiceTwimlError);
      expect((e as VoiceTwimlError).name).toBe('VoiceTwimlError');
      expect((e as VoiceTwimlError).message).toContain('wss://');
    }
  });
});

describe('resolveVoicePersona', () => {
  it('builds defaults from business_name', () => {
    const p = resolveVoicePersona({ business_name: 'Acme Plumbing' });
    expect(p.name).toBe('Acme Plumbing');
    expect(p.greeting).toBe('Thanks for calling Acme Plumbing. How can I help?');
    expect(p.voiceId).toBe('rachel');
    expect(p.systemPrompt).toContain('Acme Plumbing');
    expect(p.systemPrompt.length).toBeGreaterThan(20);
  });

  it('falls back to "the front desk" when business_name is missing', () => {
    expect(resolveVoicePersona({}).name).toBe('the front desk');
    expect(resolveVoicePersona({}).greeting).toBe(
      'Thanks for calling the front desk. How can I help?',
    );
  });

  it('falls back when business_name is null, empty, or whitespace', () => {
    for (const business_name of [null, '', '   '] as const) {
      const p = resolveVoicePersona({ business_name });
      expect(p.name).toBe('the front desk');
    }
  });

  it('lets a voice_persona object override every field', () => {
    const p = resolveVoicePersona({
      business_name: 'Acme',
      voice_persona: {
        name: 'Nova',
        greeting: 'Acme here, what do you need?',
        voiceId: 'adam',
        systemPrompt: 'Be terse.',
      },
    });
    expect(p).toEqual({
      name: 'Nova',
      greeting: 'Acme here, what do you need?',
      voiceId: 'adam',
      systemPrompt: 'Be terse.',
    });
  });

  it('regenerates the greeting from an overridden name when no greeting override', () => {
    const p = resolveVoicePersona({
      business_name: 'Acme',
      voice_persona: { name: 'Nova' },
    });
    expect(p.name).toBe('Nova');
    expect(p.greeting).toBe('Thanks for calling Nova. How can I help?');
    expect(p.voiceId).toBe('rachel');
  });

  it('overrides only voiceId, keeping other defaults', () => {
    const p = resolveVoicePersona({
      business_name: 'Acme',
      voice_persona: { voiceId: 'bella' },
    });
    expect(p.voiceId).toBe('bella');
    expect(p.name).toBe('Acme');
    expect(p.greeting).toBe('Thanks for calling Acme. How can I help?');
  });

  it('ignores a non-object voice_persona and blank/non-string override fields', () => {
    const fromString = resolveVoicePersona({
      business_name: 'Acme',
      voice_persona: 'not-an-object',
    });
    expect(fromString.name).toBe('Acme');
    expect(fromString.voiceId).toBe('rachel');

    const fromBadFields = resolveVoicePersona({
      business_name: 'Acme',
      voice_persona: { name: '   ', voiceId: 42 },
    });
    expect(fromBadFields.name).toBe('Acme');
    expect(fromBadFields.voiceId).toBe('rachel');
  });

  it('trims surrounding whitespace on business_name and overrides', () => {
    const p = resolveVoicePersona({
      business_name: '  Acme  ',
      voice_persona: { voiceId: '  adam  ' },
    });
    expect(p.name).toBe('Acme');
    expect(p.voiceId).toBe('adam');
  });
});
