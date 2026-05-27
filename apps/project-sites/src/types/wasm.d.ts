/**
 * @module types/wasm
 * @description Module declarations for `.wasm` imports. Wrangler bundles `.wasm`
 * files as `WebAssembly.Module` instances at build time; TypeScript needs to
 * know the import is valid.
 */

declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
