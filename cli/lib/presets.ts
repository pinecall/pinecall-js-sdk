/**
 * Language presets — pure data, no I/O.
 */

import type { STTShortcut, TurnDetectionShortcut } from "@pinecall/sdk";
import { CliError } from "./errors.js";

export interface Preset {
    voice: string;
    stt: STTShortcut;
    turnDetection: TurnDetectionShortcut;
    greeting: string;
    system: string;
    errorMsg: string;
}

export const presets: Record<string, Preset> = {
    en: {
        voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
        stt: { provider: "deepgram-flux", language: "en" },
        turnDetection: "native",
        greeting: "Hey! How can I help you?",
        system: "You are a helpful voice assistant. Be concise — 1-2 sentences.",
        errorMsg: "Sorry, I'm having trouble processing your request. Please try again.",
    },
    es: {
        voice: "elevenlabs:htFfPSZGJwjBv1CL0aMD",
        stt: { provider: "deepgram", language: "es", model: "nova-3" },
        turnDetection: "smart_turn",
        greeting: "¡Hola! ¿En qué te puedo ayudar?",
        system: "Eres un asistente de voz. Responde breve — 1-2 oraciones máximo.",
        errorMsg: "Lo siento, no pude procesar tu petición. Intenta de nuevo.",
    },
};

/**
 * Get a preset by language code.
 * Throws CliError on unknown language.
 */
export function getPreset(lang: string): Preset {
    const preset = presets[lang];
    if (!preset) {
        const available = Object.keys(presets).join(", ");
        throw new CliError(`Unknown language: "${lang}". Available: ${available}`);
    }
    return preset;
}
