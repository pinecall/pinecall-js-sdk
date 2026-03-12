/**
 * Shared LLM streaming handler — extracts the duplicated 31-line handler
 * from agent.ts and dial.ts into a single reusable function.
 */

import type OpenAI from "openai";
import type { Call, Turn } from "@pinecall/sdk";

export interface LLMContext {
    openai: OpenAI;
    model: string;
    history: { role: string; content: string }[];
    errorMsg: string;
}

/**
 * Stream an LLM reply for a turn.
 *
 * 1. Pushes the user turn into history
 * 2. Creates a replyStream on the call
 * 3. Streams the OpenAI completion into the stream
 * 4. Pushes the assistant reply into history
 * 5. Falls back to call.reply(errorMsg) on error
 */
export async function streamLLMReply(
    call: Call,
    turn: Turn,
    ctx: LLMContext,
): Promise<string | null> {
    ctx.history.push({ role: "user", content: turn.text });

    const stream = call.replyStream(turn);

    try {
        const completion = await ctx.openai.chat.completions.create({
            model: ctx.model,
            messages: ctx.history as OpenAI.ChatCompletionMessageParam[],
            stream: true,
        });

        let reply = "";
        for await (const chunk of completion) {
            if (stream.aborted) break;
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
                stream.write(token);
                reply += token;
            }
        }

        stream.end();

        if (!stream.aborted && reply) {
            ctx.history.push({ role: "assistant", content: reply });
        }

        return stream.aborted ? null : reply;
    } catch {
        stream.end();
        call.reply(ctx.errorMsg);
        return null;
    }
}
