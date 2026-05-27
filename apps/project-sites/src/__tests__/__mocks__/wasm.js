// Jest stub for `.wasm` imports. Wrangler bundles these into the worker as
// WebAssembly.Module instances at deploy time; in Jest's Node environment we
// hand back a placeholder so module evaluation doesn't crash.
module.exports = {};
module.exports.default = {};
