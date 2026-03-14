/**
 * `pinecall run <name>` — load and run an Agent / GPTAgent.
 *
 * Auto-discovers the file by trying extensions and common directories:
 *   pinecall run Receptionist       → ./Receptionist.js, ./Receptionist.ts, etc.
 *   pinecall run Receptionist.js    → exact path
 *   pinecall run agents/Receptionist → ./agents/Receptionist.js, etc.
 */

import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { parseArgs } from "../lib/args.js";
import { pickPhone } from "../lib/phone-picker.js";
import { CliError } from "../lib/errors.js";
import { attachEvents, attachLLMEvents } from "../ui/events.js";
import { printHeader, logLine, ensureCursor } from "../ui/renderer.js";
import { ACCENT, DIM } from "../ui/theme.js";
import { startInput } from "../ui/input.js";

// ── File resolution ──────────────────────────────────────────────────────

const EXTENSIONS = [".js", ".ts", ".mjs", ".mts"];

async function resolveAgentFile(input: string): Promise<string> {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const cwd = process.cwd();

    const candidates: string[] = [input];
    const hasExt = EXTENSIONS.some(ext => input.endsWith(ext));
    if (!hasExt) {
        for (const ext of EXTENSIONS) {
            candidates.push(input + ext);
        }
    }

    for (const candidate of candidates) {
        const full = path.resolve(cwd, candidate);
        if (fs.existsSync(full)) return full;
    }

    throw new CliError(
        `Could not find agent file: ${input}\n` +
        `Tried: ${candidates.join(", ")}`,
    );
}

// ── Run command ──────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<void> {
    const args = parseArgs(argv, {
        positional: "file",
        values: ["--phone", "--dial"],
    });

    const input = args.positional;
    if (!input) {
        throw new CliError("Usage: pinecall run <AgentName>");
    }

    const env = resolveEnv();
    requireOpenAI(env);

    const fullPath = await resolveAgentFile(input);

    let AgentClass: any;
    try {
        const mod = await import(fullPath);
        AgentClass = mod.default ?? mod;
    } catch (err) {
        throw new CliError(`Failed to load agent file: ${fullPath}\n${err}`);
    }

    if (typeof AgentClass !== "function") {
        throw new CliError(
            `Agent file must export a class (got ${typeof AgentClass}). ` +
            `Use module.exports = MyAgent or export default MyAgent.`,
        );
    }

    // Instantiate
    const agent = new AgentClass({
        apiKey: env.apiKey,
        openaiKey: env.openaiKey,
        url: env.url,
    });

    // Add phone channel
    const phoneArg = args.values.get("--phone");
    const dialTo = args.values.get("--dial");

    if (phoneArg) {
        agent.addPhone(phoneArg);
    } else if (!dialTo && !agent.phone && !agent.channels?.length) {
        const phones = await agent.pinecall.fetchPhones();
        const phone = await pickPhone(phones);
        agent.addPhone(phone);
    }

    // ── Show header ──
    const agentName = AgentClass.name || "Agent";
    printHeader(agentName);
    if (agent.model) logLine(`${DIM("Model")}  ${agent.model}`);
    if (agent.voice) logLine(`${DIM("Voice")}  ${agent.voice}`);
    if (agent.language) logLine(`${DIM("Lang")}   ${agent.language}`);

    // Start
    await agent.start();

    // ── Attach events (unified log stream) ──
    attachEvents(agent.core);
    attachLLMEvents(agent.core);

    // ── Input handler ──
    startInput({
        agent: agent.core,
        pc: agent.pinecall,
        getHistory: (callId: string) => agent.getHistory(callId)?.toMessages(),
    });
    ensureCursor();

    // Outbound dial
    if (dialTo) {
        const from = phoneArg ?? agent.phone?.number;
        if (!from) {
            throw new CliError("--dial requires a phone number on the agent (no phone configured)");
        }
        logLine(`${ACCENT("Dialing")} ${dialTo} from ${from}...`);
        await agent.dial({ to: dialTo, from });
    }

    await new Promise(() => { });
}
