/**
 * Pure TwiML + persona helpers for the Twilio voice receptionist.
 *
 * No I/O — these functions only transform inputs into strings/objects so they
 * can be unit-tested without D1, fetch, KV, or env. The worker route that
 * answers an incoming Twilio call uses {@link buildIncomingCallTwiML} to emit
 * a `<Connect><Stream>` that bridges the caller's media to our WebSocket relay,
 * and {@link resolveVoicePersona} to derive the AI receptionist's identity from
 * the owning site record.
 */

/**
 * Thrown when an argument to a TwiML builder is structurally invalid (e.g. a
 * media-stream URL that is not a secure `wss://` WebSocket URL).
 *
 * @remarks
 * Declared in-file so callers can `catch (e) { if (e instanceof VoiceTwimlError) … }`
 * for precise handling per the repo's typed-error convention.
 */
export class VoiceTwimlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceTwimlError';
  }
}

/**
 * XML-escape a value for safe inclusion in TwiML text or attribute content.
 *
 * Escapes the five XML predefined entities (`&`, `<`, `>`, `"`, `'`). `&` is
 * replaced first so already-escaped entities are not double-escaped wrongly.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the TwiML returned to Twilio when a call comes in to a receptionist line.
 *
 * @remarks
 * Emits a `<Response>` that optionally speaks a `<Say>` greeting, then opens a
 * bidirectional media `<Stream>` via `<Connect>` to `wsUrl` — Twilio streams the
 * caller's audio to that WebSocket and plays back whatever we send. The greeting
 * and URL are XML-escaped so ampersands and quotes in business names or query
 * strings cannot break the document. `wsUrl` MUST be a `wss://` URL — Twilio
 * Media Streams only accept secure WebSockets.
 *
 * @param opts.wsUrl - Secure (`wss://`) WebSocket URL Twilio connects the media stream to.
 * @param opts.greeting - Optional spoken line played before the stream connects.
 * @returns A complete TwiML document string (XML declaration + `<Response>`).
 *
 * @example
 * ```ts
 * buildIncomingCallTwiML({ wsUrl: 'wss://voice.example.com/relay', greeting: 'Hi!' });
 * // <?xml version="1.0" encoding="UTF-8"?><Response><Say>Hi!</Say><Connect><Stream url="wss://voice.example.com/relay"/></Connect></Response>
 * ```
 *
 * @throws {VoiceTwimlError} when `wsUrl` is not a `wss://` URL.
 * @see {@link resolveVoicePersona}
 */
export function buildIncomingCallTwiML(opts: { wsUrl: string; greeting?: string }): string {
  const { wsUrl, greeting } = opts;
  if (typeof wsUrl !== 'string' || !wsUrl.startsWith('wss://')) {
    throw new VoiceTwimlError(`wsUrl must be a wss:// URL, received: ${String(wsUrl)}`);
  }
  const say = greeting ? `<Say>${escapeXml(greeting)}</Say>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response>${say}<Connect><Stream url="${escapeXml(wsUrl)}"/></Connect></Response>`
  );
}

/** Resolved receptionist persona used to drive greeting + AI voice synthesis. */
export interface VoicePersona {
  /** Display name of the receptionist / business (e.g. "Acme Plumbing"). */
  name: string;
  /** First line spoken to the caller. */
  greeting: string;
  /** TTS voice identifier (defaults to `'rachel'`). */
  voiceId: string;
  /** System instruction steering the receptionist LLM. */
  systemPrompt: string;
}

/** Shape of a persona override embedded on a site record. */
interface VoicePersonaOverride {
  name?: unknown;
  greeting?: unknown;
  voiceId?: unknown;
  systemPrompt?: unknown;
}

function isObject(value: unknown): value is VoicePersonaOverride {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Derive a complete voice receptionist persona from a site record.
 *
 * @remarks
 * Pure and total — never throws and never performs I/O. Builds sensible
 * defaults from the site's `business_name`, then lets an optional
 * `voice_persona` object override any of `name`, `greeting`, `voiceId`, or
 * `systemPrompt`. Non-string override fields and non-object `voice_persona`
 * values are ignored so a malformed D1 column can never crash call answering.
 * The default greeting is regenerated from the (possibly overridden) name
 * unless an explicit greeting override is supplied.
 *
 * @param site.business_name - Owning business name; falls back to `'the front desk'`.
 * @param site.voice_persona - Optional object overriding any persona field.
 * @returns A fully-populated {@link VoicePersona}.
 *
 * @example
 * ```ts
 * resolveVoicePersona({ business_name: 'Acme Plumbing' });
 * // { name: 'Acme Plumbing', greeting: 'Thanks for calling Acme Plumbing. How can I help?',
 * //   voiceId: 'rachel', systemPrompt: '…' }
 *
 * resolveVoicePersona({ business_name: 'Acme', voice_persona: { voiceId: 'adam' } });
 * // { …, voiceId: 'adam' }
 * ```
 *
 * @see {@link buildIncomingCallTwiML}
 */
export function resolveVoicePersona(site: {
  business_name?: string | null;
  voice_persona?: unknown;
}): VoicePersona {
  const override = isObject(site.voice_persona) ? site.voice_persona : {};

  const business =
    typeof site.business_name === 'string' && site.business_name.trim().length > 0
      ? site.business_name.trim()
      : 'the front desk';

  const name = typeof override.name === 'string' && override.name.trim().length > 0
    ? override.name.trim()
    : business;

  const greeting =
    typeof override.greeting === 'string' && override.greeting.trim().length > 0
      ? override.greeting.trim()
      : `Thanks for calling ${name}. How can I help?`;

  const voiceId =
    typeof override.voiceId === 'string' && override.voiceId.trim().length > 0
      ? override.voiceId.trim()
      : 'rachel';

  const systemPrompt =
    typeof override.systemPrompt === 'string' && override.systemPrompt.trim().length > 0
      ? override.systemPrompt.trim()
      : `You are the friendly, concise voice receptionist for ${name}. ` +
        'Greet callers warmly, answer questions about hours, services, and location, ' +
        'capture the caller name and reason for calling, and offer to take a message or ' +
        'book an appointment. Keep replies short and natural for speech. If you do not ' +
        'know an answer, say so and offer to have someone follow up.';

  return { name, greeting, voiceId, systemPrompt };
}
