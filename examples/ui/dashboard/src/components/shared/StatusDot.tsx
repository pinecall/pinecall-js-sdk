/** StatusDot — Animated status indicator. Ported from dev-ui. */
import { STATUS_COLORS } from '../../constants';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusDot({ status, size = 'sm' }: Props) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const px = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';
  const shouldPulse = ['connected', 'listening', 'speaking', 'pause'].includes(status);
  return <span className={`${px} rounded-full inline-block ${shouldPulse ? 'animate-pulse' : ''}`} style={{ background: color }} />;
}
