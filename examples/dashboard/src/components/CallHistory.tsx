/** CallHistory — Shows recent calls in the left sidebar with click-to-view. */
import { Phone, PhoneIncoming, PhoneOutgoing, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { CallHistoryEntry } from '../hooks/useSocket';

interface Props {
  history: CallHistoryEntry[];
  viewingId: string | null;
  onView: (callId: string | null) => void;
  isAnythingActive: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDur(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function CallHistory({ history, viewingId, onView, isAnythingActive }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (history.length === 0) return null;

  const Icon = ({ dir }: { dir: string }) => {
    if (dir === 'webrtc') return <Globe size={11} style={{ color: 'rgb(92,180,255)' }} />;
    if (dir === 'outbound') return <PhoneOutgoing size={11} style={{ color: 'rgb(255,196,60)' }} />;
    return <PhoneIncoming size={11} style={{ color: 'rgb(92,245,152)' }} />;
  };

  return (
    <div>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between text-left transition-colors"
        style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(60,30,90,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <div className="flex items-center gap-2">
          <Phone size={14} style={{ color: 'var(--pc-primary-light)' }} />
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>
            Recent Calls
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(190,124,255,0.15)', color: 'var(--pc-primary-light)' }}>
            {history.length}
          </span>
        </div>
        {expanded ? <ChevronUp size={14} style={{ color: 'var(--pc-text-medium)' }} /> : <ChevronDown size={14} style={{ color: 'var(--pc-text-medium)' }} />}
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-1" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
          {/* Live view button — only if there's an active call and we're viewing history */}
          {isAnythingActive && viewingId && (
            <button onClick={() => onView(null)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all cursor-pointer"
              style={{ background: 'rgba(92,245,152,0.08)', border: '1px solid rgba(92,245,152,0.2)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(92,245,152)' }} />
              <span className="text-xs font-medium" style={{ color: 'rgb(92,245,152)' }}>Live Call</span>
            </button>
          )}
          {history.map(entry => {
            const isViewing = viewingId === entry.id;
            const msgCount = entry.messages.filter(m => m.role !== 'system').length;
            return (
              <button key={entry.id} onClick={() => onView(isViewing ? null : entry.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all cursor-pointer"
                style={{
                  background: isViewing ? 'rgba(190,124,255,0.12)' : 'rgba(35,18,55,0.5)',
                  border: `1px solid ${isViewing ? 'rgba(190,124,255,0.3)' : 'rgba(60,30,90,0.3)'}`,
                }}
                onMouseEnter={e => { if (!isViewing) e.currentTarget.style.background = 'rgba(55,28,85,0.6)'; }}
                onMouseLeave={e => { if (!isViewing) e.currentTarget.style.background = 'rgba(35,18,55,0.5)'; }}>
                <Icon dir={entry.direction} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium truncate" style={{ color: isViewing ? 'var(--pc-primary-light)' : 'var(--pc-text-light)', maxWidth: '120px' }}>
                      {entry.from}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: 'rgb(100,75,140)' }}>
                      {formatTime(entry.endedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px]" style={{ color: 'rgb(100,75,140)' }}>
                      {formatDur(entry.duration)}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgb(80,60,110)' }}>
                      {msgCount} msg{msgCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
