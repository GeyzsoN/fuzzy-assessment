/**
 * Tiny fetch wrapper — your single point for talking to the API.
 *
 * It injects the `x-user-id` header (our auth stand-in) and normalizes errors into
 * an `ApiError`. Build your typed service functions (contacts, campaigns) on top of
 * `request()`. Components should call those services via hooks — not fetch directly.
 *
 * (Mirrors the service-layer + interceptor pattern in our real frontend.)
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';
const USER_ID = process.env.NEXT_PUBLIC_USER_ID || 'demo-user';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new ApiError(res.status, body.message || 'Request failed');
  }

  // Some endpoints may return empty bodies.
  return res.status === 204 ? (undefined as T) : res.json();
}
