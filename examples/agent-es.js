/**
 * Spanish voice agent — full config example.
 *
 * Usage: pinecall run examples/agent-es.js
 */

import { GPTAgent, Phone } from "@pinecall/sdk/ai";

class SpanishPhone extends Phone {
    number = "+13186330963";
    language = "es";

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

    // TTS fine-tuning via raw config
    config = {
        tts: {
            provider: "elevenlabs",
            voice_id: "VmejBeYhbrcTPwDniox7",   // Lina - Carefree & Fresh
            model: "eleven_flash_v2_5",
            speed: 1.05,
            stability: 0.55,
            similarity_boost: 0.8,
            language: "es",
        },
    };
}

class AgentES extends GPTAgent {
    model = "gpt-4.1-nano";
    voice = "elevenlabs:VmejBeYhbrcTPwDniox7"; // Lina - Carefree & Fresh
    phone = new SpanishPhone();
    instructions = "Eres un asistente de voz amigable y conversacional. Responde de forma natural y útil, en 2-3 oraciones. Sé cálido y profesional.";
    greeting = "¡Hola! ¿En qué te puedo ayudar?";
}

export default AgentES;
