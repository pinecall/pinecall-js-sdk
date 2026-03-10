/**
 * Minimal voice agent example with @pinecall/sdk.
 *
 * Usage:
 *   PINECALL_API_KEY=pk_... OPENAI_API_KEY=sk-... npx tsx examples/basic.ts
 *
 * Or just use the CLI instead:
 *   pinecall agent
 */

import { Pinecall, type Turn, type Call } from "@pinecall/sdk";
import OpenAI from "openai";

const pc = new Pinecall({ apiKey: process.env.PINECALL_API_KEY! });
const openai = new OpenAI();

const agent = pc.agent("basic-agent", {
    voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
    turnDetection: "smart_turn",
});

agent.addChannel("phone", process.env.PINECALL_PHONE ?? "+13186330963");

agent.on("call.started", (call: Call) => {
    call.say("Hey! How can I help you?");
});

agent.on("turn.end", async (turn: Turn, call: Call) => {
    const stream = call.replyStream(turn);

    const completion = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
            { role: "system", content: "You are a helpful voice assistant. Be concise — 1-2 sentences." },
            { role: "user", content: turn.text },
        ],
        stream: true,
    });

    for await (const chunk of completion) {
        if (stream.aborted) break;
        const token = chunk.choices[0]?.delta?.content;
        if (token) stream.write(token);
    }

    stream.end();
});

await pc.connect();
console.log("🎙️ Agent is live! Waiting for calls…");
