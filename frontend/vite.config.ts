import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasmPlugin from 'vite-plugin-wasm'

// vite-plugin-wasm's package.json "exports" maps the ESM "import" condition's
// types to dist/index.d.ts, which doesn't match what actually loads at runtime
// (exports/import.mjs, which unwraps the default export). TS therefore sees the
// whole CJS-shaped module object instead of the callable default, so the import
// itself needs a corrective cast rather than the call site.
const wasm = wasmPlugin as unknown as () => Plugin

// https://vite.dev/config/
export default defineConfig({
  // wasm() is required for @midnight-ntwrk/ledger-v8 (and other wasm-bindgen packages in
  // the Midnight SDK) — their browser entry points use the raw ESM
  // `import * as wasm from "./foo.wasm"` syntax, which esbuild doesn't support natively.
  // vite-plugin-top-level-await was skipped: it hard-depends on the `rollup` package via
  // @rollup/plugin-virtual, but this project's Vite 8 uses the rolldown bundler instead of
  // rollup, so `rollup` isn't installed and the plugin fails to load. Not needed here anyway —
  // the ledger-v8 wasm-bindgen glue doesn't use top-level await.
  plugins: [react(), tailwindcss(), wasm()],
})
