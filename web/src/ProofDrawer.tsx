import { useEffect, useState } from 'react';
import type { Call } from './state';
import { Chip, short } from './ui';

const b64 = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));

interface Verdict {
  valid: boolean;
  reason?: string;
  didResolved: boolean;
}

export function ProofDrawer({ call, onClose }: { call: Call; onClose: () => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const proof = call.proof;
  useEffect(() => {
    setVerdict(null);
    if (!proof) return;
    fetch('/api/proofs/verify', { method: 'POST', body: JSON.stringify(proof) })
      .then((r) => r.json())
      .then((v: Verdict) => setVerdict(v))
      .catch(() => setVerdict({ valid: false, reason: 'verify request failed', didResolved: false }));
  }, [proof]);

  let header: unknown, payload: unknown;
  if (proof) {
    const [h, p] = proof.jws.split('.');
    header = b64(h!);
    payload = b64(p!);
  }
  const insight = (label: string, ok: boolean | undefined) => (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-sm">
      {label}
      {ok === undefined ? (
        <Chip>checking…</Chip>
      ) : ok ? (
        <Chip tone="green">✓</Chip>
      ) : (
        <Chip tone="red">✗</Chip>
      )}
    </div>
  );

  return (
    <aside className="fixed inset-y-0 right-0 z-10 w-full max-w-xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          <span className="font-mono">{call.tool}</span> proof
        </h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-white">
          ✕
        </button>
      </div>
      {!proof ? (
        <p className="text-sm text-zinc-400">No proof on this call.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {insight('Signature valid', verdict?.valid)}
            {insight('Signer DID resolved', verdict?.didResolved)}
            {insight('Request hash bound', !!proof.meta.requestHash)}
            {insight(call.delegationId ? 'Delegation used' : 'Public tool', true)}
          </div>
          {verdict && !verdict.valid && <p className="text-sm text-red-300">{verdict.reason}</p>}
          <Block title="JWS header" value={header} />
          <Block title="JWS payload" value={payload} />
          <Block title="Proof meta" value={proof.meta} />
          <p className="text-xs text-zinc-500">
            Verified by the server's <code>ProofVerifier</code>. Signer:{' '}
            <span className="font-mono">{short(proof.meta.did, 18, 8)}</span>
          </p>
        </div>
      )}
    </aside>
  );
}

function Block({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">{title}</div>
      <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs text-zinc-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
