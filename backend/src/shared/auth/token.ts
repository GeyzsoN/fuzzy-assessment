import { createHmac, timingSafeEqual } from 'crypto';
import { SessionUser } from './session-user';

const defaultSecret = 'local-demo-auth-secret-change-me';

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload: string): string {
  return createHmac('sha256', process.env.AUTH_SECRET || defaultSecret)
    .update(payload)
    .digest('base64url');
}

export function signSessionToken(user: SessionUser): string {
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }),
  );
  return `${payload}.${signPayload(payload)}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload));
    if (!decoded.sub || !decoded.email || !decoded.role) {
      return null;
    }

    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.email,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}
