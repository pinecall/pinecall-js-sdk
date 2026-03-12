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
import { createTUI } from "../ui/tui.js";
import { createCallSidebar } from "../ui/tui-sidebar.js";
import { attachTUIEvents } from "../ui/tui-events.js";
import { attachTUILLM } from "../ui/tui-llm.js";
import { setupCommandPalette } from "../ui/tui-commands.js";

// ── File resolution ──────────────────────────────────────────────────────

const EXTENSIONS = [".js", ".ts", ".mjs", ".mts"];

async function resolveAgentFile(input: string): Promise<string> {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const cwd = process.cwd();

    // Candidates: input as-is, then input + each extension
    const candidates: string[] = [input];
    const hasExt = EXTENSIONS.some(ext => input.endsWith(ext));
    if (!hasExt) {
        for (const ext of EXTENSIONS) {
            candidates.push(input + ext);
        }
    }

    // Try each candidate in cwd
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

    // Add phone channel (skip if the class already defines one)
    const phoneArg = args.values.get("--phone");
    const dialTo = args.values.get("--dial");

    if (phoneArg) {
        agent.addPhone(phoneArg);
    } else if (!dialTo && !agent.phone && !agent.channels?.length) {
        const phones = await agent.pinecall.fetchPhones();
        const phone = await pickPhone(phones);
        agent.addPhone(phone);
    }

    // ── TUI ──
    const tui = createTUI();
    const sidebar = createCallSidebar(tui);

    const agentName = AgentClass.name || "Agent";
    tui.callLog.log(`{cyan-fg}${agentName}{/cyan-fg} is live`);
    if (agent.model) tui.callLog.log(`{cyan-fg}Model{/cyan-fg}  ${agent.model}`);
    if (agent.voice) tui.callLog.log(`{cyan-fg}Voice{/cyan-fg}  ${agent.voice}`);
    if (agent.language) tui.callLog.log(`{cyan-fg}Lang{/cyan-fg}   ${agent.language}`);
    tui.callLog.log("");
    tui.llmLog.log("{gray-fg}Waiting for first call…{/gray-fg}");
    tui.screen.render();

    // Start
    await agent.start();

    // Attach CLI UI
    attachTUIEvents(agent.core, sidebar);
    attachTUILLM(agent.core, sidebar);

    setupCommandPalette({
        tui,
        sidebar,
        agent: agent.core,
        pc: agent.pinecall,
    });

    // Outbound dial — uses agent's phone as `from`
    if (dialTo) {
        const from = phoneArg ?? agent.phone?.number;
        if (!from) {
            throw new CliError("--dial requires a phone number on the agent (no phone configured)");
        }
        sidebar.logCall("", `Dialing ${dialTo} from ${from}...`);
        await agent.dial({ to: dialTo, from });
    }

    await new Promise(() => { });
}
