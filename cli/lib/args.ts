/**
 * Typed argument parser — replaces the three hand-rolled arg.split("=") loops.
 *
 * Usage:
 *   const args = parseArgs(process.argv.slice(3), {
 *       flags: ["--es", "--verbose"],
 *       values: ["--lang", "--provider", "--from"],
 *       positional: "to",
 *   });
 *   args.flags.has("--es");         // boolean
 *   args.values.get("--provider");  // string | undefined
 *   args.positional;                // string | undefined
 */

export interface ArgSchema {
    /** Boolean flags, e.g. ["--es", "--verbose"] */
    flags?: string[];
    /** Key=value args, e.g. ["--lang", "--provider"] */
    values?: string[];
    /** Name for the first bare positional argument */
    positional?: string;
}

export interface ParsedArgs {
    flags: Set<string>;
    values: Map<string, string>;
    positional?: string;
}

export function parseArgs(argv: string[], schema: ArgSchema = {}): ParsedArgs {
    const flags = new Set<string>();
    const values = new Map<string, string>();
    let positional: string | undefined;

    const flagSet = new Set(schema.flags ?? []);
    const valueSet = new Set(schema.values ?? []);

    for (const arg of argv) {
        // --key=value form
        const eqIdx = arg.indexOf("=");
        if (eqIdx !== -1) {
            const key = arg.slice(0, eqIdx);
            const val = arg.slice(eqIdx + 1);
            if (valueSet.has(key)) {
                values.set(key, val);
            }
            continue;
        }

        // --flag form (also supports --es as a shortcut for --lang=es style flags)
        if (arg.startsWith("--")) {
            if (flagSet.has(arg)) {
                flags.add(arg);
            } else if (valueSet.has(arg)) {
                // Flag-style value without =, skip (unsupported)
            }
            continue;
        }

        // Bare positional
        if (schema.positional && !positional) {
            positional = arg;
        }
    }

    return { flags, values, positional };
}
