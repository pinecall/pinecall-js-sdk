/**
 * `pinecall dial` — Make an outbound call.
 *
 * Usage:
 *   pinecall dial +14155551234               # English
 *   pinecall dial +34607123456 --es          # Spanish
 *   pinecall dial +14155551234 --from=+1903  # Custom caller ID
 */

import { Pinecall, type Turn, type Call } from "@pinecall/sdk";
import OpenAI from "openai";
import { getPreset, resolveEnv } from "../presets.js";
import { attachLogger } from "../logger.js";

export async function dialCommand(args: string[]) {
    // Parse args
    let lang = "en";
    let to = "";
    let from = "";

    for (const arg of args) {
        if (arg === "--es") lang = "es";
        else if (arg.startsWith("--lang=")) lang = arg.split("=")[1];
        else if (arg.startsWith("--from=")) from = arg.split("=")[1];
        else if (arg.startsWith("+")) to = arg;
    }

    if (!to) {
        console.error("Usage: pinecall dial +14155551234 [--es] [--from=+19035551234]");
        process.exit(1);
    }

    const preset = getPreset(lang);
    const env = resolveEnv();
    from = from || env.phone;

    if (!env.openaiKey) {
        console.error("❌ Set OPENAI_API_KEY env var for the dial command");
        process.exit(1);
    }

    const openai = new OpenAI({ apiKey: env.openaiKey });
    const history: { role: string; content: string }[] = [
        { role: "system", content: preset.system },
    ];

    // ── Connection + Agent ──────────────────────────────────────────────

    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url });

    const agent = pc.agent("outbound-agent", {
        voice: preset.voice,
        stt: preset.stt as any,
        turnDetection: preset.turnDetection,
        language: lang,
    });

    agent.addChannel("phone", from);
    attachLogger(agent);

    // ── LLM streaming ────────────────────────────────────────────────────

    agent.on("eager.turn", async (turn: Turn, call: Call) => {
        history.push({ role: "user", content: turn.text });

        const stream = call.replyStream(turn);

        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4.1-nano",
                messages: history as any,
                stream: true,
            });

            let fullResponse = "";
            for await (const chunk of completion) {
                if (stream.aborted) break;
                const token = chunk.choices[0]?.delta?.content;
                if (token) {
                    stream.write(token);
                    fullResponse += token;
                }
            }

            stream.end();
            if (fullResponse) {
                history.push({ role: "assistant", content: fullResponse });
            }
        } catch (err) {
            console.error("OpenAI error:", err);
            stream.end();
            call.reply(preset.errorMsg);
        }
    });

    agent.on("call.ended", (_call: Call) => {
        console.log("\n  📞 Call ended.\n");
        process.exit(0);
    });

    // ── Connect + Dial ──────────────────────────────────────────────────

    console.log(`\n  📞 Pinecall Dial · ${lang.toUpperCase()}\n`);

    await pc.connect();
    console.log(`  ✅ Connected`);
    console.log(`  📱 Dialing ${to} from ${from}…\n`);

    const call = await agent.dial({
        to,
        from,
        greeting: preset.greeting,
    });

    console.log(`  🟢 Call connected: ${call.id}\n`);
}
