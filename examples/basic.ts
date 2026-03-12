/**
 * Eager-turn voice agent example with @pinecall/sdk.
 *
 * Uses `eager.turn` to start generating a response as soon as the
 * turn detector *thinks* the user has finished speaking. If the user
 * keeps talking, the reply stream is automatically aborted via
 * `stream.aborted`, so no stale audio is sent.
 *
 * Recommended for small, fast models (e.g. gpt-4.1-nano) where the
 * latency win outweighs the occasional discarded generation.
 * Avoid with large / expensive models — the wasted tokens add up.
 *
 * Usage:
 *   PINECALL_API_KEY=pk_... OPENAI_API_KEY=sk-... npx tsx examples/basic.ts
 *   PINECALL_API_KEY=pk_... OPENAI_API_KEY=sk-... npx tsx examples/basic.ts --es
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

const agent = pc.agent("basic-agent", {
    voice: config.voice,
    stt: config.stt as any,
    turnDetection: config.turnDetection,
});

agent.addChannel("phone", phone);

// ── Events ───────────────────────────────────────────────────────────────

agent.on("call.started", (call: Call) => {
    console.log(`── Call started (${call.direction}) ──`);
    call.say(config.greeting);
});

agent.on("call.ended", () => {
    console.log(`── Call ended ──`);
});

agent.on("eager.turn", async (turn: Turn, call: Call) => {
    console.log(`  User → ${turn.text}`);

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
    console.log(`  Bot  ← ${stream.aborted ? "[aborted]" : reply}\n`);
});

// ── Start ────────────────────────────────────────────────────────────────

await pc.connect();

console.log(`\n⚡ Agent is live (${lang})`);
console.log(`  Phone: ${phone}`);
console.log(`  STT:   ${config.stt.provider}`);
console.log(`  Turn:  ${config.turnDetection} → gpt-4.1-nano\n`);
