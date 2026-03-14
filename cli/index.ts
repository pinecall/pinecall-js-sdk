/**
 * pinecall — CLI entry point.
 *
 * Routes commands to their handlers. Catches CliError for user-friendly messages.
 */

import { CliError } from "./lib/errors.js";
import { VERSION } from "./lib/constants.js";
import chalk from "chalk";

const HELP = `
  ${chalk.hex("#7C3AED")("⚡ pinecall")} ${chalk.dim(`v${VERSION}`)}

  ${chalk.bold("Usage:")} pinecall <command> [options]

  ${chalk.bold("Commands:")}
    run <agent>         Run an agent file (dev mode with TUI)
    server <agent|dir>  Start headless server (REST + WS)
    agent               Start an inbound voice agent
    dial <number>       Make an outbound call
    test                Run a connectivity smoke test
    help                Show this help message

  ${chalk.bold("Options:")}
    --es                Use Spanish preset (shortcut for --lang=es)
    --lang=<code>       Language preset (en, es)
    --from=<number>     Caller ID for dial command

  ${chalk.bold("Environment:")}
    PINECALL_API_KEY    ${chalk.dim("(required)")} Your Pinecall API key
    OPENAI_API_KEY      ${chalk.dim("(required for agent/dial)")} Your OpenAI API key
    PINECALL_URL        ${chalk.dim("(optional)")} Custom WebSocket URL

  ${chalk.bold("Examples:")}
    ${chalk.dim("$")} pinecall run Agent.js
    ${chalk.dim("$")} pinecall run ./agents
    ${chalk.dim("$")} pinecall server Agent.js --api-port=3000
    ${chalk.dim("$")} pinecall server ./agents
    ${chalk.dim("$")} pinecall dial +12025551234
    ${chalk.dim("$")} pinecall test

  ${chalk.bold("In-CLI commands:")} /phones /voices /dial /config /help
`;

async function main(): Promise<void> {
    const command = process.argv[2];
    const argv = process.argv.slice(3);

    switch (command) {
        case "agent":
            return (await import("./commands/agent.js")).default(argv);

        case "dial":
            return (await import("./commands/dial.js")).default(argv);

        case "test":
            return (await import("./commands/test.js")).default(argv);

        case "phones":
        case "voices":
            console.error(`  ${chalk.dim("ℹ")} ${chalk.dim(`"${command}" moved to interactive CLI. Use /${command} inside pinecall run.`)}`);
            return;

        case "run":
            return (await import("./commands/run.js")).run(argv);

        case "server":
            return (await import("./commands/server.js")).server(argv);

        case "help":
        case "--help":
        case "-h":
        case undefined:
            console.log(HELP);
            return;

        case "--version":
        case "-v":
            console.log(VERSION);
            return;

        default:
            console.error(`  Unknown command: "${command}". Run ${chalk.dim("pinecall help")} for usage.`);
            process.exit(1);
    }
}

main().catch((err) => {
    if (err instanceof CliError) {
        console.error(`\n  ${chalk.hex("#EF4444")("✗")} ${err.message}\n`);
        process.exit(1);
    }
    // Unexpected error — show stack
    console.error(err);
    process.exit(1);
});
