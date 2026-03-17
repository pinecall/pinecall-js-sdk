/**
 * @tool decorator — marks a class method as an agent tool.
 *
 * Usage (TypeScript with decorators):
 *   @tool("Description", { param: { type: "string", description: "..." } })
 *   async myMethod({ param }) { ... }
 *
 * JS fallback (no decorator support):
 *   MyAgent.defineTool("myMethod", "Description", { ... });
 *
 * Ported from Drift framework (pinecode-v3/drift).
 */

// ── Metadata key for decorated tools ──

const TOOL_METADATA_KEY = Symbol("pinecall:tools");

interface ToolParamSchema {
    type: string;
    description: string;
    items?: { type: string };
    enum?: string[];
}

interface ToolSchema {
    [paramName: string]: ToolParamSchema;
}

interface ToolMeta {
    methodName: string;
    description: string;
    schema: ToolSchema;
    required: string[];
}

/**
 * @tool decorator — marks a class method as an agent tool.
 *
 * Supports both TC39 stage-3 decorators (esbuild/tsup) and
 * legacy experimentalDecorators (tsc). Detection is automatic.
 *
 * @param description - Human-readable description of what the tool does
 * @param schema - Parameter schema { paramName: { type, description } }
 * @param required - Optional list of required params (defaults to all params)
 */
export function tool(
    description: string,
    schema: ToolSchema,
    required?: string[],
): any {
    return function (...args: any[]) {
        if (
            args.length === 2 &&
            typeof args[1] === "object" &&
            args[1] !== null &&
            "name" in args[1] &&
            "kind" in args[1]
        ) {
            // TC39 stage-3 decorator
            const [_value, context] = args;
            const methodName = String(context.name);
            const meta: ToolMeta = {
                methodName,
                description,
                schema,
                required: required ?? Object.keys(schema),
            };

            context.addInitializer(function (this: any) {
                const proto = Object.getPrototypeOf(this);
                const existing: ToolMeta[] = proto[TOOL_METADATA_KEY] ?? [];
                if (!existing.some((m: ToolMeta) => m.methodName === methodName)) {
                    proto[TOOL_METADATA_KEY] = [...existing, meta];
                }
            });
        } else {
            // Legacy experimentalDecorators
            const [target, propertyKey] = args;
            const methodName = String(propertyKey);
            const meta: ToolMeta = {
                methodName,
                description,
                schema,
                required: required ?? Object.keys(schema),
            };

            const existing: ToolMeta[] = (target as any)[TOOL_METADATA_KEY] ?? [];
            (target as any)[TOOL_METADATA_KEY] = [...existing, meta];
        }
    };
}

/**
 * Get all @tool metadata from a class prototype chain.
 * Walks up the chain so inherited tools are included.
 */
export function getToolMetadata(prototype: any): ToolMeta[] {
    const tools: ToolMeta[] = [];
    const seen = new Set<string>();

    let current = prototype;
    while (current && current !== Object.prototype) {
        const meta: ToolMeta[] = current[TOOL_METADATA_KEY] ?? [];

        for (const t of meta) {
            if (!seen.has(t.methodName)) {
                seen.add(t.methodName);
                tools.push(t);
            }
        }
        current = Object.getPrototypeOf(current);
    }

    return tools;
}
