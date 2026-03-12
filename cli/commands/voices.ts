/**
 * pinecall voices — list available TTS voices.
 *
 * Multi-provider support with dynamic terminal width.
 */

import { fetchVoices, type Voice } from "@pinecall/sdk";
import { parseArgs } from "../lib/args.js";
import { printHeader, writeln, logLine } from "../ui/renderer.js";
import { ACCENT, MUTED, DIM, OK } from "../ui/theme.js";

export default async function voices(argv: string[]): Promise<void> {
    const args = parseArgs(argv, {
        values: ["--provider", "--lang"],
    });

    const provider = args.values.get("--provider") ?? "elevenlabs";
    const language = args.values.get("--lang");

    printHeader(`Voices — ${provider}`);

    const voiceList = await fetchVoices({ provider, language });

    if (voiceList.length === 0) {
        logLine(`${DIM("No voices found")}`);
        return;
    }

    // ── Table layout ──
    const termWidth = Math.min(process.stdout.columns || 120, 120);
    const colId = 32;
    const colName = 24;
    const colGender = 8;
    const colLangs = Math.max(termWidth - colId - colName - colGender - 16, 20);

    // Header
    writeln("");
    writeln(
        `  ${MUTED("ID".padEnd(colId))} ` +
        `${MUTED("Name".padEnd(colName))} ` +
        `${MUTED("Gender".padEnd(colGender))} ` +
        `${MUTED("Languages")}`,
    );
    writeln(`  ${MUTED("─".repeat(Math.min(termWidth - 4, 116)))}`);

    // Rows
    for (const v of voiceList) {
        const langs = v.languages.map((l) => l.code).join(", ");
        const gender = v.gender ?? "";

        writeln(
            `  ${ACCENT(v.id.padEnd(colId))} ` +
            `${v.name.padEnd(colName)} ` +
            `${DIM(gender.padEnd(colGender))} ` +
            `${DIM(langs.length > colLangs ? langs.slice(0, colLangs - 1) + "…" : langs)}`,
        );
    }

    writeln("");
    writeln(`  ${OK(`${voiceList.length} voices`)} ${DIM(`(${provider})`)}`);
    writeln("");
}
