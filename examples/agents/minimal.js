/**
 * Simplest possible GPTAgent — one phone, one voice, one prompt.
 *
 * Usage: pinecall run examples/agents/minimal.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class MinimalAgent extends GPTAgent {
    model = "gpt-4.1-nano";
    phone = new Phone({
        number: "+13186330963",
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        greeting: "Hey! How can I help you?",
        stt: { provider: "deepgram-flux" },
        turnDetection: "native",
    });
    instructions = "You are a helpful voice assistant. Be concise — 2-3 sentences max.";
}

export default MinimalAgent;
