/** Conversation message */
export interface Message {
  id: number;
  role: 'user' | 'bot' | 'system';
  text: string;
  isInterim?: boolean;
  speaking?: boolean;
  interrupted?: boolean;
  messageId?: string;
}

/** Audio metrics from data channel */
export interface AudioMetrics {
  rms: number;
  peak: number;
  energy_db: number;
  is_speech: boolean;
  vad_prob: number;
}

/** Data channel event */
export interface DCEvent {
  event: string;
  [key: string]: any;
}
