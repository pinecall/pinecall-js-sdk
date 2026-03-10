/**
 * `pinecall phone-numbers` — List phone numbers on your account.
 *
 * Usage:
 *   pinecall phone-numbers
 *   pinecall phones               # alias
 */

import { Pinecall } from "@pinecall/sdk";
import { resolveEnv } from "../presets.js";

export async function phonesCommand(_args: string[]) {
    const env = resolveEnv();

    console.log("\n  📞 Fetching phone numbers…\n");

    try {
        const phones = await Pinecall.fetchPhones({ apiKey: env.apiKey });

        if (phones.length === 0) {
            console.log("  No phone numbers found.\n");
            return;
        }

        for (const p of phones) {
            const sdk = (p as any).isSdk ? " 📱 SDK" : "";
            console.log(`  ${p.number}  ${p.name}${sdk}`);
        }

        console.log(`\n  ${phones.length} phone numbers\n`);
    } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}\n`);
        process.exit(1);
    }
}
