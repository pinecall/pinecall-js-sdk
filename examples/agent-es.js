/**
 * Spanish voice agent — full config example.
 *
 * Shows per-channel voice, greeting, STT keyterms,
 * interruption thresholds — all as class fields.
 *
 * Usage: pinecall run examples/agent-es.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class SpanishPhone extends Phone {
    number = "+13186330963";
    language = "es";
    greeting = "¡Hola! ¿En qué te puedo ayudar?";

    // Voice — full TTS config
    voice = {
        provider: "elevenlabs",
        voice_id: "VmejBeYhbrcTPwDniox7",   // Lina - Carefree & Fresh
        model: "eleven_flash_v2_5",
        speed: 1.05,
        stability: 0.55,
        similarity_boost: 0.8,
        language: "es",
    };

    // STT — Deepgram Nova-3 with keyword boosting
    stt = {
        provider: "deepgram",
        model: "nova-3",
        language: "es",
        keywords: ["Pinecall", "GPTAgent"],
    };

    turnDetection = "smart_turn";

    // Interruption — require 300ms of speech at -35dB to barge in
    interruption = {
        enabled: true,
        energy_threshold_db: -35.0,
        min_duration_ms: 300,
    };
}

class AgentES extends GPTAgent {
    model = "gpt-4.1-nano";
    phone = new SpanishPhone();
    instructions = "Eres un asistente de voz amigable y conversacional. Responde de forma natural y útil, en 2-3 oraciones. Sé cálido y profesional.";
}

export default AgentES;
