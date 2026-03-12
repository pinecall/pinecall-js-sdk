/**
 * pinecall test — smoke test command.
 *
 * Performs 5 connectivity checks. Uses event-driven waits instead of setTimeout.
 */

import { Pinecall } from "@pinecall/sdk";
import { resolveEnv } from "../lib/env.js";
import { CliError } from "../lib/errors.js";
import { printHeader, printStatus, printError, writeln, logLine } from "../ui/renderer.js";
import { OK, ERR, MUTED, DIM, ACCENT } from "../ui/theme.js";

export default async function test(argv: string[]): Promise<void> {
    const env = resolveEnv();
    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url, reconnect: false });

    printHeader("Smoke Test");
    let passed = 0;
    let failed = 0;

    function check(ok: boolean, label: string, detail?: string): void {
        if (ok) {
            printStatus(label, detail);
            passed++;
        } else {
            printError(label, detail);
            failed++;
        }
    }

    // ── 1. WebSocket connection ──
    try {
        await pc.connect();
        check(true, "WebSocket connection");
    } catch (err: any) {
        check(false, "WebSocket connection", err?.message);
        writeln("");
        writeln(`  ${failed} failed, ${passed} passed`);
        await pc.disconnect();
        throw new CliError("Cannot connect to Pinecall server.");
    }

    // ── 2. Agent creation ──
    try {
        const agent = pc.agent("smoke-test", { voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL" });

        // Wait for agent.created event (event-driven, not fixed sleep)
        await Promise.race([
            new Promise<void>((resolve) => agent.on("ready", resolve)),
            new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error("agent.created timeout")), 5000),
            ),
        ]);
        check(true, "Agent created");

        // ── 3. Channel registration ──
        const phones = await pc.fetchPhones();
        if (phones.length > 0) {
            agent.addChannel("phone", phones[0].number);

            // Wait for channel.added event (event-driven)
            await Promise.race([
                new Promise<void>((resolve) => agent.on("channel.added", () => resolve())),
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error("channel.added timeout")), 5000),
                ),
            ]);
            check(true, "Phone channel", ACCENT(phones[0].number));
        } else {
            check(false, "Phone channel", "no phones on account");
        }
    } catch (err: any) {
        check(false, "Agent/Channel", err?.message);
    }

    // ── 4. Fetch voices ──
    try {
        const voices = await Pinecall.fetchVoices();
        check(voices.length > 0, "Voices API", `${voices.length} voices`);
    } catch (err: any) {
        check(false, "Voices API", err?.message);
    }

    // ── 5. Fetch phones ──
    try {
        const phones = await pc.fetchPhones();
        check(phones.length > 0, "Phones API", `${phones.length} numbers`);
    } catch (err: any) {
        check(false, "Phones API", err?.message);
    }

    // ── Summary ──
    writeln("");
    const summary = failed > 0
        ? `  ${ERR(`${failed} failed`)}, ${OK(`${passed} passed`)}`
        : `  ${OK(`All ${passed} checks passed`)} ✨`;
    writeln(summary);
    writeln("");

    await pc.disconnect();

    if (failed > 0) {
        throw new CliError(`${failed} check(s) failed.`);
    }
}
