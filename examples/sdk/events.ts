/**
 * Full-events voice agent example with @pinecall/sdk.
 *
 * Same agent as basic.ts but logs every SDK event so you can see
 * exactly what happens during a call — useful for debugging,
 * understanding the event lifecycle, or building custom UIs.
 *
 * Usage:
 *   PINECALL_API_KEY=pk_... OPENAI_API_KEY=sk-... npx tsx examples/events.ts
 *   PINECALL_API_KEY=pk_... OPENAI_API_KEY=sk-... npx tsx examples/events.ts --es
 */

import { Pinecall, type Turn, type Call } from "@pinecall/sdk";
import OpenAI from "openai";

// ── Config per language ──────────────────────────────────────────────────

const lang = process.argv.includes("--es") ? "es" : "en";

const config = {
    en: {
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        stt: { provider: "deepgram-flux", language: "en" },
        turnDetection: "native",
        greeting: "Hey! How can I help you?",
        system: "You are a helpful voice assistant. Be concise — 1-2 sentences.",
    },
    es: {
        voice: "elevenlabs:htFfPSZGJwjBv1CL0aMD",
        stt: { provider: "deepgram", language: "es", model: "nova-3" },
        turnDetection: "smart_turn",
        greeting: "¡Hola! ¿En qué te puedo ayudar?",
        system: "Eres un asistente de voz. Responde breve — 1-2 oraciones máximo.",
    },
}[lang];

// ── Setup ────────────────────────────────────────────────────────────────

const pc = new Pinecall({ apiKey: process.env.PINECALL_API_KEY! });
const openai = new OpenAI();

// Fetch first available phone number from your account
const phones = await pc.fetchPhones();
const phone = phones[0]?.number;

if (!phone) {
    process.exit(1);
}

const agent = pc.agent("events-agent", {
    voice: config.voice,
    stt: config.stt as any,
    turnDetection: config.turnDetection,
});

agent.addChannel("phone", phone);

// ── Call lifecycle ───────────────────────────────────────────────────────

agent.on("call.started", (call: Call) => {
    console.log(`[call]    started  dir=${call.direction} from=${call.from} to=${call.to}`);
    call.say(config.greeting);
});

agent.on("call.ended", (_call: Call, reason: string) => {
    console.log(`[call]    ended    reason=${reason}`);
});

// ── Speech ───────────────────────────────────────────────────────────────

agent.on("speech.started", () => {
    console.log(`[speech]  started`);
});

agent.on("speech.ended", () => {
    console.log(`[speech]  ended`);
});

agent.on("user.speaking", (e) => {
    console.log(`[user]    speaking "${e.text}"`);
});

agent.on("user.message", (e) => {
    console.log(`[user]    message  "${e.text}" confidence=${e.confidence}`);
});

// ── Turn detection ───────────────────────────────────────────────────────

agent.on("turn.pause", (e) => {
    console.log(`[turn]    pause    p=${e.probability}`);
});

agent.on("eager.turn", (turn: Turn) => {
    console.log(`[turn]    eager    "${turn.text}" p=${turn.probability} latency=${turn.latencyMs}ms`);
});

agent.on("turn.end", (turn: Turn) => {
    console.log(`[turn]    end      "${turn.text}" p=${turn.probability} latency=${turn.latencyMs}ms`);
});

agent.on("turn.continued", () => {
    console.log(`[turn]    continued — user kept talking, reply aborted`);
});

agent.on("turn.resumed", () => {
    console.log(`[turn]    resumed`);
});

// ── Bot speech ───────────────────────────────────────────────────────────

agent.on("bot.speaking", (e) => {
    console.log(`[bot]     speaking msg=${e.message_id}`);
});

agent.on("bot.word", (e) => {
    console.log(`[bot]     word     "${e.word}"`);
});

agent.on("bot.finished", (e) => {
    console.log(`[bot]     finished msg=${e.message_id} duration=${e.duration_ms}ms`);
});

agent.on("bot.interrupted", (e) => {
    console.log(`[bot]     interrupted msg=${e.message_id}`);
});

// ── Confirmations ────────────────────────────────────────────────────────

agent.on("message.confirmed", (e) => {
    console.log(`[confirm] msg=${e.message_id} played=${e.played_ms}ms`);
});

agent.on("reply.rejected", (e) => {
    console.log(`[reject]  msg=${e.message_id} reason=${e.reason}`);
});

// ── LLM reply (eager.turn) ──────────────────────────────────────────────

agent.on("eager.turn", async (turn: Turn, call: Call) => {
    const stream = call.replyStream(turn);

    const completion = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
            { role: "system", content: config.system },
            { role: "user", content: turn.text },
        ],
        stream: true,
    });

    let reply = "";
    for await (const chunk of completion) {
        if (stream.aborted) break;
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
            stream.write(token);
            reply += token;
        }
    }

    stream.end();
    console.log(`[llm]     ${stream.aborted ? "aborted" : `reply "${reply}"`}`);
});

// ── Start ────────────────────────────────────────────────────────────────

await pc.connect();

console.log(`\n⚡ Events agent is live (${lang})`);
console.log(`  Phone: ${phone}`);
console.log(`  STT:   ${config.stt.provider}`);
console.log(`  Turn:  ${config.turnDetection} → gpt-4.1-nano`);
console.log(`  Logs:  all events\n`);
