import http from 'node:http';
import {
  ProofVerifier,
  NodeCryptoProvider,
  MemoryNonceCacheProvider,
  SystemClockProvider,
  RuntimeFetchProvider,
  type DetachedProof,
} from '@kya-os/mcp';
import type { Identities } from '@kya-dash/shared';
import type { EventBus } from './events.js';
import type { Consent } from './consent.js';
import type { Delegations } from './delegations.js';
import type { Audit } from './audit.js';

/** Returns true when the request was handled. */
export function createApi(d: {
  bus: EventBus;
  consent: Consent;
  delegations: Delegations;
  audit: Audit;
  identities: Identities;
  runDemo?: () => Promise<void>;
}) {
  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    const p = url.pathname;
    if (!p.startsWith('/api/')) return false;
    const m = req.method;

    if (p === '/api/identities' && m === 'GET') return (json(res, 200, d.identities), true);

    if (p === '/api/events' && m === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      d.bus.history().forEach(send);
      const off = d.bus.subscribe(send);
      req.on('close', off);
      return true;
    }
    if (p === '/api/consents' && m === 'GET') return (json(res, 200, d.consent.pending()), true);
    if (p === '/api/delegations' && m === 'GET') return (json(res, 200, d.delegations.list()), true);

    let match = p.match(/^\/api\/consents\/([^/]+)\/(approve|deny)$/);
    if (match && m === 'POST') {
      const [, token, action] = match;
      if (action === 'approve') {
        const dto = await d.consent.approve(token!);
        return (dto ? json(res, 200, dto) : json(res, 404, { error: 'unknown_resume_token' }), true);
      }
      return (
        d.consent.deny(token!)
          ? json(res, 200, { ok: true })
          : json(res, 404, { error: 'unknown_resume_token' }),
        true
      );
    }
    match = p.match(/^\/api\/delegations\/([^/]+)\/revoke$/);
    if (match && m === 'POST') {
      const dto = await d.consent.revoke(match[1]!);
      return (dto ? json(res, 200, dto) : json(res, 404, { error: 'unknown_delegation' }), true);
    }
    if (p === '/api/proofs/verify' && m === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const proof = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as DetachedProof;
      // Fresh nonce cache per call so re-verifying the same proof is not reported as a replay.
      const verifier = new ProofVerifier({
        cryptoProvider: new NodeCryptoProvider(),
        clockProvider: new SystemClockProvider(),
        nonceCacheProvider: new MemoryNonceCacheProvider(),
        fetchProvider: new RuntimeFetchProvider(),
        timestampSkewSeconds: 24 * 3600,
      });
      const jwk = await verifier.fetchPublicKeyFromDID(proof.meta.did);
      if (!jwk)
        return (
          json(res, 200, { valid: false, reason: 'could not resolve signer DID', didResolved: false }),
          true
        );
      const r = await verifier.verifyProof(proof, jwk);
      return (
        json(res, 200, { valid: r.valid, reason: r.reason, errorCode: r.errorCode, didResolved: true }),
        true
      );
    }
    if (p === '/api/audit/checkpoint' && m === 'POST') {
      const { checkpoint: _c, ...summary } = await d.audit.checkpoint();
      return (json(res, 200, summary), true);
    }
    if (p === '/api/demo/run' && m === 'POST') {
      d.runDemo?.().catch((e) => process.stderr.write(`[demo] ${e}\n`));
      return (json(res, 202, { started: true }), true);
    }
    return (json(res, 404, { error: 'not_found' }), true);
  };
}
