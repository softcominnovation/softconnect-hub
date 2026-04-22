import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'crypto';

export function encryptAES256GCM(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptAES256GCM(encryptedStr: string, keyHex: string): string {
  const [ivHex, authTagHex, encryptedHex] = encryptedStr.split(':');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashSHA256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString(
    'base64url',
  );
  const toSign = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', secret)
    .update(toSign)
    .digest('base64url');
  return `${toSign}.${signature}`;
}

export function verifyJwt(
  token: string,
  secret: string,
): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token JWT malformado');

  const [encodedHeader, encodedPayload, signature] = parts;
  const toSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSig = createHmac('sha256', secret)
    .update(toSign)
    .digest('base64url');
  if (signature !== expectedSig) throw new Error('Assinatura JWT inválida');

  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  if (
    typeof payload.exp === 'number' &&
    Math.floor(Date.now() / 1000) > payload.exp
  ) {
    throw new Error('Token JWT expirado');
  }

  return payload;
}
