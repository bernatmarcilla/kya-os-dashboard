import { generateKeyPair } from 'jose';
import {
  AuditCheckpointBuilder,
  CompactJwsAuditSigner,
  CryptoProviderAuditHasher,
  MemoryAuditCheckpointStore,
  MemoryAuditJournal,
  MemoryAuditSourceState,
  createAuditTrail,
  createLocalAuditRecorder,
  type PartyRef,
} from '@kya-os/mcp';
import { crypto } from './identity.js';
import type { EventBus } from './events.js';

/** Audit trail (signed journal + checkpoints), per examples/audit-trail/walkthrough.ts. */
export async function createAudit(bus: EventBus) {
  const hasher = new CryptoProviderAuditHasher(crypto);
  const { privateKey } = await generateKeyPair('EdDSA');
  const signer = new CompactJwsAuditSigner(
    { did: 'did:web:audit.example', kid: 'did:web:audit.example#recorder-1', alg: 'EdDSA' },
    privateKey,
  );
  const ledger = { ledgerId: 'kya:tenant-opaque:dev:primary', ledgerEpochId: 'epoch-local-1' };
  const tenantRef: PartyRef = {
    kind: 'keyed_commitment',
    value: `sha256:${'0'.repeat(64)}`,
    keyId: 'tenant-index-key-v1',
  };
  const binding = 'urn:kya-os:audit-binding:mcp:2025-11-25';
  const journal = new MemoryAuditJournal();
  const recorder = createLocalAuditRecorder(
    { ...ledger, tenantRef, binding, sourceId: 'local-recorder', journal, signer, hasher, clock: Date },
    () => ({ producerAuthority: 'did:key:zLocalProducer', tenantAuthority: 'tenant-opaque', tenantRef }),
  );
  const trail = createAuditTrail({
    recorder,
    delivery: 'required',
    hasher,
    ledgerId: ledger.ledgerId,
    expectedLedgerEpochId: ledger.ledgerEpochId,
    tenantRef,
    producer: { kind: 'pairwise_did', did: 'did:key:zLocalProducer' },
    sourceId: 'mcp-server-1',
    binding,
    privacy: { classification: 'internal', retentionClass: 'audit-30d' },
    clock: Date,
    sourceState: new MemoryAuditSourceState(),
  });
  const store = new MemoryAuditCheckpointStore();

  async function checkpoint() {
    await trail.recordSourceHighWater();
    const cp = await new AuditCheckpointBuilder({
      journal,
      store,
      signer,
      hasher,
      clock: Date,
    }).createCheckpoint(ledger);
    const summary = {
      checkpointId: cp.checkpointDigest,
      size: Number(cp.core.treeSize),
      rootDigest: String(cp.core.rootDigest),
    };
    bus.emit({ type: 'audit.checkpointed', ...summary });
    return { ...summary, checkpoint: cp };
  }

  return { trail, journal, checkpoint };
}
export type Audit = Awaited<ReturnType<typeof createAudit>>;
