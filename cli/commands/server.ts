/**
 * `pinecall server` — headless server mode with REST API + WS events.
 *
 * Supports three source modes:
 *   pinecall server Agent.js               → code-based agent(s)
 *   pinecall server ./agents               → directory of agent files
 *   pinecall server                        → reads pinecall.json (declarative)
 *   pinecall server --config=custom.json   → custom config file
 */

import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { parseArgs } from "../lib/args.js";
import { CliError } from "../lib/errors.js";
import chalk from "chalk";

const EXTENSIONS = [".js", ".ts", ".mjs", ".mts"];
const CONFIG_NAMES = ["pinecall.json", "pinecall.config.json"];

// ── Types ────────────────────────────────────────────────────────────────

interface AgentConfig {
    name: string;
    model?: string;
    voice?: string;
    language?: string;
    stt?: string;
    phone?: string;
    instructions?: string;
    greeting?: string;
    turnDetection?: string;
    interruption?: boolean;
}

interface ServerConfig {
    port?: number;
    host?: string;
    ui?: boolean;
    agentsDir?: string;
    agents: AgentConfig[];
}

// ── File resolution ──────────────────────────────────────────────────────

async function resolveFiles(input: string): Promise<string[]> {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const cwd = process.cwd();
    const full = path.resolve(cwd, input);

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
    }

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

// ── Config detection ─────────────────────────────────────────────────────

async function findConfig(explicit?: string): Promise<{ path: string; config: ServerConfig } | null> {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cwd = process.cwd();

    // Explicit --config flag
    if (explicit) {
        const full = path.resolve(cwd, explicit);
        if (!fs.existsSync(full)) throw new CliError(`Config file not found: ${explicit}`);
        const raw = fs.readFileSync(full, "utf-8");
        return { path: full, config: JSON.parse(raw) };
    }

    // Auto-detect pinecall.json in cwd
    for (const name of CONFIG_NAMES) {
        const full = path.resolve(cwd, name);
        if (fs.existsSync(full)) {
            const raw = fs.readFileSync(full, "utf-8");
            return { path: full, config: JSON.parse(raw) };
        }
    }

    return null;
}

// ── Config persistence ───────────────────────────────────────────────────

function saveConfig(configPath: string, config: ServerConfig): void {
    const fs = require("node:fs");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Deploy agent from config ─────────────────────────────────────────────

async function deployConfigAgent(
    cfg: AgentConfig,
    env: { apiKey: string; openaiKey?: string; url?: string },
): Promise<any> {
    const { GPTAgent, Phone } = await import("@pinecall/sdk/ai");

    // Create a dynamic subclass with the config values
    const DynAgent = class extends GPTAgent {};
    Object.defineProperty(DynAgent, "name", { value: cfg.name });

    const agent = new DynAgent({
        apiKey: env.apiKey,
        openaiKey: env.openaiKey,
        url: env.url,
    });

    // Apply config fields
    if (cfg.model) agent.model = cfg.model;
    if (cfg.voice) (agent as any).voice = cfg.voice;
    if (cfg.language) (agent as any).language = cfg.language;
    if (cfg.stt) (agent as any).stt = cfg.stt;
    if (cfg.instructions) agent.instructions = cfg.instructions;
    if (cfg.greeting) agent.greeting = cfg.greeting;
    if (cfg.turnDetection) (agent as any).turnDetection = cfg.turnDetection;
    if (cfg.interruption !== undefined) (agent as any).interruption = cfg.interruption;
    if (cfg.phone) (agent as any).phone = new Phone(cfg.phone);

    await agent.start();
    return agent;
}

// ── Server command ───────────────────────────────────────────────────────

export async function server(argv: string[]): Promise<void> {
    const args = parseArgs(argv, {
        positional: "file",
        flags: ["--disable-ui"],
        values: ["--port", "--host", "--config"],
    });

    const env = resolveEnv();
    requireOpenAI(env);

    const input = args.positional;
    const configFlag = args.values.get("--config");

    // ── Determine mode ──
    let configMode: { path: string; config: ServerConfig } | null = null;

    if (!input || configFlag) {
        // Config mode: --config=file.json or auto-detect pinecall.json
        configMode = await findConfig(configFlag);
        if (!configMode && !input) {
            throw new CliError(
                "Usage: pinecall server <AgentName|folder> [--port=4100]\n" +
                "       pinecall server [--config=pinecall.json]\n\n" +
                "No agent file specified and no pinecall.json found in current directory."
            );
        }
    }

    const port = parseInt(args.values.get("--port") ?? String(configMode?.config.port ?? 4100), 10);
    const host = args.values.get("--host") ?? configMode?.config.host ?? "0.0.0.0";
    const disableUi = args.flags.has("--disable-ui");
    const ui = disableUi ? false : (configMode?.config.ui ?? true);

    // ── Banner ──
    console.log("");
    console.log(`  ${chalk.hex("#7C3AED")("⚡")} ${chalk.bold("pinecall server")}`);
    console.log("");

    const { EventServer } = await import("@pinecall/sdk/server");
    let pc: any = null;

    interface DeployedAgent { agent: any; name: string; }
    const deployed: DeployedAgent[] = [];

    if (configMode) {
        // ── Config mode: deploy from JSON ──
        const { config } = configMode;
        if (!config.agents?.length) {
            throw new CliError(`No agents defined in ${configMode.path}`);
        }

        console.log(`  ${chalk.dim("config")} ${configMode.path}`);
        console.log("");

        for (const agentCfg of config.agents) {
            const agent = await deployConfigAgent(agentCfg, env);
            if (!pc) pc = agent.pinecall;
            deployed.push({ agent, name: agentCfg.name });
        }
    } else {
        // ── File mode: load JS/TS agents ──
        const files = await resolveFiles(input!);

        for (const file of files) {
            const { AgentClass, name } = await loadAgentClass(file);
            const agent = new AgentClass({
                apiKey: env.apiKey,
                openaiKey: env.openaiKey,
                url: env.url,
            });
            await agent.start();
            if (!pc) pc = agent.pinecall;
            deployed.push({ agent, name });
        }
    }

    const eventServer = new EventServer({ port, host, pinecall: pc, ui });

    for (const { agent, name } of deployed) {
        const token = eventServer.attach(agent.core);
        const phone = agent.phone?.number ?? "—";
        const model = agent.model ?? "—";
        console.log(`  ${chalk.green("✓")} ${chalk.hex("#7C3AED")(name.padEnd(20))} ${chalk.dim("model=")}${model} ${chalk.dim("phone=")}${phone}`);
        console.log(`    ${chalk.dim("token=")}${token}`);
    }

    // ── DB persistence hooks (config mode only) ──
    if (configMode) {
        const cfgPath = configMode.path;
        const cfgData = configMode.config;

        // Intercept EventServer's POST /agents to also persist
        const origHandleApi = (eventServer as any)._handleApi.bind(eventServer);
        (eventServer as any)._handleApi = async (req: any, res: any, body: any) => {
            const url = req.url ?? "/";
            const method = req.method ?? "GET";

            // POST /agents — deploy + persist
            if (method === "POST" && url === "/agents") {
                const { name, model, voice, language, stt, phone, instructions, greeting } = body;
                if (!name) {
                    (eventServer as any)._json(res, 400, { error: "name is required" });
                    return;
                }

                // Check if already exists
                if (cfgData.agents.some(a => a.name === name)) {
                    (eventServer as any)._json(res, 409, { error: `Agent '${name}' already exists` });
                    return;
                }

                const agentCfg: AgentConfig = { name, model, voice, language, stt, phone, instructions, greeting };
                // Clean undefined values
                Object.keys(agentCfg).forEach(k => {
                    if ((agentCfg as any)[k] === undefined) delete (agentCfg as any)[k];
                });

                try {
                    const agent = await deployConfigAgent(agentCfg, env);
                    const token = eventServer.attach(agent.core);
                    deployed.push({ agent, name });

                    // Persist to DB
                    cfgData.agents.push(agentCfg);
                    saveConfig(cfgPath, cfgData);

                    console.log(`  ${chalk.green("+")} ${chalk.hex("#7C3AED")(name)} deployed + persisted`);
                    (eventServer as any)._json(res, 201, { ok: true, token, agent: agentCfg });
                } catch (err: any) {
                    (eventServer as any)._json(res, 500, { error: err.message });
                }
                return;
            }

            // DELETE /agents/:name — undeploy + remove from DB
            const deleteMatch = method === "DELETE" && url.match(/^\/agents\/(.+)$/);
            if (deleteMatch) {
                const name = decodeURIComponent(deleteMatch[1]);
                const idx = deployed.findIndex(d => d.name === name);
                if (idx === -1) {
                    (eventServer as any)._json(res, 404, { error: `Agent '${name}' not found` });
                    return;
                }

                const { agent } = deployed[idx];
                eventServer.detach(agent.core);
                await agent.stop();
                deployed.splice(idx, 1);

                // Remove from DB
                cfgData.agents = cfgData.agents.filter(a => a.name !== name);
                saveConfig(cfgPath, cfgData);

                console.log(`  ${chalk.red("−")} ${chalk.hex("#7C3AED")(name)} removed + unpersisted`);
                (eventServer as any)._json(res, 200, { ok: true });
                return;
            }

            // Fall through to original handler
            origHandleApi(req, res, body);
        };
    }

    eventServer.start();

    // Auto-open browser when UI is enabled
    if (ui) {
        const dashUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
        const { exec } = await import("node:child_process");
        const platform = process.platform;
        const cmd = platform === "darwin" ? `open "${dashUrl}"` : platform === "win32" ? `start "${dashUrl}"` : `xdg-open "${dashUrl}"`;
        exec(cmd, () => {}); // fire-and-forget, ignore errors
    }

    console.log("");
    console.log(`  ${chalk.dim("─".repeat(50))}`);
    console.log(`  ${chalk.bold("Server")}  http://${host}:${port}  ${chalk.dim("(REST + WS)")}`);
    if (ui) {
        console.log(`  ${chalk.bold("Dashboard")}  ${chalk.cyan(`http://${host === "0.0.0.0" ? "localhost" : host}:${port}`)}`);
    }
    console.log(`  ${chalk.dim("─".repeat(50))}`);
    console.log("");
    console.log(`  ${chalk.dim("REST endpoints:")}`);
    console.log(`    GET    /agents              ${chalk.dim("List agents")}`);
    console.log(`    POST   /agents              ${chalk.dim("Deploy agent" + (configMode ? " + persist" : ""))}`);
    console.log(`    PATCH  /agents/:name        ${chalk.dim("Configure agent")}`);
    console.log(`    DELETE /agents/:name        ${chalk.dim("Remove agent" + (configMode ? " + unpersist" : ""))}`);
    console.log(`    POST   /agents/:name/dial   ${chalk.dim("Outbound call")}`);
    console.log(`    GET    /calls               ${chalk.dim("List active calls")}`);
    console.log(`    PATCH  /calls/:id           ${chalk.dim("Configure call")}`);
    console.log(`    POST   /calls/:id/hangup    ${chalk.dim("Hang up call")}`);
    console.log(`    GET    /phones              ${chalk.dim("List phone numbers")}`);
    console.log(`    GET    /voices              ${chalk.dim("List TTS voices")}`);

    if (configMode) {
        console.log("");
        console.log(`  ${chalk.dim("DB")}  ${configMode.path}  ${chalk.dim("(auto-persist)")}`);
    }

    console.log("");
    console.log(`  ${chalk.dim("WebSocket")}  ws://${host}:${port}  ${chalk.dim("(events + commands)")}`);
    console.log("");
    console.log(`  ${chalk.dim("Ctrl+C to stop")}`);
    console.log("");

    await new Promise(() => {});
}
