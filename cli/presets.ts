/**
 * Shared language presets for Pinecall CLI and examples.
 */

export interface Preset {
    voice: string;
    stt: { provider: string; language: string; model?: string };
    turnDetection: string;
    greeting: string;
    system: string;
    errorMsg: string;
}

export const presets: Record<string, Preset> = {
    en: {
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        stt: { provider: "deepgram-flux", language: "en" },
        turnDetection: "smart_turn",
        greeting: "Hey! How can I help you today?",
        system:
            "You are a friendly voice assistant. Keep responses short and conversational — 1-2 sentences max. You're on a phone call.",
        errorMsg: "Sorry, I had a technical issue. Could you repeat that?",
    },
    es: {
        voice: "elevenlabs:htFfPSZGJwjBv1CL0aMD",
        stt: { provider: "deepgram", language: "es", model: "nova-3" },
        turnDetection: "smart_turn",
        greeting: "¡Hola! ¿En qué te puedo ayudar hoy?",
        system:
            "Eres un asistente de voz amigable. Responde de forma breve y conversacional — 1-2 oraciones máximo. Estás en una llamada telefónica.",
        errorMsg: "Perdón, tuve un problema técnico. ¿Podés repetir?",
    },
};

export function getPreset(lang: string): Preset {
    const p = presets[lang];
    if (!p) {
        console.error(`Unknown language: ${lang}. Available: ${Object.keys(presets).join(", ")}`);
        process.exit(1);
    }
    return p;
}

/**
 * Resolve env vars needed by all CLI commands.
 */
export function resolveEnv() {
    const apiKey = process.env.PINECALL_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const url = process.env.PINECALL_URL ?? "wss://voice.pinecall.io/client";
    const phone = process.env.PINECALL_PHONE ?? "+13186330963";

    if (!apiKey) {
        console.error("❌ Set PINECALL_API_KEY env var");
        process.exit(1);
    }

    return { apiKey, openaiKey, url, phone };
}
