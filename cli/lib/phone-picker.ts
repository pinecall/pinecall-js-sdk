/**
 * Interactive phone number selection.
 * Extracted from presets.ts:pickPhone() — throws CliError instead of process.exit().
 */

import { createInterface } from "readline";
import { Pinecall } from "@pinecall/sdk";
import { CliError } from "./errors.js";

/**
 * Fetch phone numbers and let the user pick one interactively.
 * If only one phone exists, auto-selects it.
 *
 * @returns The selected phone number string (E.164 format).
 */
export async function pickPhone(pc: Pinecall): Promise<string> {
    const phones = await pc.fetchPhones();

    if (phones.length === 0) {
        throw new CliError(
            "No phone numbers found on your account.\n" +
            "  Add one at https://app.pinecall.io/phones",
        );
    }

    // Auto-select if only one
    if (phones.length === 1) {
        return phones[0].number;
    }

    // Interactive selection
    console.log("\n  Available phone numbers:\n");
    phones.forEach((p, i) => {
        console.log(`    ${i + 1}) ${p.name}  ${p.number}`);
    });
    console.log();

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise<string>((resolve, reject) => {
        rl.question("  Select a number (1-" + phones.length + "): ", (answer) => {
            rl.close();
            const idx = parseInt(answer, 10) - 1;
            if (isNaN(idx) || idx < 0 || idx >= phones.length) {
                reject(new CliError("Invalid selection."));
                return;
            }
            resolve(phones[idx].number);
        });
    });
}
