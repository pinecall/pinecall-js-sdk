import { defineConfig } from "tsup";

export default defineConfig([
    // SDK library (ESM + CJS + DTS)
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
    // CLI binary (ESM, bundled with shebang)
    {
        entry: { "cli/index": "cli/index.ts" },
        format: ["esm"],
        splitting: true,
        sourcemap: false,
        target: "es2020",
        minify: false,
        external: ["@pinecall/sdk", "openai"],
        banner: {
            js: "#!/usr/bin/env node",
        },
    },
]);
