import zlib from 'node:zlib';
import {
  DelegationCredentialIssuer,
  StatusList2021Manager,
  MemoryStatusListStorage,
  base64urlEncodeFromBytes,
  createUnsignedVCJWT,
  completeVCJWT,
  type CredentialStatus,
  type DelegationCredential,
  type Proof,
  type VCSigningFunction,
} from '@kya-os/mcp';
import type { DelegationDTO } from '@kya-dash/shared';
import { crypto, type Identity } from './identity.js';

// StatusList2021Manager needs gzip (de)compressors injected; the library does not ship one.
const compressor = { compress: async (d: Uint8Array) => new Uint8Array(zlib.gzipSync(d)) };
const decompressor = { decompress: async (d: Uint8Array) => new Uint8Array(zlib.gunzipSync(d)) };

export const DELEGATION_TTL_SECONDS = 10 * 60;

/** Issues delegation VCs signed by the Responsible Party's key and tracks revocation via StatusList2021. */
export function createDelegations(rp: Identity, statusBaseUrl: string) {
  const sign: VCSigningFunction = async (canonicalVC, _issuer, kid): Promise<Proof> => ({
    type: 'Ed25519Signature2020',
    created: new Date().toISOString(),
    verificationMethod: kid,
    proofPurpose: 'assertionMethod',
    proofValue: base64urlEncodeFromBytes(
      await crypto.sign(new TextEncoder().encode(canonicalVC), rp.privateKey),
    ),
  });
  const issuer = new DelegationCredentialIssuer(
    { getDid: () => rp.did, getKeyId: () => rp.kid, getPrivateKey: () => rp.privateKey },
    sign,
  );
  const statusList = new StatusList2021Manager(
    new MemoryStatusListStorage(),
    { getDid: () => rp.did, getKeyId: () => rp.kid },
    sign,
    compressor,
    decompressor,
    { statusListBaseUrl: statusBaseUrl },
  );

  const records = new Map<string, DelegationDTO & { credentialStatus: CredentialStatus }>();

  async function issue(p: { tool: string; scopes: string[]; agentDid: string }) {
    const id = `delegation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const credentialStatus = await statusList.allocateStatusEntry('revocation');
    const notAfter = Math.floor(Date.now() / 1000) + DELEGATION_TTL_SECONDS;
    const vc: DelegationCredential = await issuer.createAndIssueDelegation(
      {
        id,
        issuerDid: rp.did,
        subjectDid: p.agentDid,
        controller: rp.did,
        constraints: { scopes: p.scopes, notAfter },
        metadata: { tool: p.tool, approvedAt: new Date().toISOString() },
      },
      { credentialStatus },
    );
    // VC-JWT form: the only credential shape a Grant can hold in 1.16.2 (`credentialJwt`).
    const { proof: _proof, ...unsigned } = vc as unknown as Record<string, unknown>;
    const { signingInput } = createUnsignedVCJWT(unsigned, { keyId: rp.kid });
    const sig = await crypto.sign(new TextEncoder().encode(signingInput), rp.privateKey);
    const jwt = completeVCJWT(signingInput, base64urlEncodeFromBytes(sig));
    const dto: DelegationDTO = {
      id,
      tool: p.tool,
      scopes: p.scopes,
      agentDid: p.agentDid,
      issuerDid: rp.did,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(notAfter * 1000).toISOString(),
      status: 'active',
      vc,
    };
    records.set(id, { ...dto, credentialStatus });
    return { vc, jwt, dto };
  }

  async function revoke(id: string): Promise<DelegationDTO | undefined> {
    const r = records.get(id);
    if (!r) return undefined;
    await statusList.updateStatus(r.credentialStatus, true);
    r.status = 'revoked';
    return strip(r);
  }

  const strip = ({
    credentialStatus: _c,
    ...dto
  }: DelegationDTO & { credentialStatus: CredentialStatus }): DelegationDTO => dto;
  return { issue, revoke, list: () => [...records.values()].map(strip), statusList };
}
export type Delegations = ReturnType<typeof createDelegations>;
