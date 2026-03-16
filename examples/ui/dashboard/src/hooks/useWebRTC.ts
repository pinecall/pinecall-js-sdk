/**
 * useWebRTC — WebRTC voice call hook for the dashboard.
 *
 * Connects to the Pinecall server via WebRTC for voice calls.
 * Fetches server URL from EventServer's /server-info endpoint.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';
import type { Message, AudioMetrics } from '../types';

export type WebRTCStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface WebRTCState {
  status: WebRTCStatus;
  error: string | null;
  startCall: (appId: string) => Promise<void>;
  endCall: () => void;
  messages: Message[];
  /** Audio metrics refs — same shape as useSocket so AudioWaveform works */
  userMetrics: React.MutableRefObject<AudioMetrics | null>;
  botMetrics: React.MutableRefObject<AudioMetrics | null>;
  /** Mute/unmute local microphone */
  isMuted: boolean;
  toggleMute: () => void;
  /** Call duration in seconds */
  duration: number;
  /** Send mid-call config change (language, voice, stt, turnDetection) */
  configure: (config: Record<string, unknown>) => void;
}

export function useWebRTC(): WebRTCState {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const serverUrlRef = useRef<string | null>(null);
  const lastUserRef = useRef<Message | null>(null);
  const botWordsRef = useRef<Record<string, { words: string[] }>>({});
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef = useRef<number>(0);

  // Audio metrics refs — updated from data channel audio.metrics events
  const userMetrics = useRef<AudioMetrics | null>(null);
  const botMetrics = useRef<AudioMetrics | null>(null);

  // Fetch Pinecall server URL
  const getServerUrl = useCallback(async (): Promise<string> => {
    if (serverUrlRef.current) return serverUrlRef.current;
    try {
      const res = await fetch(`${API_BASE}/server-info`);
      if (res.ok) {
        const data = await res.json();
        serverUrlRef.current = data.pinecallServer;
        return data.pinecallServer;
      }
    } catch { /* fallback */ }
    // Fallback: assume same host, port 8765
    return API_BASE.replace(/:\d+$/, ':8765');
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !isMuted;
    // Disable audio track (sends silence frames)
    stream.getAudioTracks().forEach(t => { t.enabled = !enabled; });
    // Tell server to stop/resume STT processing
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify({ action: enabled ? 'mute' : 'unmute' }));
    }
    setIsMuted(enabled);
  }, [isMuted]);

  const configure = useCallback((config: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify({ action: 'configure', ...config }));
    }
  }, []);

  const startCall = useCallback(async (appId: string) => {
    if (pcRef.current) return;

    try {
      setStatus('connecting');
      setError(null);
      setMessages([]);
      setDuration(0);
      setIsMuted(false);
      lastUserRef.current = null;
      botWordsRef.current = {};
      userMetrics.current = null;
      botMetrics.current = null;

      const serverUrl = await getServerUrl();

      // ICE servers
      let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
      try {
        const r = await fetch(`${serverUrl}/webrtc/ice-servers`);
        if (r.ok) {
          const d = await r.json();
          iceServers = d.iceServers || d.ice_servers || iceServers;
        }
      } catch { /* use STUN fallback */ }

      // Microphone
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });

      // Peer connection
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));

      // Remote audio
      pc.ontrack = (e) => {
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = e.streams[0];
      };

      // Data channel — browser creates it, server receives via ondatachannel
      const dc = pc.createDataChannel('events', { ordered: true });
      dcRef.current = dc;
      dc.onopen = () => {
        console.log('[WebRTC] Data channel opened');
        // Ping keepalive
        const pingInterval = setInterval(() => {
          if (dc.readyState === 'open') dc.send('ping');
        }, 1000);
        dc.onclose = () => clearInterval(pingInterval);
      };
      dc.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          handleDataChannelEvent(data);
        } catch { /* ignore non-JSON */ }
      };

      // Connection state
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStatus('connected');
          callStartRef.current = Date.now();
          // Start duration timer
          durationTimerRef.current = setInterval(() => {
            setDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
          }, 1000);
          addMessage({ id: Date.now(), role: 'system', text: 'WebRTC connected — start talking!' });
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          endCall();
        }
      };

      // Create & send offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const timer = setTimeout(resolve, 2000);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
        };
      });

      const res = await fetch(`${serverUrl}/webrtc/offer?app_id=${encodeURIComponent(appId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: pc.localDescription!.sdp, type: pc.localDescription!.type }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `WebRTC offer failed: ${res.status}`);
      }

      const answer = await res.json();
      await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      endCall();
    }
  }, [getServerUrl, addMessage]);

  const endCall = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (dcRef.current) { dcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; remoteAudioRef.current = null; }
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    userMetrics.current = null;
    botMetrics.current = null;
    setStatus('idle');
    setIsMuted(false);
  }, []);

  // Handle data channel events
  const handleDataChannelEvent = useCallback((data: any) => {
    // Skip noisy audio.metrics from console log
    if (data.event !== 'audio.metrics') {
      console.log('[WebRTC] DC event:', data.event, data);
    }
    switch (data.event) {
      case 'session.started':
        addMessage({ id: Date.now(), role: 'system', text: 'Session started' });
        break;

      case 'audio.metrics': {
        // Update metrics refs for AudioWaveform component
        const metrics: AudioMetrics = {
          rms: data.rms ?? 0,
          peak: data.peak ?? 0,
          energy_db: data.energy_db ?? -100,
          is_speech: data.is_speech ?? false,
          vad_prob: data.vad_prob ?? 0,
        };
        if (data.source === 'user') {
          userMetrics.current = metrics;
        } else {
          botMetrics.current = metrics;
        }
        break;
      }

      case 'user.speaking':
        if (data.text) {
          setMessages(prev => {
            const idx = prev.findLastIndex((m: Message) => m.role === 'user' && m.isInterim);
            if (idx >= 0) {
              return prev.map((m, i) => i === idx ? { ...m, text: data.text } : m);
            }
            return [...prev, { id: Date.now(), role: 'user', text: data.text, isInterim: true }];
          });
        }
        break;
      case 'user.message':
        if (data.text) {
          setMessages(prev => {
            const idx = prev.findLastIndex((m: Message) => m.role === 'user' && m.isInterim);
            if (idx >= 0) {
              return prev.map((m, i) => i === idx ? { ...m, text: data.text, isInterim: false } : m);
            }
            return [...prev, { id: Date.now(), role: 'user', text: data.text, isInterim: false }];
          });
        }
        break;
      case 'bot.speaking':
        // Accept even if text is empty — streaming mode sends empty text initially,
        // then fills via bot.word events
        if (data.message_id) {
          addMessage({
            id: Date.now(),
            role: 'bot',
            text: data.text || '…',
            messageId: data.message_id,
            speaking: true,
          });
        }
        break;
      case 'bot.word':
        if (data.message_id && data.word) {
          const ref = botWordsRef.current;
          if (!ref[data.message_id]) ref[data.message_id] = { words: [] };
          ref[data.message_id].words[data.word_index ?? ref[data.message_id].words.length] = data.word;
          const newText = ref[data.message_id].words.filter(Boolean).join(' ');

          setMessages(prev => {
            const idx = prev.findIndex((m: Message) => m.messageId === data.message_id);
            if (idx >= 0) {
              // Immutable update — create new message object so React detects the change
              return prev.map((m, i) => i === idx ? { ...m, text: newText } : m);
            }
            // Auto-create bot message if bot.speaking was missed (e.g. DC wasn't ready)
            return [...prev, {
              id: Date.now(),
              role: 'bot' as const,
              text: newText,
              messageId: data.message_id,
              speaking: true,
            }];
          });
        }
        break;
      case 'bot.finished':
        if (data.message_id) {
          setMessages(prev =>
            prev.map(m =>
              m.messageId === data.message_id
                ? { ...m, speaking: false, ...(data.text ? { text: data.text } : {}) }
                : m
            )
          );
        }
        break;
      case 'bot.interrupted':
        if (data.message_id) {
          setMessages(prev =>
            prev.map(m =>
              m.messageId === data.message_id
                ? { ...m, speaking: false, interrupted: true }
                : m
            )
          );
        }
        break;
    }
  }, [addMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { endCall(); };
  }, [endCall]);

  return { status, error, startCall, endCall, messages, userMetrics, botMetrics, isMuted, toggleMute, duration, configure };
}
