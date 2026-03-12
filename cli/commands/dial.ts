/**
 * pinecall dial — outbound call command.
 *
 * Thin orchestrator: parse args → resolve env → build agent → TUI → dial → connect.
 */

import { Pinecall } from "@pinecall/sdk";
import OpenAI from "openai";
import { parseArgs } from "../lib/args.js";
import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { getPreset } from "../lib/presets.js";
import { DEFAULT_MODEL } from "../lib/constants.js";
import { pickPhone } from "../lib/phone-picker.js";
import { type LLMContext } from "../lib/llm.js";
import { streamLLMReplyWithTUI } from "../ui/tui-llm.js";
import { CliError } from "../lib/errors.js";
import { createTUI } from "../ui/tui.js";
import { createCallSidebar } from "../ui/tui-sidebar.js";
import { attachTUIEvents } from "../ui/tui-events.js";
import { setupCommandPalette } from "../ui/tui-commands.js";

export default async function dial(argv: string[]): Promise<void> {
    // ── Parse args ──
    const args = parseArgs(argv, {
        flags: ["--es"],
        values: ["--lang", "--from"],
        positional: "to",
    });

    const to = args.positional;
    if (!to) {
        throw new CliError("Usage: pinecall dial <number> [--from=<number>] [--es]");
    }

    const lang = args.values.get("--lang") ?? (args.flags.has("--es") ? "es" : "en");
    const preset = getPreset(lang);

    // ── Env ──
    const env = resolveEnv();
    requireOpenAI(env);
    const openai = new OpenAI({ apiKey: env.openaiKey });

    // ── Connect ──
    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url });
    const from = args.values.get("--from") ?? await pickPhone(pc);

    const a = pc.agent("cli-dialer", {
        voice: preset.voice,
        stt: preset.stt,
        turnDetection: preset.turnDetection,
    });

    a.addChannel("phone", from);

    // ── LLM context ──
    const history: { role: string; content: string }[] = [
        { role: "system", content: preset.system },
    ];

    const llmCtx: LLMContext = {
        openai,
        model: DEFAULT_MODEL,
        history,
        errorMsg: preset.errorMsg,
    };

    // ── TUI ──
    const tui = createTUI();
    const sidebar = createCallSidebar(tui);

    tui.callLog.log(`{cyan-fg}Dialing{/cyan-fg} ${to}`);
    tui.callLog.log(`{cyan-fg}From{/cyan-fg}    ${from}`);
    tui.callLog.log(`{cyan-fg}Voice{/cyan-fg}   ${preset.voice}`);
    tui.callLog.log(`{cyan-fg}Model{/cyan-fg}   ${DEFAULT_MODEL}`);
    tui.callLog.log("");
    tui.screen.render();

    // ── Events ──
    attachTUIEvents(a, sidebar, (turn, call) => {
        streamLLMReplyWithTUI(call, turn, llmCtx, sidebar);
    });

    a.on("call.ended", async () => {
        sidebar.logCall("", "{gray-fg}Call ended{/gray-fg}");
        await pc.disconnect();
        tui.destroy();
        process.exit(0);
    });

    // ── Connect & dial ──
    await pc.connect();
    await a.dial({ to, from, greeting: preset.greeting });

    setupCommandPalette({
        tui,
        sidebar,
        agent: a,
        pc,
    });
}
