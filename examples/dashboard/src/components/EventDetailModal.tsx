/** EventDetailModal — JSON detail view for a single event. Ported from dev-ui. */
import { X, Copy } from 'lucide-react';
import JsonHighlight from './shared/JsonHighlight';
import { DIRECTION_COLORS } from '../constants';
import type { EventEntry } from '../types';

interface Props {
  event: EventEntry | null;
  onClose: () => void;
}

export default function EventDetailModal({ event, onClose }: Props) {
  if (!event) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(24, 12, 36, 0.9)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        style={{ background: 'rgb(32, 16, 48)', border: '1px solid rgba(90,45,135,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid rgba(60,30,90,0.8)' }}>
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full" style={{ background: DIRECTION_COLORS[event.direction] || DIRECTION_COLORS.system }} />
            <span className="font-medium text-lg" style={{ color: 'var(--pc-text-light)' }}>{event.event}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--pc-text-medium)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 scrollbar-thin" style={{ background: 'rgb(24, 12, 36)' }}>
          <JsonHighlight data={event.data} />
        </div>

        {/* Footer */}
        <div className="p-4 flex justify-end gap-2" style={{ borderTop: '1px solid rgba(60,30,90,0.8)' }}>
          <button
            onClick={() => navigator.clipboard.writeText(JSON.stringify(event.data, null, 2))}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-opacity"
            style={{ background: 'rgba(60,30,90,0.5)', color: 'var(--pc-text-light)' }}
          >
            <Copy size={13} /> Copy JSON
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg font-medium"
            style={{ background: 'linear-gradient(135deg, rgb(85, 40, 125), rgb(120, 60, 160))', color: 'var(--pc-text-light)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
