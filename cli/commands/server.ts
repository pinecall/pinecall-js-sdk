/**
 * `pinecall server <name|folder>` — headless server mode with REST API + WS events.
 *
 * Loads agent(s), starts EventServer with WS + REST API, no TUI.
 *
 *   pinecall server Agent.js                     → single agent
 *   pinecall server ./agents                     → all agents in folder
 *   pinecall server ./agents --port=4100 --api-port=3000
 */

import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { parseArgs } from "../lib/args.js";
import { CliError } from "../lib/errors.js";
import chalk from "chalk";

const EXTENSIONS = [".js", ".ts", ".mjs", ".mts"];

// ── File resolution (shared with run.ts logic) ──────────────────────────

async function resolveFiles(input: string): Promise<string[]> {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const cwd = process.cwd();
    const full = path.resolve(cwd, input);

    // Check if directory
    try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            const files = fs.readdirSync(full)
                .filter((f: string) => EXTENSIONS.some(ext => f.endsWith(ext)))
                .filter((f: string) => !f.startsWith("_") && !f.startsWith("."))
                .sort()
                .map((f: string) => path.join(full, f));
            if (files.length === 0) throw new CliError(`No agent files found in ${full}`);
            return files;
        }
    } catch (e) {
        if (e instanceof CliError) throw e;
        // Not a directory, try as file
    }

    // Single file
    const candidates = [input];
    if (!EXTENSIONS.some(ext => input.endsWith(ext))) {
        for (const ext of EXTENSIONS) candidates.push(input + ext);
    }
    for (const c of candidates) {
        const p = path.resolve(cwd, c);
        if (fs.existsSync(p)) return [p];
    }
    throw new CliError(`Could not find agent file: ${input}`);
}

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
        throw new CliError(`Agent file must export a class (got ${typeof AgentClass}): ${fullPath}`);
    }
    const name = AgentClass.name || path.basename(fullPath, path.extname(fullPath));
    return { AgentClass, name };
}

// ── Server command ───────────────────────────────────────────────────────

export async function server(argv: string[]): Promise<void> {
    const args = parseArgs(argv, {
        positional: "file",
        flags: [],
        values: ["--port", "--api-port", "--host"],
    });

    const input = args.positional;
    if (!input) {
        throw new CliError("Usage: pinecall server <AgentName|folder> [--port=4100] [--api-port=3000]");
    }

    const env = resolveEnv();
    requireOpenAI(env);

    const wsPort = parseInt(args.values.get("--port") ?? "4100", 10);
    const apiPort = parseInt(args.values.get("--api-port") ?? "3000", 10);
    const host = args.values.get("--host") ?? "0.0.0.0";

    // Load agent files
    const files = await resolveFiles(input);

    // ── Banner ──
    console.log("");
    console.log(`  ${chalk.hex("#7C3AED")("⚡")} ${chalk.bold("pinecall server")}`);
    console.log("");

    // Start EventServer with REST API
    const { EventServer } = await import("@pinecall/sdk/server");
    const eventServer = new EventServer({
        port: wsPort,
        apiPort,
        host,
    });

    // Load and start all agents
    for (const file of files) {
        const { AgentClass, name } = await loadAgentClass(file);

        const agent = new AgentClass({
            apiKey: env.apiKey,
            openaiKey: env.openaiKey,
            url: env.url,
        });

        await agent.start();
        const token = eventServer.attach(agent.core);

        // Agent info
        const phone = agent.phone?.number ?? "—";
        const model = agent.model ?? "—";
        console.log(`  ${chalk.green("✓")} ${chalk.hex("#7C3AED")(name.padEnd(20))} ${chalk.dim("model=")}${model} ${chalk.dim("phone=")}${phone}`);
        console.log(`    ${chalk.dim("token=")}${token}`);
    }

    eventServer.start();

    console.log("");
    console.log(`  ${chalk.dim("─".repeat(50))}`);
    console.log(`  ${chalk.bold("REST API")}   http://${host}:${apiPort}`);
    console.log(`  ${chalk.bold("WS Events")}  ws://${host}:${wsPort}`);
    console.log(`  ${chalk.dim("─".repeat(50))}`);
    console.log("");
    console.log(`  ${chalk.dim("Endpoints:")}`);
    console.log(`    GET    /agents              ${chalk.dim("List agents")}`);
    console.log(`    POST   /agents              ${chalk.dim("Deploy agent")}`);
    console.log(`    PATCH  /agents/:name        ${chalk.dim("Configure agent")}`);
    console.log(`    DELETE /agents/:name        ${chalk.dim("Remove agent")}`);
    console.log(`    POST   /agents/:name/dial   ${chalk.dim("Outbound call")}`);
    console.log(`    GET    /calls               ${chalk.dim("List active calls")}`);
    console.log(`    PATCH  /calls/:id           ${chalk.dim("Configure call")}`);
    console.log(`    POST   /calls/:id/hangup    ${chalk.dim("Hang up call")}`);
    console.log("");
    console.log(`  ${chalk.dim("Ctrl+C to stop")}`);
    console.log("");

    // Keep process alive
    await new Promise(() => {});
}
