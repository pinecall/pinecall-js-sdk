/**
 * Shared language presets and env helpers for Pinecall CLI.
 */

import { Pinecall } from "@pinecall/sdk";
import chalk from "chalk";
import * as readline from "node:readline";

// ─── Presets ─────────────────────────────────────────────────────────────

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
        turnDetection: "native",
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

// ─── Env ─────────────────────────────────────────────────────────────────

export function resolveEnv() {
    const apiKey = process.env.PINECALL_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const url = process.env.PINECALL_URL ?? "wss://voice.pinecall.io/client";

    if (!apiKey) {
        console.error("❌ Set PINECALL_API_KEY env var");
        process.exit(1);
    }

    return { apiKey, openaiKey, url };
}

// ─── Phone picker ────────────────────────────────────────────────────────

const DIM = chalk.dim;
const ACCENT = chalk.hex("#06B6D4");
const OK = chalk.hex("#10B981");

/**
 * Fetch phone numbers from the API and let the user pick one.
 * If only one phone is available, auto-selects it.
 */
export async function pickPhone(apiKey: string): Promise<string> {
    const phones = await Pinecall.fetchPhones({ apiKey });

    if (phones.length === 0) {
        console.error("❌ No phone numbers found. Add one at app.pinecall.io");
        process.exit(1);
    }

    // Auto-select if only one
    if (phones.length === 1) {
        return phones[0].number;
    }

    // Show list and let user pick
    console.log(`\n  ${chalk.white.bold("Select a phone number:")}\n`);

    for (let i = 0; i < phones.length; i++) {
        const p = phones[i];
        const num = ACCENT(p.number);
        const name = DIM(p.name !== p.number ? p.name : "");
        console.log(`  ${chalk.white.bold(`${i + 1})`)} ${num}  ${name}`);
    }

    console.log();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const choice = await new Promise<string>((resolve) => {
        rl.question(`  ${DIM("›")} Pick [1-${phones.length}]: `, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= phones.length) {
        // Default to first
        return phones[0].number;
    }

    const selected = phones[idx].number;
    console.log(`  ${OK("✓")} ${selected}\n`);
    return selected;
}
