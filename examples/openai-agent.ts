/**
 * OpenAI Voice Agent — real example using @pinecall/sdk + GPT-4.1-nano.
 *
 * Usage:
 *   npx tsx examples/openai-agent.ts          # English (default, deepgram-flux)
 *   npx tsx examples/openai-agent.ts --es     # Spanish (nova-3 + smart_turn)
 */

import { Pinecall, type Turn, type Call, type Agent } from "@pinecall/sdk";
import OpenAI from "openai";
import { attachLogger } from "./logger.js";

// ─── CLI flags ───────────────────────────────────────────────────────────

const lang = process.argv.includes("--es") ? "es" : "en";

// ─── Language presets ────────────────────────────────────────────────────

const PRESETS = {
    en: {
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        stt: { provider: "deepgram-flux" as const, language: "en" },
        turn_detection: "smart_turn" as const,
        greeting: "Hey! How can I help you today?",
        system: "You are a friendly voice assistant. Keep responses short and conversational — 1-2 sentences max. You're on a phone call.",
        error_msg: "Sorry, I had a technical issue. Could you repeat that?",
    },
    es: {
        voice: "elevenlabs:htFfPSZGJwjBv1CL0aMD", // Antonio
        stt: { provider: "deepgram" as const, language: "es", model: "nova-3" },
        turn_detection: "smart_turn" as const,
        greeting: "¡Hola! ¿En qué te puedo ayudar hoy?",
        system: "Eres un asistente de voz amigable. Responde de forma breve y conversacional — 1-2 oraciones máximo. Estás en una llamada telefónica.",
        error_msg: "Perdón, tuve un problema técnico. ¿Podés repetir?",
    },
} as const;

const preset = PRESETS[lang];

// ─── Config ──────────────────────────────────────────────────────────────

const PINECALL_API_KEY = process.env.PINECALL_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PINECALL_URL = process.env.PINECALL_URL ?? "wss://voice.pinecall.io/client";

if (!PINECALL_API_KEY || !OPENAI_API_KEY) {
    console.error("Set PINECALL_API_KEY and OPENAI_API_KEY env vars");
    process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ─── Conversation history per call ────────────────────────────────────────

const histories = new Map<string, { role: string; content: string }[]>();

function getHistory(callId: string) {
    if (!histories.has(callId)) {
        histories.set(callId, [{ role: "system", content: preset.system }]);
    }
    return histories.get(callId)!;
}

// ─── Connection + Agent ──────────────────────────────────────────────────

const PHONE = process.env.PINECALL_PHONE ?? "+13186330963";

const pc = new Pinecall({
    apiKey: PINECALL_API_KEY,
    url: PINECALL_URL,
});

// Create agent with voice shortcuts
const agent = pc.agent("openai-agent", {
    voice: preset.voice,
    stt: preset.stt,
    turnDetection: preset.turn_detection,
    language: lang,
});

// Register phone channel
agent.addChannel("phone", PHONE);

// Attach the reusable logger (works with both Pinecall and Agent)
attachLogger(agent);

// ── Greeting ─────────────────────────────────────────────────────────────

agent.on("call.started", (call: Call) => {
    call.say(preset.greeting);
});

// ── LLM streaming on eager.turn (lowest latency) ─────────────────────────

agent.on("eager.turn", async (turn: Turn, call: Call) => {
    const history = getHistory(call.id);
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
        call.reply(preset.error_msg);
    }
});

// ── Call ended (cleanup only) ────────────────────────────────────────────

agent.on("call.ended", (call: Call) => {
    histories.delete(call.id);
});

// ── Connect ──────────────────────────────────────────────────────────────

console.log(`\n  ⚡ Pinecall Agent · ${lang.toUpperCase()}\n`);
pc
    .connect()
    .then(() => {
        console.log(`  ✅ Connected as ${agent.id}`);
        console.log(`  📞 Phone: ${PHONE}`);
        console.log(`\n     Waiting for calls…\n`);
    })
    .catch((err) => {
        console.error("Failed to connect:", err);
        process.exit(1);
    });
