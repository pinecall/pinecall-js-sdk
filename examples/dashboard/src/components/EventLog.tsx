import { useRef, useEffect } from 'react';
import type { WsEvent } from '../types';

interface Props {
  events: WsEvent[];
}

const EVENT_COLORS: Record<string, string> = {
  'call.started': 'text-green-400',
  'call.ended': 'text-red-400',
  'user.message': 'text-blue-400',
  'llm.token': 'text-purple-300',
  'llm.done': 'text-purple-400',
  'bot.speaking': 'text-violet-400',
  'bot.finished': 'text-violet-300',
  'bot.interrupted': 'text-yellow-400',
  'call.held': 'text-yellow-400',
  'call.unheld': 'text-yellow-300',
  'call.muted': 'text-red-300',
  'call.unmuted': 'text-green-300',
  'server.connected': 'text-cyan-400',
};

export function EventLog({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-3 font-mono text-[11px]">
      {events.length === 0 && (
        <p className="text-muted/40 text-center py-8">No events yet</p>
      )}
      {events.map((evt, i) => {
        const color = EVENT_COLORS[evt.event] ?? 'text-slate-500';
        // Build summary
        let summary = '';
        if (evt.text) summary = evt.text.slice(0, 50);
        else if (evt.token) summary = evt.token;
        else if (evt.reason) summary = evt.reason;
        else if (evt.agents) summary = evt.agents.join(', ');
        else if (evt.call_id) summary = evt.call_id.slice(0, 8);

        return (
          <div key={i} className="py-0.5 flex gap-2 hover:bg-surface-hover/30 px-1 rounded">
            <span className={`${color} whitespace-nowrap`}>{evt.event}</span>
            {summary && <span className="text-muted/60 truncate">{summary}</span>}
          </div>
        );
      })}
    </div>
  );
}
