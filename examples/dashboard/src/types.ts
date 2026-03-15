// ── Types ──────────────────────────────────────────────────────────────────

/** Conversation message (user, bot, or system). Mirrors dev-ui structure. */
export interface Message {
  id: number;
  role: 'user' | 'bot' | 'system';
  text: string;
  isInterim?: boolean;
  finalized?: boolean;
  status?: 'pause' | 'end' | null;
  probability?: number;
  speaking?: boolean;
  interrupted?: boolean;
  words?: string[];
  messageId?: string;
  turnId?: string;
  type?: 'call_control' | 'call_error';
}

/** Event log entry */
export interface EventEntry {
  id: number;
  time: Date;
  event: string;
  direction: 'in' | 'out' | 'system';
  data: Record<string, any>;
}

/** Agent info from REST API */
export interface AgentInfo {
  id: string;
  channels: string[];
  calls: string[];
  token: string;
}

/** Phone info from REST API */
export interface PhoneInfo {
  number: string;
  name: string;
  sid: string;
  isSdk: boolean;
}

/** Voice info from REST API */
export interface VoiceInfo {
  id: string;
  name: string;
  preview_url?: string;
  provider?: string;
}

/** Agent config for POST /agents */
export interface AgentConfig {
  name: string;
  model?: string;
  voice?: string;
  language?: string;
  stt?: string;
  phone?: string;
  instructions?: string;
  greeting?: string;
}

/** Active call tracked by WS events */
export interface CallInfo {
  id: string;
  agentId: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  startedAt: number;
}

/** Audio metrics from audio.metrics events */
export interface AudioMetrics {
  rms: number;
  peak: number;
  energy_db: number;
  is_speech: boolean;
  vad_prob: number;
}

/** WS event payload */
export interface WsEvent {
  event: string;
  [key: string]: any;
}
