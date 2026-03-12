/**
 * Custom LLM agent — extends Agent directly, bring your own LLM.
 *
 * Shows how to handle turns manually without GPTAgent/OpenAI.
 * Override onTurn() to call any LLM, RAG pipeline, or hardcoded logic.
 *
 * Usage: pinecall run examples/agents/CustomLLM.js
 */

import { Agent, Phone } from "@pinecall/sdk/ai";

class CustomLLM extends Agent {
    phone = new Phone({
        number: "+13186330963",
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        greeting: "Hey! I'm a custom agent. Ask me anything!",
    });

    instructions = "You are a helpful voice assistant.";

    // ── Your LLM handler ─────────────────────────────────────────────

    async onTurn(turn, call, history) {
        // Replace this with your LLM call (Anthropic, Gemini, local, etc.)
        const reply = `You said: "${turn.text}"`;
        call.reply(reply);
        history.addAssistant(reply);
    }

    // ── Optional lifecycle hooks ─────────────────────────────────────

    onCallStarted(call) {
        console.log(`  call.started  ${call.direction}  ${call.from} → ${call.to}`);
    }

    onCallEnded(call, reason) {
        console.log(`  call.ended    reason=${reason}`);
    }

    onUserMessage(event, call) {
        console.log(`  user.message  "${event.text}"`);
    }

    onBotFinished(event, call) {
        console.log(`  bot.finished  ${event.duration_ms}ms`);
    }

    onBotInterrupted(event, call) {
        console.log(`  bot.interrupted  reason=${event.reason}`);
    }
}

export default CustomLLM;
