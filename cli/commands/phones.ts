/**
 * pinecall phones — list phone numbers on your account.
 *
 * Architecture supports future subcommands (buy, drop) via pattern below.
 */

import { resolveEnv } from "../lib/env.js";
import { CliError } from "../lib/errors.js";
import { printHeader, writeln, logLine } from "../ui/renderer.js";
import { ACCENT, MUTED, DIM, OK } from "../ui/theme.js";
import { Pinecall } from "@pinecall/sdk";

// ── Subcommands ──────────────────────────────────────────────────────────

async function listPhones(): Promise<void> {
    const env = resolveEnv();
    const phones = await Pinecall.fetchPhones({ apiKey: env.apiKey });

    printHeader("Phone Numbers");

    if (phones.length === 0) {
        logLine(`${DIM("No phone numbers found")}`);
        writeln(`  ${DIM("Add one at")} ${ACCENT("https://app.pinecall.io/phones")}`);
        writeln("");
        return;
    }

    writeln("");
    writeln(`  ${MUTED("Number".padEnd(20))} ${MUTED("Name".padEnd(24))} ${MUTED("SID")}`);
    writeln(`  ${MUTED("─".repeat(64))}`);

    for (const p of phones) {
        writeln(
            `  ${ACCENT(p.number.padEnd(20))} ` +
            `${p.name.padEnd(24)} ` +
            `${DIM(p.sid)}`,
        );
    }

    writeln("");
    writeln(`  ${OK(`${phones.length} phone number${phones.length === 1 ? "" : "s"}`)}`);
    writeln("");
}

// Future: async function buyPhone(): Promise<void> { ... }
// Future: async function dropPhone(number: string): Promise<void> { ... }

// ── Router ───────────────────────────────────────────────────────────────

export default async function phones(argv: string[]): Promise<void> {
    const subcommand = argv[0] ?? "list";

    switch (subcommand) {
        case "list":
        case undefined:
            return listPhones();

        // Future:
        // case "buy":
        //     return buyPhone();
        // case "drop":
        //     return dropPhone(argv[1]);

        default:
            throw new CliError(`Unknown phones subcommand: "${subcommand}". Available: list`);
    }
}
