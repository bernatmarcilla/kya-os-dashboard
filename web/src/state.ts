import { useEffect, useReducer } from 'react';
import type { ConsentDTO, DashboardEvent, DelegationDTO, DetachedProofLike } from '@kya-dash/shared';

export interface Call {
  id: string;
  tool: string;
  at: string;
  args: Record<string, unknown>;
  agentDid?: string;
  status: 'running' | 'challenged' | 'succeeded' | 'denied';
  scopes?: string[];
  proof?: DetachedProofLike;
  delegationId?: string;
  detail?: string;
  /** The library re-challenges after a revocation (same as "never authorized"), so we flag it ourselves. */
  afterRevocation?: boolean;
}
export interface Checkpoint {
  checkpointId: string;
  size: number;
  rootDigest: string;
  at: string;
}

export interface State {
  calls: Call[];
  consents: ConsentDTO[];
  delegations: DelegationDTO[];
  checkpoints: Checkpoint[];
  lastSeq: number;
  connected: boolean;
}
const initial: State = {
  calls: [],
  consents: [],
  delegations: [],
  checkpoints: [],
  lastSeq: 0,
  connected: false,
};

type Action =
  | { type: 'event'; event: DashboardEvent }
  | { type: 'connected'; value: boolean }
  | { type: 'optimistic-revoke'; id: string };

const patchCall = (calls: Call[], id: string, p: Partial<Call>) =>
  calls.map((c) => (c.id === id ? { ...c, ...p } : c));

function reduce(s: State, a: Action): State {
  if (a.type === 'connected') return { ...s, connected: a.value };
  if (a.type === 'optimistic-revoke') {
    return { ...s, delegations: s.delegations.map((d) => (d.id === a.id ? { ...d, status: 'revoked' } : d)) };
  }
  const e = a.event;
  if (e.seq <= s.lastSeq) return s; // replay on reconnect
  const next = { ...s, lastSeq: e.seq };
  switch (e.type) {
    case 'tool.called':
      return {
        ...next,
        calls: [
          { id: e.id, tool: e.tool, at: e.at, args: e.args, agentDid: e.agentDid, status: 'running' },
          ...s.calls,
        ],
      };
    case 'tool.challenged':
      return {
        ...next,
        calls: patchCall(s.calls, e.id, {
          status: 'challenged',
          scopes: e.scopes,
          afterRevocation: s.delegations.some((d) => d.tool === e.tool && d.status === 'revoked'),
        }),
      };
    case 'tool.succeeded':
      return {
        ...next,
        calls: patchCall(s.calls, e.id, {
          status: 'succeeded',
          proof: e.proof,
          delegationId: e.delegationId,
          detail: e.result,
        }),
      };
    case 'tool.proved':
      return { ...next, calls: patchCall(s.calls, e.id, { proof: e.proof }) };
    case 'tool.denied':
      return { ...next, calls: patchCall(s.calls, e.id, { status: 'denied', detail: e.reason }) };
    case 'consent.requested':
      return { ...next, consents: [...s.consents, e.consent] };
    case 'consent.denied':
      return { ...next, consents: s.consents.filter((c) => c.resumeToken !== e.resumeToken) };
    case 'delegation.issued':
      return {
        ...next,
        delegations: [e.delegation, ...s.delegations],
        consents: s.consents.filter(
          (c) => !(c.tool === e.delegation.tool && c.agentDid === e.delegation.agentDid),
        ),
      };
    case 'delegation.revoked':
      return {
        ...next,
        delegations: s.delegations.map((d) => (d.id === e.delegationId ? { ...d, status: 'revoked' } : d)),
      };
    case 'audit.checkpointed':
      return {
        ...next,
        checkpoints: [
          { checkpointId: e.checkpointId, size: e.size, rootDigest: e.rootDigest, at: e.at },
          ...s.checkpoints,
        ],
      };
  }
}

/** The UI is a projection of the server's event log (replayed on connect). */
export function useEventStream() {
  const [state, dispatch] = useReducer(reduce, initial);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => dispatch({ type: 'connected', value: true });
    es.onerror = () => dispatch({ type: 'connected', value: false });
    es.onmessage = (m) => dispatch({ type: 'event', event: JSON.parse(m.data) as DashboardEvent });
    return () => es.close();
  }, []);
  return { state, dispatch };
}

export async function post(path: string) {
  const r = await fetch(path, { method: 'POST' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
