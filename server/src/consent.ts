import { MemoryGrantStore, type Grant } from '@kya-os/mcp';
import type { ConsentDTO } from '@kya-dash/shared';
import type { EventBus } from './events.js';
import type { Delegations } from './delegations.js';

/** Pending challenges keyed by resumeToken; approving issues an RP-signed VC and binds an agent-anchored grant. */
export function createConsent(bus: EventBus, delegations: Delegations, rpDid: string) {
  const grantStore = new MemoryGrantStore();
  const pending = new Map<string, ConsentDTO>();

  function request(c: Omit<ConsentDTO, 'requestedAt'>) {
    if (pending.has(c.resumeToken)) return;
    const consent = { ...c, requestedAt: new Date().toISOString() };
    pending.set(c.resumeToken, consent);
    bus.emit({ type: 'consent.requested', consent });
  }

  async function approve(resumeToken: string) {
    const c = pending.get(resumeToken);
    if (!c) return undefined;
    pending.delete(resumeToken);
    const { jwt, dto } = await delegations.issue({ tool: c.tool, scopes: c.scopes, agentDid: c.agentDid });
    const grant: Grant = {
      id: dto.id, // grant id == delegation id so tool.succeeded can name the delegation used
      agentDid: c.agentDid,
      userDid: rpDid,
      scopes: c.scopes,
      authorization: { type: 'delegation', provider: 'kya-os-dashboard' },
      credentialJwt: jwt,
      issuedAt: Date.now(),
      expiresAt: Date.parse(dto.expiresAt),
      status: 'active',
    };
    await grantStore.bind(grant);
    bus.emit({ type: 'delegation.issued', delegation: dto });
    return dto;
  }

  function deny(resumeToken: string) {
    if (!pending.delete(resumeToken)) return false;
    bus.emit({ type: 'consent.denied', resumeToken });
    return true;
  }

  async function revoke(id: string) {
    const d = await delegations.revoke(id);
    if (!d) return undefined;
    await grantStore.revoke(id, 'revoked by responsible party');
    bus.emit({ type: 'delegation.revoked', delegationId: id });
    return d;
  }

  return { grantStore, request, approve, deny, revoke, pending: () => [...pending.values()] };
}
export type Consent = ReturnType<typeof createConsent>;
