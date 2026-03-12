/**
 * TUI LLM pane — streams LLM activity into the right pane.
 *
 * Two modes:
 *  1. `agent`/`dial` commands → use streamLLMReplyWithTUI() wrapper
 *  2. `run` command (GPTAgent) → listen for llm.* events on core agent
 *
 * Design:
 *   ┌─ LLM / Tools ────────────────────────────┐
 *   │ ── reply_to: msg_abc123 ──────────────── │
 *   │ user: "Book a table for 2"               │
 *   │ → GPT gpt-4.1-nano                       │
 *   │   Sure, let me check availability...     │
 *   │                                           │
 *   │ 🔧 bookTable({"date":"2026-03-12",...})   │
 *   │   → { confirmed: true }                  │
 *   │                                           │
 *   │ ── GPT (tool round 2) ────────────────── │
 *   │   Done! Your table is booked for 2.      │
 *   │ ✓ 127 tokens                              │
 *   └──────────────────────────────────────────-┘
 */

import type OpenAI from "openai";
import type { Agent, Call, Turn } from "@pinecall/sdk";
import type { CallSidebar } from "./tui-sidebar.js";

// ── Timestamp helper ─────────────────────────────────────────────────────

function ts(): string {
    return `{gray-fg}${new Date().toLocaleTimeString("en-US", { hour12: false })}{/gray-fg}`;
}

// ── LLM context (same as cli/lib/llm.ts) ─────────────────────────────────

export interface LLMContext {
    openai: OpenAI;
    model: string;
    history: { role: string; content: string }[];
    errorMsg: string;
}

// ── streamLLMReplyWithTUI — for agent/dial commands ──────────────────────

/**
 * Stream an LLM reply and log activity to the TUI LLM pane.
 * Drop-in replacement for cli/lib/llm.ts:streamLLMReply().
 */
export async function streamLLMReplyWithTUI(
    call: Call,
    turn: Turn,
    ctx: LLMContext,
    sidebar: CallSidebar,
): Promise<string | null> {
    ctx.history.push({ role: "user", content: turn.text });

    // ── Header: show message ID + what we're responding to ──
    const msgId = turn.messageId ? turn.messageId.slice(0, 16) : "?";
    sidebar.logLLM(call.id, `{gray-fg}── reply_to: ${msgId} ──{/gray-fg}`);
    sidebar.logLLM(call.id, `{white-fg}user:{/white-fg} ${turn.text}`);
    sidebar.logLLM(call.id, `${ts()} {cyan-fg}→ GPT{/cyan-fg} {gray-fg}${ctx.model}{/gray-fg}`);

    const stream = call.replyStream(turn);

    try {
        const completion = await ctx.openai.chat.completions.create({
            model: ctx.model,
            messages: ctx.history as OpenAI.ChatCompletionMessageParam[],
            stream: true,
        });

        let reply = "";
        let tokenCount = 0;

        // Start streaming line
        sidebar.logLLM(call.id, "  ");

        for await (const chunk of completion) {
            if (stream.aborted) break;
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
                stream.write(token);
                reply += token;
                tokenCount++;

                // Update streaming line — full text, no truncation
                sidebar.updateLastLLMLine(call.id, `  {white-fg}${reply}{/white-fg}`);
            }
        }

        stream.end();

        // Final reply line
        if (reply && !stream.aborted) {
            sidebar.updateLastLLMLine(call.id, `  {white-fg}${reply}{/white-fg}`);
            sidebar.logLLM(call.id, `{green-fg}✓{/green-fg} {gray-fg}${tokenCount} tokens{/gray-fg}`);
            sidebar.logLLM(call.id, "");
            ctx.history.push({ role: "assistant", content: reply });
        } else if (stream.aborted) {
            sidebar.updateLastLLMLine(call.id, `  {yellow-fg}[aborted]{/yellow-fg}`);
            sidebar.logLLM(call.id, "");
        }

        return stream.aborted ? null : reply;
    } catch {
        stream.end();
        sidebar.logLLM(call.id, `  {red-fg}✗ LLM error{/red-fg}`);
        sidebar.logLLM(call.id, "");
        call.reply(ctx.errorMsg);
        return null;
    }
}

// ── attachTUILLM — for run command (GPTAgent events) ─────────────────────

/**
 * Listen for llm.* events on the core agent and log them to the LLM pane.
 * These events are emitted by GPTAgent._runLLM() and _executeTools().
 */
export function attachTUILLM(agent: Agent, sidebar: CallSidebar): void {
    // Per-call streaming accumulator
    const replyBuffers = new Map<string, string>();

    agent.on("llm.start" as any, (call: Call, data: any) => {
        const round = data?.round ?? 0;
        const model = data?.model ?? "gpt";
        const messageId = data?.messageId ?? "?";
        const text = data?.text ?? "";

        if (round === 0) {
            const msgId = messageId.slice(0, 16);
            sidebar.logLLM(call.id, `{gray-fg}── reply_to: ${msgId} ──{/gray-fg}`);
            if (text) {
                sidebar.logLLM(call.id, `{white-fg}user:{/white-fg} ${text}`);
            }
            sidebar.logLLM(call.id, `${ts()} {cyan-fg}→ GPT{/cyan-fg} {gray-fg}${model}{/gray-fg}`);
        } else {
            sidebar.logLLM(call.id, `{gray-fg}── GPT (tool round ${round + 1}) ──{/gray-fg}`);
        }
        replyBuffers.set(call.id, "");
        // Start an empty streaming line
        sidebar.logLLM(call.id, "  ");
    });

    agent.on("llm.token" as any, (call: Call, data: any) => {
        const token = data?.token ?? "";
        const buf = (replyBuffers.get(call.id) ?? "") + token;
        replyBuffers.set(call.id, buf);

        // Update streaming line — full text, no truncation
        sidebar.updateLastLLMLine(call.id, `  {white-fg}${buf}{/white-fg}`);
    });

    agent.on("llm.done" as any, (call: Call, data: any) => {
        const reply = replyBuffers.get(call.id) ?? "";
        const aborted = data?.aborted ?? false;

        if (reply && !aborted) {
            sidebar.updateLastLLMLine(call.id, `  {white-fg}${reply}{/white-fg}`);
            const tokens = reply.split(/\s+/).length;
            sidebar.logLLM(call.id, `{green-fg}✓{/green-fg} {gray-fg}~${tokens} tokens{/gray-fg}`);
        } else if (aborted) {
            sidebar.updateLastLLMLine(call.id, `  {yellow-fg}[aborted]{/yellow-fg}`);
        }

        sidebar.logLLM(call.id, "");
        replyBuffers.delete(call.id);
    });

    agent.on("llm.tool_call" as any, (call: Call, data: any) => {
        const name = data?.name ?? "?";
        const args = data?.args ?? "{}";
        let argsFmt: string;
        try {
            argsFmt = JSON.stringify(JSON.parse(args));
        } catch {
            argsFmt = args;
        }
        sidebar.logLLM(call.id, `{yellow-fg}🔧 ${name}{/yellow-fg}{gray-fg}(${argsFmt}){/gray-fg}`);
    });

    agent.on("llm.tool_result" as any, (call: Call, data: any) => {
        let resultStr: string;
        try {
            resultStr = JSON.stringify(data?.result);
        } catch {
            resultStr = String(data?.result);
        }
        sidebar.logLLM(call.id, `  {green-fg}→{/green-fg} ${resultStr}`);
        sidebar.logLLM(call.id, "");
    });

    // ── Agent.log() messages ──
    agent.on("agent.log" as any, (call: Call, msg: string) => {
        sidebar.logLLM(call.id, `  {gray-fg}${msg}{/gray-fg}`);
    });
}
