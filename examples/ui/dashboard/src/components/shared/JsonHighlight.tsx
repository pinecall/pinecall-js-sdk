/** JsonHighlight — Syntax-highlighted JSON. Ported from dev-ui. */
import React from 'react';

function formatValue(value: any, depth = 0): React.ReactNode {
  const indent = '  '.repeat(depth);
  const nextIndent = '  '.repeat(depth + 1);

  if (value === null) return <span className="text-slate-500">null</span>;
  if (typeof value === 'boolean') return <span className="text-amber-400">{value.toString()}</span>;
  if (typeof value === 'number') return <span className="text-cyan-400">{value}</span>;
  if (typeof value === 'string') {
    const display = value.length > 200 ? value.slice(0, 200) + '...' : value;
    return <span className="text-emerald-400">"{display}"</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">[]</span>;
    return (
      <span>
        <span className="text-slate-400">[</span>
        {value.map((item, i) => (
          <span key={i}>
            {'\n'}{nextIndent}{formatValue(item, depth + 1)}
            {i < value.length - 1 && <span className="text-slate-500">,</span>}
          </span>
        ))}
        {'\n'}{indent}<span className="text-slate-400">]</span>
      </span>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-slate-400">{'{}'}</span>;
    return (
      <span>
        <span className="text-slate-400">{'{'}</span>
        {entries.map(([key, val], i) => (
          <span key={key}>
            {'\n'}{nextIndent}<span className="text-violet-400">"{key}"</span>
            <span className="text-slate-500">: </span>
            {formatValue(val, depth + 1)}
            {i < entries.length - 1 && <span className="text-slate-500">,</span>}
          </span>
        ))}
        {'\n'}{indent}<span className="text-slate-400">{'}'}</span>
      </span>
    );
  }
  return <span className="text-slate-300">{String(value)}</span>;
}

export default function JsonHighlight({ data }: { data: any }) {
  return (
    <pre className="text-sm font-mono whitespace-pre-wrap break-words">
      {formatValue(data)}
    </pre>
  );
}
