/**
 * Minimal `qrcode` ambient typings — the package ships without
 * declaration files, and `@types/qrcode` isn't worth pulling in for the
 * one helper we use.
 *
 * Source: https://www.npmjs.com/package/qrcode (v1.5.x API surface).
 */
declare module 'qrcode' {
  export interface QRCodeRenderersOptions {
    margin?: number;
    width?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeRenderersOptions,
  ): Promise<void>;

  export function toDataURL(
    text: string,
    options?: QRCodeRenderersOptions,
  ): Promise<string>;

  const _default: {
    toCanvas: typeof toCanvas;
    toDataURL: typeof toDataURL;
  };
  export default _default;
}
