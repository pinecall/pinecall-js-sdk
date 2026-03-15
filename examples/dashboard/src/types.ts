// ── Types for Pinecall Dashboard ──────────────────────────────────────────

export interface AgentInfo {
  id: string;
  channels: string[];
  calls: string[];
  token: string;
}

export interface PhoneInfo {
  number: string;
  name: string;
  sid: string;
  isSdk: boolean;
}

export interface VoiceInfo {
  id: string;
  name: string;
  preview_url?: string;
  provider?: string;
}

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

export interface CallInfo {
  id: string;
  agent_id: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound";
  startedAt: number;
}

export interface TranscriptEntry {
  role: "user" | "bot";
  text: string;
  timestamp: number;
}

export interface WsEvent {
  event: string;
  agent_id?: string;
  call_id?: string;
  [key: string]: any;
}
