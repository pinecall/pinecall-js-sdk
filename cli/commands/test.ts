/**
 * `pinecall test` — Smoke test: connect, create agent, register channel, verify.
 *
 * Usage:
 *   pinecall test
 */

import { Pinecall } from "@pinecall/sdk";
import { resolveEnv, pickPhone } from "../presets.js";

export async function testCommand(_args: string[]) {
    const env = resolveEnv();
    const checks: { label: string; ok: boolean; detail?: string }[] = [];

    console.log("\n  🧪 Pinecall SDK Smoke Test\n");

    // ── 1. Connect ──────────────────────────────────────────────────────

    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url });

    try {
        await pc.connect();
        checks.push({ label: "WebSocket connect", ok: true, detail: `protocol v${pc.protocolVersion}` });
    } catch (err: any) {
        checks.push({ label: "WebSocket connect", ok: false, detail: err.message });
        printResults(checks);
        process.exit(1);
    }

    // ── 2. Create agent ─────────────────────────────────────────────────

    const agent = pc.agent("sdk-test", {
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        turnDetection: "smart_turn",
    });

    // Wait for agent.created (or timeout)
    const agentReady = await Promise.race([
        new Promise<boolean>((resolve) => {
            agent.on("ready", () => resolve(true));
        }),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);

    checks.push({
        label: "Agent create",
        ok: agentReady,
        detail: agentReady ? `id=${agent.id}` : "timeout waiting for agent.created",
    });

    // ── 3. Add phone channel ────────────────────────────────────────────

    let phone = "";
    try {
        phone = await pickPhone(env.apiKey);
    } catch {
        checks.push({ label: "Phone channel", ok: false, detail: "no phones found" });
    }

    if (phone) {
        agent.addChannel("phone", phone);

        // Give it a moment to register
        await new Promise((r) => setTimeout(r, 1000));

        checks.push({
            label: "Phone channel",
            ok: true,
            detail: phone,
        });
    }

    // ── 4. Fetch voices (REST API) ──────────────────────────────────────

    try {
        const voices = await Pinecall.fetchVoices({ provider: "elevenlabs" });
        checks.push({
            label: "REST: fetchVoices",
            ok: voices.length > 0,
            detail: `${voices.length} voices found`,
        });
    } catch (err: any) {
        checks.push({ label: "REST: fetchVoices", ok: false, detail: err.message });
    }

    // ── 5. Fetch phones (REST API) ──────────────────────────────────────

    try {
        const phones = await Pinecall.fetchPhones({ apiKey: env.apiKey });
        checks.push({
            label: "REST: fetchPhones",
            ok: phones.length > 0,
            detail: phones.map((p) => p.number).join(", "),
        });
    } catch (err: any) {
        checks.push({ label: "REST: fetchPhones", ok: false, detail: err.message });
    }

    // ── Results ─────────────────────────────────────────────────────────

    printResults(checks);

    await pc.disconnect();
    process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

function printResults(checks: { label: string; ok: boolean; detail?: string }[]) {
    console.log("");
    for (const c of checks) {
        const icon = c.ok ? "✅" : "❌";
        const detail = c.detail ? ` (${c.detail})` : "";
        console.log(`  ${icon} ${c.label}${detail}`);
    }

    const passed = checks.filter((c) => c.ok).length;
    const total = checks.length;
    console.log(`\n  ${passed}/${total} checks passed\n`);
}
