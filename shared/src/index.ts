export interface DetachedProofLike {
  jws: string;
  meta: Record<string, unknown> & { did: string; kid: string; nonce: string; requestHash: string };
}

export interface Identities {
  server: string;
  responsibleParty: string;
  agent: string;
}

export interface DelegationDTO {
  id: string;
  tool: string;
  scopes: string[];
  agentDid: string;
  issuerDid: string;
  issuedAt: string;
  expiresAt: string;
  status: 'active' | 'revoked';
  vc: unknown;
}

export interface ConsentDTO {
  resumeToken: string;
  tool: string;
  scopes: string[];
  agentDid: string;
  requestedAt: string;
}

export type DashboardEvent = { seq: number; at: string } & (
  | { type: 'tool.called'; id: string; tool: string; agentDid?: string; args: Record<string, unknown> }
  | { type: 'tool.challenged'; id: string; tool: string; scopes: string[]; resumeToken: string }
  | {
      type: 'tool.succeeded';
      id: string;
      tool: string;
      proof?: DetachedProofLike;
      delegationId?: string;
      result: string;
    }
  | { type: 'tool.proved'; id: string; proof: DetachedProofLike }
  | { type: 'tool.denied'; id: string; tool: string; reason: string }
  | { type: 'consent.requested'; consent: ConsentDTO }
  | { type: 'consent.denied'; resumeToken: string }
  | { type: 'delegation.issued'; delegation: DelegationDTO }
  | { type: 'delegation.revoked'; delegationId: string }
  | { type: 'audit.checkpointed'; checkpointId: string; size: number; rootDigest: string }
);
