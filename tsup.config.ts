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
    // Server subpath: EventServer (ESM + CJS + DTS, ws external)
    {
        entry: { "server/index": "src/server/index.ts" },
        format: ["esm", "cjs"],
        dts: true,
        splitting: false,
        sourcemap: true,
        target: "es2020",
        minify: false,
        external: ["ws"],
    },
    // WebRTC subpath: browser-only client (ESM + DTS)
    {
        entry: { "webrtc/index": "src/webrtc-client.ts" },
        format: ["esm"],
        dts: true,
        splitting: false,
        sourcemap: true,
        target: "es2020",
        minify: false,
    },
    // WebRTC browser bundle: IIFE for <script> tag / CDN usage
    // Usage: <script src="pinecall-webrtc.iife.js"></script>
    //        const webrtc = new Pinecall.WebRTC("http://localhost:4100", "my-agent");
    {
        entry: { "pinecall-webrtc.iife": "src/webrtc-client.ts" },
        format: ["iife"],
        globalName: "Pinecall",
        splitting: false,
        sourcemap: false,
        target: "es2020",
        minify: true,
        outDir: "dist",
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
