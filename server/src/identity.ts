import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeCryptoProvider, generateDidKeyFromBase64 } from '@kya-os/mcp';

export interface Identity {
  did: string;
  kid: string;
  privateKey: string;
  publicKey: string;
}

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.kya-os');
export const crypto = new NodeCryptoProvider();

/** Load `.kya-os/<name>.json` or generate and persist a fresh did:key identity. */
export async function loadIdentity(name: 'server' | 'responsible-party' | 'agent'): Promise<Identity> {
  const file = path.join(DIR, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as Identity;
  const kp = await crypto.generateKeyPair();
  const did = generateDidKeyFromBase64(kp.publicKey);
  const identity: Identity = {
    did,
    kid: `${did}#${did.replace('did:key:', '')}`,
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}
