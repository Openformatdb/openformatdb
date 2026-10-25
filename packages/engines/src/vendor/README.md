`pandoc-core.js` is `src/core.js` of [pandoc-wasm](https://github.com/nicholasgriffintn/pandoc-wasm)
1.1.0 (GPL-2.0-or-later), copied unchanged: the package's `exports` do not expose it, and its own
entry points fetch the WebAssembly themselves instead of taking the checked bytes.
