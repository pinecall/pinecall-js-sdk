/**
 * `pinecall run <name|folder>` — load and run Agent(s)  / GPTAgent(s).
 *
 * Single file:
 *   pinecall run Receptionist       → ./Receptionist.js, .ts, etc.
 *   pinecall run Receptionist.js    → exact path
 *
 * Folder (multi-agent):
 *   pinecall run ./agents           → loads all .js/.ts agent files in folder
 */

import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { parseArgs } from "../lib/args.js";
import { pickPhone } from "../lib/phone-picker.js";
import { CliError } from "../lib/errors.js";
import { attachEvents, attachLLMEvents } from "../ui/events.js";
import { printHeader, logLine, ensureCursor, writeln } from "../ui/renderer.js";
import { ACCENT, DIM, MUTED, OK } from "../ui/theme.js";
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

/** Check if path is a directory, return sorted agent files inside it. */
async function resolveAgentFolder(input: string): Promise<string[] | null> {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const cwd = process.cwd();
    const full = path.resolve(cwd, input);

    let stat: any;
    try { stat = fs.statSync(full); } catch { return null; }
    if (!stat.isDirectory()) return null;

    const files = fs.readdirSync(full)
        .filter((f: string) => EXTENSIONS.some(ext => f.endsWith(ext)))
        .filter((f: string) => !f.startsWith("_") && !f.startsWith("."))
        .sort()
        .map((f: string) => path.join(full, f));

    if (files.length === 0) {
        throw new CliError(`No agent files found in ${full}`);
    }

    return files;
}

// ── Load a single agent class from file ──────────────────────────────────

async function loadAgentClass(fullPath: string): Promise<{ AgentClass: any; name: string }> {
    const path = await import("node:path");

    let AgentClass: any;
    try {
        const mod = await import(fullPath);
        AgentClass = mod.default ?? mod;
    } catch (err) {
        throw new CliError(`Failed to load agent file: ${fullPath}\n${err}`);
    }

    if (typeof AgentClass !== "function") {
        throw new CliError(
            `Agent file must export a class (got ${typeof AgentClass}): ${fullPath}\n` +
            `Use module.exports = MyAgent or export default MyAgent.`,
        );
    }

    const name = AgentClass.name || path.basename(fullPath, path.extname(fullPath));
    return { AgentClass, name };
}

// ── Run command ──────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<void> {
    const args = parseArgs(argv, {
        positional: "file",
        flags: [],
        values: ["--phone", "--dial"],
    });

    const input = args.positional;
    if (!input) {
        throw new CliError("Usage: pinecall run <AgentName|folder>\n" +
            "  For server mode (REST + WS): pinecall serve <AgentName|folder>");
    }

    const env = resolveEnv();
    requireOpenAI(env);

    // Detect folder vs single file
    const folderFiles = await resolveAgentFolder(input);

    if (folderFiles) {
        await runMultiple(folderFiles, args, env);
    } else {
        await runSingle(input, args, env);
    }

    await new Promise(() => { });
}

// ── Single agent mode ────────────────────────────────────────────────────

async function runSingle(
    input: string,
    args: ReturnType<typeof parseArgs>,
    env: ReturnType<typeof resolveEnv>,
): Promise<void> {
    const fullPath = await resolveAgentFile(input);

    // Try loading as a class-based agent
    let AgentClass: any;
    let name: string;
    try {
        const mod = await import(fullPath);
        const exported = mod.default ?? mod;
        if (typeof exported === "function") {
            AgentClass = exported;
            name = exported.name || (await import("node:path")).basename(fullPath, (await import("node:path")).extname(fullPath));
        } else {
            // Script mode — the import already executed the file.
            // Just keep the process alive (the script manages its own lifecycle).
            return;
        }
    } catch (err) {
        throw new CliError(`Failed to load agent file: ${fullPath}\n${err}`);
    }

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
    printHeader(name);
    if (agent.model) logLine(`${DIM("Model")}  ${agent.model}`);
    if (agent.voice) logLine(`${DIM("Voice")}  ${agent.voice}`);
    if (agent.language) logLine(`${DIM("Lang")}   ${agent.language}`);

    await agent.start();

    attachEvents(agent.core);
    attachLLMEvents(agent.core);

    startInput({ agent: agent.core, pc: agent.pinecall, sourceAgent: agent });
    ensureCursor();

    if (dialTo) {
        const from = phoneArg ?? agent.phone?.number;
        if (!from) {
            throw new CliError("--dial requires a phone number on the agent (no phone configured)");
        }
        logLine(`${ACCENT("Dialing")} ${dialTo} from ${from}...`);
        await agent.dial({ to: dialTo, from });
    }
}

// ── Multi-agent mode (folder) ────────────────────────────────────────────

async function runMultiple(
    files: string[],
    args: ReturnType<typeof parseArgs>,
    env: ReturnType<typeof resolveEnv>,
): Promise<void> {
    const path = await import("node:path");

    printHeader(`${files.length} agents`);

    // Load and start all agents
    let firstAgent: any = null;
    const agentsMap = new Map<string, any>();

    for (const file of files) {
        const { AgentClass, name } = await loadAgentClass(file);

        const agent = new AgentClass({
            apiKey: env.apiKey,
            openaiKey: env.openaiKey,
            url: env.url,
        });

        await agent.start();
        attachEvents(agent.core);
        attachLLMEvents(agent.core);

        if (!firstAgent) firstAgent = agent;
        agentsMap.set(name, agent.core);

        // Log agent info
        const phone = agent.phone?.number ?? agent.channels?.[0]?.number ?? "—";
        logLine(
            `${OK("✓")} ${ACCENT(name.padEnd(20))} ` +
            `${DIM("model=")}${agent.model ?? "—"} ` +
            `${DIM("phone=")}${phone}`
        );
    }

    writeln(`  ${MUTED("─".repeat(Math.min(process.stdout.columns || 80, 60)))}`);
    writeln("");

    // Input — binds to the first agent for commands, all agents available for /dial
    if (firstAgent) {
        startInput({ agent: firstAgent.core, pc: firstAgent.pinecall, agents: agentsMap, sourceAgent: firstAgent });
        ensureCursor();
    }
}
