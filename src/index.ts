/**
 * @pinecall/sdk — JavaScript SDK for Pinecall Voice.
 *
 * @example
 * ```ts
 * import { Pinecall } from "@pinecall/sdk";
 *
 * const pc = new Pinecall({ apiKey: "pk_..." });
 * await pc.connect();
 *
 * const agent = pc.agent("my-agent", {
 *   voice: "elevenlabs:abc",
 *   language: "es",
 * });
 *
 * agent.addChannel("phone", "+19035551234");
 * agent.addChannel("webrtc");
 *
 * agent.on("call.started", (call) => {
 *   call.say("Hello! How can I help you?");
 * });
 *
 * agent.on("turn.end", (turn, call) => {
 *   const stream = call.replyStream(turn);
 *   for await (const token of myLLM.stream(turn.text)) {
 *     if (stream.aborted) break;
 *     stream.write(token);
 *   }
 *   stream.end();
 * });
 * ```
 */

// Core classes
export { Pinecall, PinecallError } from "./client.js";
export type { PinecallOptions, PinecallEvents } from "./client.js";

export { Agent } from "./agent.js";
export type {
    AgentEvents,
    AgentConfig,
    ChannelConfig,
    VoiceShortcut,
    STTShortcut,
    TurnDetectionShortcut,
    InterruptionShortcut,
} from "./agent.js";

export { Call } from "./call.js";
export type { Turn, CallEvents, ReplyOptions, ForwardOptions } from "./call.js";

export { ReplyStream } from "./stream.js";
export type { ReplyStreamOptions } from "./stream.js";

export { ConversationHistory } from "./history.js";
export type { ChatMessage } from "./history.js";

// Config types
export type {
    SessionConfig,
    STTConfig,
    DeepgramSTTConfig,
    FluxSTTConfig,
    GladiaSTTConfig,
    TranscribeSTTConfig,
    TTSConfig,
    ElevenLabsTTSConfig,
    CartesiaTTSConfig,
    PollyTTSConfig,
    VADConfig,
    TurnDetectionConfig,
    InterruptionConfig,
    SpeakerFilterConfig,
    AnalysisConfig,
} from "./types/config.js";

// Event types
export type {
    ServerEvent,
    CallStartedEvent,
    CallEndedEvent,
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
    BargeInEvent,
    MessageConfirmedEvent,
    ReplyRejectedEvent,
    AudioMetricsEvent,
    RegisteredEvent,
    ErrorEvent,
    PongEvent,
    CallHeldEvent,
    CallUnheldEvent,
    CallMutedEvent,
    CallUnmutedEvent,
} from "./types/events.js";

// Command types
export type {
    ClientCommand,
    RegisterCommand,
    BotReplyCommand,
    BotReplyStreamCommand,
    BotCancelCommand,
    BotClearCommand,
    CallHangupCommand,
    CallDialCommand,
    CallForwardCommand,
    CallDtmfCommand,
    UpdateConfigCommand,
    UpdateSessionConfigCommand,
    AddPhoneCommand,
    RemovePhoneCommand,
    PingCommand,
    CallHoldCommand,
    CallUnholdCommand,
    CallMuteCommand,
    CallUnmuteCommand,
    // Protocol v2
    ConnectCommand,
    AgentCreateCommand,
    AgentResumeCommand,
    AgentConfigureCommand,
    ChannelAddCommand,
    ChannelConfigureCommand,
    ChannelRemoveCommand,
    SessionConfigureCommand,
} from "./types/commands.js";

// Utilities (for advanced users)
export { generateId } from "./utils/id.js";
export { Reconnector } from "./utils/reconnect.js";
export type { ReconnectOptions } from "./utils/reconnect.js";

// REST API helpers
export { fetchVoices, fetchPhones } from "./api.js";
export type {
    Voice,
    VoiceLanguage,
    Phone,
    FetchVoicesOptions,
    FetchPhonesOptions,
} from "./api.js";
