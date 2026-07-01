import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'

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
