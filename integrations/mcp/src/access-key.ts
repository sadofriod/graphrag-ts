import { createHash, randomBytes } from 'node:crypto';

if (import.meta.main) {
  const token = randomBytes(32).toString('base64url');
  console.log(JSON.stringify({
    token,
    api_key_sha256: createHash('sha256').update(token).digest('hex'),
  }, null, 2));
}
