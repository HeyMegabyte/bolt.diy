/**
 * Image OCR/caption helper.
 *
 * @remarks
 *   Whisper transcription (`transcribeAudio`) was removed from the editor
 *   surface 2026-05-24. Voice input is handled by the browser
 *   SpeechRecognition API only; the server `/admin-api/transcribe` route
 *   stays live for future debug/support workflows but is no longer wired.
 */

// Absolute URL targeting the projectsites.dev worker — `editor.projectsites.dev`
// POSTs are blocked by zone WAF and `/admin-api/*` is blocked by path WAF.
// See `apps/project-sites/src/routes/bolt_admin.ts` JSDoc for the
// auth + path-migration contract.
const VISION_ENDPOINT = 'https://projectsites.dev/api/bolt/vision-ocr';

export interface VisionResult {
  caption: string;
  ocrText: string;
}

export async function describeImage(dataUrl: string, token?: string): Promise<VisionResult> {
  const res = await fetch(VISION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ image_data_url: dataUrl }),
  });

  if (!res.ok) {
    throw new Error(`Vision failed: ${res.status}`);
  }

  return (await res.json()) as VisionResult;
}
