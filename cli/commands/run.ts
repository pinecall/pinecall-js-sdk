/**
 * `pinecall run <file>` — load and run a GPTAgent from a JS/TS file.
 *
 * Usage:
 *   pinecall run agent.js
 *   pinecall run agent.js --phone +13186330963
 *   pinecall run agent.js --dial +14155551234 --from +13186330963
 */

import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { parseArgs } from "../lib/args.js";
import { pickPhone } from "../lib/phone-picker.js";
import { CliError } from "../lib/errors.js";
import { startInput } from "../ui/input.js";
import { attachEvents } from "../ui/events.js";
import { logLine, printHeader, printConfigLine } from "../ui/renderer.js";

export async function run(argv: string[]): Promise<void> {
    const args = parseArgs(argv, {
        positional: "file",
        values: ["--phone", "--dial", "--from"],
    });

    const filePath = args.positional;
    if (!filePath) {
        throw new CliError("Usage: pinecall run <agent-file.js>");
    }

    const env = resolveEnv();
    requireOpenAI(env);

    // Dynamic import the agent file — resolve relative to cwd
    const path = await import("node:path");
    const fullPath = path.resolve(process.cwd(), filePath);

    let AgentClass: any;
    try {
        const mod = await import(fullPath);
        AgentClass = mod.default ?? mod;
    } catch (err) {
        throw new CliError(`Failed to load agent file: ${filePath}\n${err}`);
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
    const dialFrom = args.values.get("--from");

    if (phoneArg) {
        agent.addPhone(phoneArg);
    } else if (!dialTo && !agent.phone) {
        // Interactive phone picker only if no phone is set anywhere
        const phones = await agent.pinecall.fetchPhones();
        const phone = await pickPhone(phones);
        agent.addPhone(phone);
    }

    // Start
    await agent.start();

    const agentName = AgentClass.name || "GPTAgent";
    printHeader(`${agentName} is live`);
    printConfigLine("Model", agent.model);
    if (agent.voice) printConfigLine("Voice", agent.voice);
    if (agent.language) printConfigLine("Language", agent.language);
    logLine("");

    // Attach CLI UI to the underlying agent (display-only — GPTAgent handles turns)
    attachEvents(agent.agent);

    // Wire up interactive /commands
    startInput({
        agent: agent.agent,
        pc: agent.pinecall,
        instructions: agent.instructions,
        onInstructionsChange: (newInstructions: string) => {
            agent.instructions = newInstructions;
        },
    });

    // Outbound dial if requested
    if (dialTo) {
        if (!dialFrom && !phoneArg) {
            throw new CliError("--dial requires --from (caller phone number)");
        }
        const from = dialFrom ?? phoneArg!;
        logLine(`  Dialing ${dialTo} from ${from}...`);
        await agent.dial({ to: dialTo, from });
    }

    // Keep running
    await new Promise(() => { });
}
