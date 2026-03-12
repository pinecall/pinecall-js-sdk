/**
 * Call — per-session handle for interacting with a voice call.
 *
 * Created automatically when `call.started` is received.
 * Provides high-level methods: say(), reply(), replyStream(), hold(), mute(), cancel(), hangup().
 *
 * Tracks `lastMessageId` from user.message events for automatic `in_reply_to`.
 */

import { TypedEmitter } from "./utils/emitter.js";
import { generateId } from "./utils/id.js";
import { ReplyStream } from "./stream.js";
import type {
    SpeechStartedEvent,
    SpeechEndedEvent,
    UserSpeakingEvent,
    UserMessageEvent,
    EagerTurnEvent,
    TurnPauseEvent,
    TurnEndEvent,
    TurnResumedEvent,
    TurnContinuedEvent,
    BotSpeakingEvent,
    BotWordEvent,
    BotFinishedEvent,
    BotInterruptedEvent,
    MessageConfirmedEvent,
    ReplyRejectedEvent,
    AudioMetricsEvent,
} from "./types/events.js";
import type { SessionConfig } from "./types/config.js";

// ─── Turn data object ────────────────────────────────────────────────────

export interface Turn {
    id: number;
    messageId: string;
    text: string;
    confidence: number;
    language?: string;
    probability: number;
    latencyMs: number;
}

// ─── Call-scoped event map ───────────────────────────────────────────────

export interface CallEvents {
    [key: string]: (...args: any[]) => void;
    "speech.started": (event: SpeechStartedEvent) => void;
    "speech.ended": (event: SpeechEndedEvent) => void;
    "user.speaking": (event: UserSpeakingEvent) => void;
    "user.message": (event: UserMessageEvent) => void;
    "eager.turn": (turn: Turn) => void;
    "turn.pause": (event: TurnPauseEvent) => void;
    "turn.end": (turn: Turn) => void;
    "turn.resumed": (event: TurnResumedEvent) => void;
    "turn.continued": (event: TurnContinuedEvent) => void;
    "bot.speaking": (event: BotSpeakingEvent) => void;
    "bot.word": (event: BotWordEvent) => void;
    "bot.finished": (event: BotFinishedEvent) => void;
    "bot.interrupted": (event: BotInterruptedEvent) => void;
    "message.confirmed": (event: MessageConfirmedEvent) => void;
    "reply.rejected": (event: ReplyRejectedEvent) => void;
    "audio.metrics": (event: AudioMetricsEvent) => void;
    "call.held": () => void;
    "call.unheld": () => void;
    "call.muted": () => void;
    "call.unmuted": (mutedTranscript: string | null) => void;
    "ended": (reason: string) => void;
}

// ─── Reply options ───────────────────────────────────────────────────────

export interface ReplyOptions {
    messageId?: string;
    inReplyTo?: string;
}

export interface ForwardOptions {
    message?: string;
    announce?: boolean;
}

// ─── Call class ──────────────────────────────────────────────────────────

export class Call extends TypedEmitter<CallEvents> {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly direction: "inbound" | "outbound";
    readonly metadata: Record<string, unknown>;

    /** Auto-tracked from the latest user.message. Used as default `in_reply_to`. */
    lastMessageId: string | null = null;

    /** Active ReplyStreams — aborted automatically on turn.continued. */
    private _activeStreams = new Set<ReplyStream>();

    /** Send function provided by Pinecall client. */
    private _send: (data: Record<string, unknown>) => void;

    // Latest turn data (built from eager.turn + user.message + turn.end)
    private _lastTurnId = 0;
    private _lastTurnText = "";
    private _lastTurnConfidence = 0;
    private _lastTurnLanguage: string | undefined;

    constructor(
        data: {
            call_id: string;
            from: string;
            to: string;
            direction: "inbound" | "outbound";
            metadata?: Record<string, unknown>;
        },
        send: (data: Record<string, unknown>) => void,
    ) {
        super();
        this.id = data.call_id;
        this.from = data.from;
        this.to = data.to;
        this.direction = data.direction;
        this.metadata = data.metadata ?? {};
        this._send = send;
    }

    // ── High-level reply methods ─────────────────────────────────────────

    /**
     * Send a greeting or standalone message (no in_reply_to required).
     *
     *   await call.say("Hello! How can I help you?");
     */
    say(text: string, messageId?: string): void {
        const id = messageId ?? generateId("msg");
        this._send({
            event: "bot.reply",
            call_id: this.id,
            message_id: id,
            text,
            in_reply_to: "",
        });
    }

    /**
     * Reply to the latest user message (auto-tracks in_reply_to).
     *
     *   call.reply("Sure, let me check that for you.");
     */
    reply(text: string, options?: ReplyOptions): void {
        const id = options?.messageId ?? generateId("msg");
        const inReplyTo = options?.inReplyTo ?? this.lastMessageId ?? "";
        this._send({
            event: "bot.reply",
            call_id: this.id,
            message_id: id,
            text,
            in_reply_to: inReplyTo,
        });
    }

    /**
     * Create a streaming reply. Write tokens, then end.
     * Auto-tracks `in_reply_to` from the Turn or lastMessageId.
     *
     *   const stream = call.replyStream(turn);
     *   stream.write("Sure");
     *   stream.write("!");
     *   stream.end();
     */
    replyStream(turn?: Turn, messageId?: string): ReplyStream {
        const inReplyTo = turn?.messageId ?? this.lastMessageId ?? "";
        const stream = new ReplyStream({
            callId: this.id,
            messageId: messageId ?? generateId("msg"),
            inReplyTo,
            send: this._send,
            onComplete: () => this._activeStreams.delete(stream),
        });
        this._activeStreams.add(stream);
        return stream;
    }

    // ── Control ──────────────────────────────────────────────────────────

    /** Cancel a specific message or the current one. */
    cancel(messageId?: string): void {
        this._send({
            event: "bot.cancel",
            call_id: this.id,
            ...(messageId ? { message_id: messageId } : {}),
        });
    }

    /** Clear all queued audio. */
    clear(): void {
        this._send({ event: "bot.clear", call_id: this.id });
    }

    /** Hang up the call. */
    hangup(): void {
        this._send({ event: "call.hangup", call_id: this.id });
    }

    /** Forward the call to another number. */
    forward(to: string, options?: ForwardOptions): void {
        this._send({
            event: "call.forward",
            call_id: this.id,
            to,
            message: options?.message ?? "",
            announce: options?.announce ?? false,
        });
    }

    /** Send DTMF tones. */
    sendDTMF(digits: string): void {
        this._send({ event: "call.dtmf", call_id: this.id, digits });
    }

    /** Update config for this specific session. */
    updateConfig(config: Partial<SessionConfig>): void {
        this._send({
            event: "update_session_config",
            session_id: this.id,
            config,
        });
    }

    // ── Hold / Mute ────────────────────────────────────────────────────

    /**
     * Put the call on hold — plays hold music to caller, mutes mic.
     * Transcripts are buffered while held.
     * Sending reply() or replyStream() auto-unholds.
     */
    hold(): void {
        this._send({ event: "call.hold", call_id: this.id });
    }

    /** Take the call off hold — stops music, unmutes mic. */
    unhold(): void {
        this._send({ event: "call.unhold", call_id: this.id });
    }

    /**
     * Mute the mic — transcripts are buffered, not emitted.
     * On unmute, `call.unmuted` event includes buffered transcript.
     */
    mute(): void {
        this._send({ event: "call.mute", call_id: this.id });
    }

    /** Unmute the mic — flushes buffered transcripts. */
    unmute(): void {
        this._send({ event: "call.unmute", call_id: this.id });
    }

    // ── Internal: called by Pinecall client to route events ──────────────

    /** @internal Process a server event routed to this call. */
    _handleEvent(event: Record<string, unknown>): void {
        const type = event.event as string;

        switch (type) {
            case "user.message": {
                // Auto-track for in_reply_to
                this.lastMessageId = event.message_id as string;
                this._lastTurnId = event.turn_id as number;
                this._lastTurnText = event.text as string;
                this._lastTurnConfidence = event.confidence as number;
                this._lastTurnLanguage = event.language as string | undefined;
                this.emit("user.message", event as unknown as UserMessageEvent);
                break;
            }

            case "eager.turn": {
                const turn: Turn = {
                    id: event.turn_id as number,
                    messageId: event.message_id as string,
                    text: event.text as string,
                    confidence: 0,
                    probability: event.probability as number,
                    latencyMs: event.latency_ms as number,
                };
                this.emit("eager.turn", turn);
                break;
            }

            case "turn.end": {
                const turn: Turn = {
                    id: event.turn_id as number,
                    messageId: this.lastMessageId ?? "",
                    text: this._lastTurnText,
                    confidence: this._lastTurnConfidence,
                    language: this._lastTurnLanguage,
                    probability: event.probability as number,
                    latencyMs: event.latency_ms as number,
                };
                this.emit("turn.end", turn);
                break;
            }

            case "turn.continued": {
                // Abort all active streams
                for (const stream of this._activeStreams) {
                    stream.abort();
                }
                this._activeStreams.clear();
                this.emit("turn.continued", event as unknown as TurnContinuedEvent);
                break;
            }

            case "speech.started":
                this.emit("speech.started", event as unknown as SpeechStartedEvent);
                break;
            case "speech.ended":
                this.emit("speech.ended", event as unknown as SpeechEndedEvent);
                break;
            case "user.speaking":
                this.emit("user.speaking", event as unknown as UserSpeakingEvent);
                break;
            case "turn.pause":
                this.emit("turn.pause", event as unknown as TurnPauseEvent);
                break;
            case "turn.resumed":
                this.emit("turn.resumed", event as unknown as TurnResumedEvent);
                break;
            case "bot.speaking":
                this.emit("bot.speaking", event as unknown as BotSpeakingEvent);
                break;
            case "bot.word":
                this.emit("bot.word", event as unknown as BotWordEvent);
                break;
            case "bot.finished":
                this.emit("bot.finished", event as unknown as BotFinishedEvent);
                break;
            case "bot.interrupted":
                this.emit("bot.interrupted", event as unknown as BotInterruptedEvent);
                break;
            case "message.confirmed":
                this.emit("message.confirmed", event as unknown as MessageConfirmedEvent);
                break;
            case "reply.rejected":
                this.emit("reply.rejected", event as unknown as ReplyRejectedEvent);
                break;
            case "audio.metrics":
                this.emit("audio.metrics", event as unknown as AudioMetricsEvent);
                break;
            case "call.held":
                this.emit("call.held");
                break;
            case "call.unheld":
                this.emit("call.unheld");
                break;
            case "call.muted":
                this.emit("call.muted");
                break;
            case "call.unmuted":
                this.emit("call.unmuted", (event.muted_transcript as string) ?? null);
                break;
        }
    }

    /** @internal Mark call as ended. */
    _end(reason: string): void {
        // Abort all streams
        for (const stream of this._activeStreams) {
            stream.abort();
        }
        this._activeStreams.clear();
        this.emit("ended", reason);
        // Defer listener cleanup to microtask so "ended" handlers can still
        // interact with the call object (e.g. read state, attach cleanup)
        queueMicrotask(() => this.removeAllListeners());
    }
}
