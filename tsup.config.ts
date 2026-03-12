import { defineConfig } from "tsup";

export default defineConfig([
    // SDK core library (ESM + CJS + DTS)
    {
        entry: ["src/index.ts"],
        format: ["esm", "cjs"],
        dts: true,
        splitting: false,
        sourcemap: true,
        clean: true,
        target: "es2020",
        minify: false,
    },
    // AI subpath: GPTAgent (ESM + CJS + DTS, openai external)
    {
        entry: { "ai/index": "src/ai/index.ts" },
        format: ["esm", "cjs"],
        dts: true,
        splitting: false,
        sourcemap: true,
        target: "es2020",
        minify: false,
        external: ["openai"],
    },
    // CLI binary (ESM, bundled with shebang)
    {
        entry: { "cli/index": "cli/index.ts" },
        format: ["esm"],
        splitting: true,
        sourcemap: false,
        target: "es2020",
        minify: false,
        external: ["@pinecall/sdk", "openai", "blessed"],
        banner: {
            js: "#!/usr/bin/env node",
        },
    },
]);
