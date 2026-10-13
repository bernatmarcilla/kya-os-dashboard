import { useEffect, useState } from 'react';
import type { Identities } from '@kya-dash/shared';
import { post, useEventStream, type Call } from './state';
import { Btn, Card, Chip, Did, Empty, short } from './ui';
import { ProofDrawer } from './ProofDrawer';

const statusChip = (c: Call) => {
  switch (c.status) {
    case 'running':
      return <Chip>running…</Chip>;
    case 'challenged':
      return <Chip tone="amber">{c.afterRevocation ? 'needs consent (after revoke)' : 'needs consent'}</Chip>;
    case 'succeeded':
      return <Chip tone="green">Proof ✓</Chip>;
    case 'denied':
      return <Chip tone="red">denied</Chip>;
  }
};
const time = (iso: string) => new Date(iso).toLocaleTimeString();

export function App() {
  const { state, dispatch } = useEventStream();
  const [ids, setIds] = useState<Identities | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/identities')
      .then((r) => r.json())
      .then(setIds)
      .catch(() => {});
  }, []);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const openCall = state.calls.find((c) => c.id === open);

  return (
    <div className="flex min-h-screen">
      <nav className="hidden w-48 shrink-0 border-r border-zinc-800 p-4 md:block">
        <div className="mb-6 text-sm font-semibold">
          KYA-OS
          <br />
          <span className="text-zinc-500">Agent Dashboard</span>
        </div>
        {[
          ['Activity', '#activity'],
          ['Consents', '#consents'],
          ['Delegations', '#delegations'],
          ['Audit', '#audit'],
        ].map(([l, h]) => (
          <a
            key={h}
            href={h}
            className="block rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
          >
            {l}
          </a>
        ))}
        <div className="mt-6">
          <Chip tone={state.connected ? 'green' : 'red'}>{state.connected ? 'live' : 'disconnected'}</Chip>
        </div>
      </nav>

      <main className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
        <div className="grid gap-2 sm:grid-cols-3">
          {ids && (
            <>
              <Did label="Server" did={ids.server} />
              <Did label="You (Responsible Party)" did={ids.responsibleParty} />
              <Did label="Agent" did={ids.agent} />
            </>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
          <Card
            id="activity"
            title="Activity"
            right={
              <Btn tone="primary" disabled={busy} onClick={() => act(() => post('/api/demo/run'))}>
                ▶ Run demo
              </Btn>
            }
          >
            {state.calls.length === 0 ? (
              <Empty>No calls yet. Click “Run demo”.</Empty>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {state.calls.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setOpen(c.id)}
                      className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-zinc-800/40"
                    >
                      <span className="w-16 shrink-0 text-xs text-zinc-500">{time(c.at)}</span>
                      <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs">{c.tool}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                        {c.detail ?? JSON.stringify(c.args)}
                      </span>
                      {c.delegationId && <Chip tone="blue">delegation {short(c.delegationId, 14, 4)}</Chip>}
                      {statusChip(c)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-4">
            <Card id="consents" title={`Pending approvals (${state.consents.length})`}>
              {state.consents.length === 0 ? (
                <Empty>Nothing waiting for you.</Empty>
              ) : (
                <ul className="space-y-3">
                  {state.consents.map((c) => (
                    <li
                      key={c.resumeToken}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
                    >
                      <div className="mb-1 text-sm">
                        Agent wants to call <span className="font-mono">{c.tool}</span>
                      </div>
                      <div className="mb-1 flex flex-wrap gap-1">
                        {c.scopes.map((s) => (
                          <Chip key={s} tone="amber">
                            {s}
                          </Chip>
                        ))}
                      </div>
                      <div className="mb-3 font-mono text-xs text-zinc-500">
                        {short(c.agentDid, 16, 8)} · expires in 10 min
                      </div>
                      <div className="flex gap-2">
                        <Btn
                          tone="primary"
                          onClick={() => act(() => post(`/api/consents/${c.resumeToken}/approve`))}
                        >
                          Approve
                        </Btn>
                        <Btn onClick={() => act(() => post(`/api/consents/${c.resumeToken}/deny`))}>Deny</Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card id="delegations" title="Delegations">
              {state.delegations.length === 0 ? (
                <Empty>None issued yet.</Empty>
              ) : (
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-zinc-800">
                    {state.delegations.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 pr-2">
                          {d.scopes.map((s) => (
                            <div key={s} className="font-mono text-xs">
                              {s}
                            </div>
                          ))}
                          <div className="text-xs text-zinc-500">exp {time(d.expiresAt)}</div>
                        </td>
                        <td className="py-2 pr-2">
                          {d.status === 'active' ? (
                            <Chip tone="green">active</Chip>
                          ) : (
                            <Chip tone="red">revoked</Chip>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {d.status === 'active' && (
                            <Btn
                              tone="danger"
                              onClick={() => {
                                dispatch({ type: 'optimistic-revoke', id: d.id });
                                void act(() => post(`/api/delegations/${d.id}/revoke`));
                              }}
                            >
                              Revoke
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>

        <Card
          id="audit"
          title="Audit trail"
          right={
            <Btn disabled={busy} onClick={() => act(() => post('/api/audit/checkpoint'))}>
              Seal checkpoint
            </Btn>
          }
        >
          {state.checkpoints.length === 0 ? (
            <Empty>No checkpoints sealed yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {state.checkpoints.map((c) => (
                <li key={c.checkpointId} className="rounded-lg border border-zinc-800 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Chip tone="green">sealed</Chip>
                    <span className="text-zinc-400">
                      {c.size} entries · {time(c.at)}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-zinc-500">
                    root {short(c.rootDigest, 20, 8)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
      {openCall && <ProofDrawer call={openCall} onClose={() => setOpen(null)} />}
    </div>
  );
}
