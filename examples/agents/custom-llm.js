/**
 * Custom LLM agent — extends Agent directly, no OpenAI.
 *
 * Shows all available event hooks as class methods.
 *
 * Usage: pinecall run examples/agents/custom-llm.js
 */

import { Agent, Phone } from "@pinecall/sdk/ai";

class MyPhone extends Phone {
    number = "+13186330963";
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
    greeting = "Hey! I'm a custom agent. Ask me anything!";
    stt = { provider: "deepgram-flux" };
    turnDetection = "native";
}

class CustomAgent extends Agent {
    phone = new MyPhone();
    instructions = "You are a helpful voice assistant.";

    // ── LLM handler ─────────────────────────────────────────────────────

    async onTurn(turn, call, history) {
        const messages = history.toMessages();
        const reply = `You said: "${turn.text}"`;
        call.reply(reply);
        history.addAssistant(reply);
    }

    // ── Call lifecycle ───────────────────────────────────────────────────

    onCallStarted(call) {
        console.log(`  call.started  ${call.direction}  ${call.from} → ${call.to}`);
    }

    onCallEnded(call, reason) {
        console.log(`  call.ended    reason=${reason}`);
    }

    // ── Speech & transcripts ────────────────────────────────────────────

    onSpeechStarted(event, call) { }
    onSpeechEnded(event, call) { }
    onUserSpeaking(event, call) { }
    onUserMessage(event, call) {
        console.log(`  user.message  "${event.text}"`);
    }

    // ── Turn detection ──────────────────────────────────────────────────

    onEagerTurn(turn, call) { }
    onTurnEnd(turn, call) { }
    onTurnPause(event, call) { }
    onTurnContinued(event, call) { }
    onTurnResumed(event, call) { }

    // ── Bot speech ──────────────────────────────────────────────────────

    onBotSpeaking(event, call) { }
    onBotWord(event, call) { }
    onBotFinished(event, call) {
        console.log(`  bot.finished  ${event.duration_ms}ms`);
    }
    onBotInterrupted(event, call) {
        console.log(`  bot.interrupted  reason=${event.reason}`);
    }

    // ── Confirmations ───────────────────────────────────────────────────

    onMessageConfirmed(event, call) { }
    onReplyRejected(event, call) { }

    // ── Channels ────────────────────────────────────────────────────────

    onChannelAdded(type, ref) {
        console.log(`  channel.added ${type} ${ref}`);
    }
}

export default CustomAgent;
