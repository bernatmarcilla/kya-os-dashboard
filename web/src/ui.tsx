import { useState, type ReactNode } from 'react';

export const short = (s: string, h = 14, t = 6) =>
  s.length > h + t + 1 ? `${s.slice(0, h)}…${s.slice(-t)}` : s;

export function Card({
  title,
  right,
  children,
  id,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const tones = {
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  red: 'bg-red-500/15 text-red-300 ring-red-500/30',
  blue: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  zinc: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
};
export function Chip({ tone = 'zinc', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Btn({
  onClick,
  tone = 'zinc',
  children,
  disabled,
}: {
  onClick: () => void;
  tone?: 'primary' | 'danger' | 'zinc';
  children: ReactNode;
  disabled?: boolean;
}) {
  const t = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    danger: 'bg-red-600/80 hover:bg-red-500 text-white',
    zinc: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100',
  }[tone];
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${t}`}
    >
      {children}
    </button>
  );
}

export function Did({ label, did }: { label: string; did: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(did);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left hover:border-zinc-600"
      title="Copy DID"
    >
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="truncate font-mono text-xs text-zinc-200">
        {copied ? 'copied ✓' : short(did, 16, 8)}
      </div>
    </button>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-zinc-500">{children}</p>
);
