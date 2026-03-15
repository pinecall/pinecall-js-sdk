import { useRef, useEffect } from 'react';
import type { CallInfo, TranscriptEntry } from '../types';

interface Props {
  call: CallInfo;
  transcript: TranscriptEntry[];
  botTokenBuffer: string;
  isHeld: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  onHangup: () => void;
  onHold: () => void;
  onMute: () => void;
}

function CallTimer({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      if (ref.current) ref.current.textContent = `${m}:${s}`;
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span ref={ref} className="font-mono text-xs text-muted">00:00</span>;
}

export function CallView({
  call, transcript, botTokenBuffer, isHeld, isMuted, isSpeaking,
  onHangup, onHold, onMute,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, botTokenBuffer]);

  return (
    <div className="flex flex-col h-full">
      {/* Call header */}
      <div className="p-4 border-b border-border bg-surface/50 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-success animate-pulse-dot" />
            <div>
              <div className="text-sm font-medium">
                <span className="text-accent-light">{call.agent_id}</span>
                <span className="text-muted mx-2">·</span>
                <span className="text-muted text-xs">{call.direction}</span>
              </div>
              <div className="text-xs text-muted mt-0.5">
                {call.from} → {call.to}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isHeld && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-medium">HELD</span>
            )}
            {isMuted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/20 text-danger font-medium">MUTED</span>
            )}
            {isSpeaking && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent-light font-medium">SPEAKING</span>
            )}
            <CallTimer startedAt={call.startedAt} />
          </div>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {transcript.length === 0 && !botTokenBuffer && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted/50">Waiting for conversation...</p>
          </div>
        )}

        {transcript.map((entry, i) => (
          <div key={i} className={`animate-fade-in flex gap-2 ${entry.role === 'bot' ? 'justify-start' : 'justify-end'}`}>
            {entry.role === 'user' ? (
              <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tr-sm bg-accent/20 border border-accent/20">
                <p className="text-sm">{entry.text}</p>
              </div>
            ) : (
              <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tl-sm bg-surface-hover border border-border">
                <p className="text-sm">{entry.text}</p>
              </div>
            )}
          </div>
        ))}

        {/* Bot typing indicator */}
        {botTokenBuffer && (
          <div className="animate-fade-in flex gap-2 justify-start">
            <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tl-sm bg-surface-hover border border-accent/30">
              <p className="text-sm">{botTokenBuffer}</p>
              <div className="flex gap-1 mt-1">
                <span className="w-1 h-1 rounded-full bg-accent animate-typing" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-accent animate-typing" style={{ animationDelay: '200ms' }} />
                <span className="w-1 h-1 rounded-full bg-accent animate-typing" style={{ animationDelay: '400ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Call controls */}
      <div className="p-4 border-t border-border bg-surface/50 backdrop-blur flex items-center gap-2">
        <button
          onClick={onHangup}
          className="px-4 py-2 rounded-lg bg-danger/20 text-danger text-sm font-medium hover:bg-danger/30 transition-colors"
        >
          ✕ Hangup
        </button>
        <button
          onClick={onHold}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isHeld ? 'bg-warning/30 text-warning' : 'bg-surface-hover text-muted hover:text-white'
          }`}
        >
          {isHeld ? '▶ Resume' : '⏸ Hold'}
        </button>
        <button
          onClick={onMute}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isMuted ? 'bg-danger/30 text-danger' : 'bg-surface-hover text-muted hover:text-white'
          }`}
        >
          {isMuted ? '🔇 Unmute' : '🔈 Mute'}
        </button>
      </div>
    </div>
  );
}
