/** EventLog — Collapsible event stream panel. Ported from dev-ui. */
import { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { formatTime } from '../utils';
import { DIRECTION_COLORS } from '../constants';
import type { EventEntry } from '../types';

interface Props {
  events: EventEntry[];
  onClear: () => void;
  onSelectEvent: (e: EventEntry) => void;
}

export default function EventLog({ events, onClear, onSelectEvent }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden flex-1" style={{ borderTop: '1px solid rgba(60,30,90,0.6)' }}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-5 py-3 text-left transition-colors flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(60,30,90,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: 'var(--pc-primary-light)' }} />
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>Events</span>
          <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(50,25,75,0.5)', color: 'rgb(100,75,140)' }}>
            {events.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isExpanded && (
            <span onClick={e => { e.stopPropagation(); onClear(); }} className="p-1 rounded transition-colors cursor-pointer" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>
              <Trash2 size={12} />
            </span>
          )}
          {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--pc-text-medium)' }} /> : <ChevronDown size={14} style={{ color: 'var(--pc-text-medium)' }} />}
        </div>
      </button>

      {isExpanded && (
        <div className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] scrollbar-thin">
          {events.length === 0 && (
            <div className="flex items-center justify-center h-full" style={{ color: 'rgb(100,75,140)', opacity: 0.25 }}>
              <span className="text-[10px]">Waiting for events…</span>
            </div>
          )}
          {events.map(e => (
            <div
              key={e.id}
              onClick={() => onSelectEvent(e)}
              className="px-2 py-1.5 mb-0.5 rounded-md cursor-pointer transition-colors"
              style={{ borderLeft: `2px solid ${DIRECTION_COLORS[e.direction] || DIRECTION_COLORS.system}` }}
              onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(60,30,90,0.2)')}
              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
            >
              <div className="flex items-center justify-between">
                <span style={{ color: DIRECTION_COLORS[e.direction] || DIRECTION_COLORS.system }}>{e.event}</span>
                <span className="text-[9px] tabular-nums" style={{ color: 'rgb(80,60,110)' }}>{formatTime(e.time)}</span>
              </div>
              {e.data && Object.keys(e.data).length > 1 && (
                <div className="text-[9px] truncate mt-0.5" style={{ color: 'rgb(75,55,105)' }}>
                  {JSON.stringify(e.data).slice(0, 80)}…
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
