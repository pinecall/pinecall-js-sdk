/**
 * English voice agent — Flux STT, native turn detection.
 *
 * Usage: pinecall run examples/agent-en.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class FluxPhone extends Phone {
    number = "+13186330963";

    // Flux — English only, ultra-low latency, built-in turn detection
    stt = {
        provider: "deepgram-flux",
        language: "en",
        eot_threshold: 0.7,
        eager_eot_threshold: 0.5,
    };

    turnDetection = "native";

    // Interruption fine-tuning
    interruption = {
        enabled: true,
        energy_threshold_db: -35.0,
        min_duration_ms: 300,
    };

    // TTS fine-tuning
    config = {
        tts: {
            provider: "elevenlabs",
            voice_id: "EXAVITQu4vr4xnSDxMaL",  // Sarah
            model: "eleven_flash_v2_5",
            speed: 1.0,
            stability: 0.5,
            similarity_boost: 0.8,
        },
    };
}

class AgentEN extends GPTAgent {
    model = "gpt-4.1-nano";
    voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";  // Sarah
    phone = new FluxPhone();
    instructions = "You are a helpful voice assistant. Be concise — 1-2 sentences max.";
    greeting = "Hey! How can I help you?";
}

export default AgentEN;
