import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export interface CapturedImage {
  /** base64-encoded image data, ready to POST to /api/media/upload */
  base64: string;
  /** mime type, e.g. "image/jpeg" */
  format: string;
}

/**
 * Camera bridge for site media uploads.
 *
 * Pulls a photo from the device camera (with `CameraSource.Prompt` to let
 * the user pick camera-vs-library) and returns it as base64. The Angular
 * SPA can then POST this to the worker's `/api/media/upload` endpoint
 * (see apps/project-sites/src/routes/api.ts → media.ts).
 */
export async function captureSiteMedia(): Promise<CapturedImage | null> {
  const photo = await Camera.getPhoto({
    quality: 85,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: CameraSource.Prompt,
    saveToGallery: false,
    width: 2400,
  });

  if (!photo.base64String) return null;

  return {
    base64: photo.base64String,
    format: `image/${photo.format ?? 'jpeg'}`,
  };
}
