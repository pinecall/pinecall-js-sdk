/**
 * Pinecall CLI — like Stripe CLI or Twilio CLI for voice AI.
 *
 * Usage:
 *   pinecall agent [--es]                  Start an inbound voice agent
 *   pinecall dial +14155551234 [--es]      Make an outbound call
 *   pinecall test                          Smoke test (connect, agent, REST)
 *   pinecall voices [--provider=cartesia]  List available voices
 *   pinecall phone-numbers                 List your phone numbers
 *   pinecall help                          Show this help
 */

const HELP = `
  ⚡ Pinecall CLI

  Usage:
    pinecall <command> [options]

  Commands:
    agent [--es|--lang=xx]             Start an inbound voice agent (OpenAI)
    dial <number> [--es] [--from=+xx]  Make an outbound call
    test                               Smoke test (connect + REST APIs)
    voices [--provider=xx]             List available TTS voices
    phone-numbers                      List your phone numbers
    help                               Show this help

  Environment:
    PINECALL_API_KEY    Your Pinecall API key (required)
    OPENAI_API_KEY      OpenAI key (for agent/dial commands)
    PINECALL_PHONE      Default phone number
    PINECALL_URL        Server URL (default: wss://voice.pinecall.io/client)
`;

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const rest = args.slice(1);

    switch (command) {
        case "agent": {
            const { agentCommand } = await import("./commands/agent.js");
            await agentCommand(rest);
            break;
        }
        case "dial": {
            const { dialCommand } = await import("./commands/dial.js");
            await dialCommand(rest);
            break;
        }
        case "test": {
            const { testCommand } = await import("./commands/test.js");
            await testCommand(rest);
            break;
        }
        case "voices": {
            const { voicesCommand } = await import("./commands/voices.js");
            await voicesCommand(rest);
            break;
        }
        case "phone-numbers":
        case "phones": {
            const { phonesCommand } = await import("./commands/phones.js");
            await phonesCommand(rest);
            break;
        }
        case "help":
        case "--help":
        case "-h":
        case undefined:
            console.log(HELP);
            break;
        default:
            console.error(`  Unknown command: ${command}\n`);
            console.log(HELP);
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
