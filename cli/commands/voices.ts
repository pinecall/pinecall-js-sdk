/**
 * `pinecall voices` — List available TTS voices.
 *
 * Usage:
 *   pinecall voices                        # ElevenLabs (default)
 *   pinecall voices --provider=cartesia    # Cartesia
 *   pinecall voices --lang=es             # Filter by language
 */

import { Pinecall } from "@pinecall/sdk";

export async function voicesCommand(args: string[]) {
    let provider = "elevenlabs";
    let language = "";

    for (const arg of args) {
        if (arg.startsWith("--provider=")) provider = arg.split("=")[1];
        else if (arg.startsWith("--lang=")) language = arg.split("=")[1];
    }

    console.log(`\n  🎤 Fetching ${provider} voices${language ? ` (${language})` : ""}…\n`);

    try {
        const voices = await Pinecall.fetchVoices({ provider, language: language || undefined });

        if (voices.length === 0) {
            console.log("  No voices found.\n");
            return;
        }

        // Table header
        console.log(
            "  " +
            "Name".padEnd(45) +
            "ID".padEnd(28) +
            "Gender".padEnd(10) +
            "Languages",
        );
        console.log("  " + "─".repeat(100));

        for (const v of voices) {
            const langs = (v as any).languages
                ?.map((l: any) => `${l.flag || ""} ${l.code}`)
                .join(", ") ?? "";
            console.log(
                "  " +
                (v.name || "").slice(0, 44).padEnd(45) +
                v.id.slice(0, 27).padEnd(28) +
                ((v as any).gender || "").padEnd(10) +
                langs.slice(0, 40),
            );
        }

        console.log(`\n  ${voices.length} voices total\n`);
    } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}\n`);
        process.exit(1);
    }
}
