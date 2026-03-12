/**
 * Environment variable resolution — throws CliError instead of process.exit().
 */

import { CliError } from "./errors.js";
import { DEFAULT_WS_URL } from "./constants.js";

export interface Env {
    apiKey: string;
    openaiKey?: string;
    url: string;
}

/**
 * Resolve required environment variables.
 * Throws CliError if PINECALL_API_KEY is missing.
 */
export function resolveEnv(): Env {
    const apiKey = process.env.PINECALL_API_KEY;
    if (!apiKey) {
        throw new CliError(
            "Missing PINECALL_API_KEY environment variable.\n" +
            "  Get your key at https://app.pinecall.io/settings",
        );
    }

    return {
        apiKey,
        openaiKey: process.env.OPENAI_API_KEY,
        url: process.env.PINECALL_URL ?? DEFAULT_WS_URL,
    };
}

/**
 * Assert that OPENAI_API_KEY is available.
 * Throws CliError if missing.
 */
export function requireOpenAI(env: Env): asserts env is Env & { openaiKey: string } {
    if (!env.openaiKey) {
        throw new CliError(
            "Missing OPENAI_API_KEY environment variable.\n" +
            "  Get your key at https://platform.openai.com/api-keys",
        );
    }
}
