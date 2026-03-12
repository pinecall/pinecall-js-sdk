/**
 * `pinecall agent` — Start an inbound voice agent.
 *
 * Usage:
 *   pinecall agent              # English (default)
 *   pinecall agent --es         # Spanish
 *   pinecall agent --lang=fr    # Any language code
 */

import { Pinecall, type Turn, type Call } from "@pinecall/sdk";
import OpenAI from "openai";
import { getPreset, resolveEnv, pickPhone } from "../presets.js";
import { createUI } from "../ui.js";

export async function agentCommand(args: string[]) {
    // Parse lang from args
    let lang = "en";
    for (const arg of args) {
        if (arg === "--es") lang = "es";
        else if (arg.startsWith("--lang=")) lang = arg.split("=")[1];
    }

    const preset = getPreset(lang);
    const env = resolveEnv();

    if (!env.openaiKey) {
        console.error("❌ Set OPENAI_API_KEY env var for the agent command");
        process.exit(1);
    }

    // Pick a phone number from your account
    const phone = await pickPhone(env.apiKey);

    const openai = new OpenAI({ apiKey: env.openaiKey });
    const histories = new Map<string, { role: string; content: string }[]>();
    let systemPrompt = preset.system;

    function getHistory(callId: string) {
        if (!histories.has(callId)) {
            histories.set(callId, [{ role: "system", content: systemPrompt }]);
        }
        return histories.get(callId)!;
    }

    // ── UI ───────────────────────────────────────────────────────────────

    const ui = createUI({
        title: `Agent · ${lang.toUpperCase()}`,
        subtitle: "Inbound voice agent with OpenAI",
        getInstructions: () => systemPrompt,
        setInstructions: (prompt) => {
            systemPrompt = prompt;
            // Update existing histories too
            for (const h of histories.values()) {
                if (h[0]?.role === "system") h[0].content = prompt;
            }
        },
    });

    // ── Connection + Agent ──────────────────────────────────────────────

    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url });

    const agent = pc.agent("openai-agent", {
        voice: preset.voice,
        stt: preset.stt as any,
        turnDetection: preset.turnDetection,
        language: lang,
    });

    agent.addChannel("phone", phone);

    // ── Greeting ─────────────────────────────────────────────────────────

    agent.on("call.started", (call: Call) => {
        call.say(preset.greeting);
    });

    // ── LLM streaming on eager.turn ──────────────────────────────────────

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
            console.error(`  ✖ OpenAI error:`, err);
            stream.end();
            call.reply(preset.errorMsg);
        }
    });

    agent.on("call.ended", (call: Call) => {
        histories.delete(call.id);
    });

    // ── Connect ──────────────────────────────────────────────────────────

    ui.header();

    await pc.connect();

    ui.status("Connected", agent.id);
    ui.status("Phone", phone);

    const voiceParts = preset.voice.split(":");
    ui.config({
        stt: `${preset.stt.provider}${preset.stt.model ? ` · ${preset.stt.model}` : ""}`,
        tts: `${voiceParts[0]} · ${voiceParts[1]?.slice(0, 8)}…`,
        turn: preset.turnDetection,
        llm: "gpt-4.1-nano",
    });

    ui.attach(agent);
    ui.waiting();
}
