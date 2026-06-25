import { request } from './api';

export type UserRole = 'admin' | 'user';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  user: SessionUser;
}

export const authApi = {
  login(body: { email: string; password: string }): Promise<AuthSession> {
    return request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  me(token?: string): Promise<SessionUser> {
    return request<SessionUser>('/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  },

  users(adminToken?: string): Promise<SessionUser[]> {
    return request<SessionUser[]>('/auth/users', {
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
    });
  },

  impersonate(userId: string, adminToken?: string): Promise<AuthSession> {
    return request<AuthSession>('/auth/impersonate', {
      method: 'POST',
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
      body: JSON.stringify({ userId }),
    });
  },
};

export function getStoredToken() {
  return typeof window === 'undefined'
    ? null
    : window.localStorage.getItem('authToken');
}

export function getStoredAdminToken() {
  return typeof window === 'undefined'
    ? null
    : window.localStorage.getItem('adminToken');
}

export function storeSession(session: AuthSession) {
  window.localStorage.setItem('authToken', session.token);
  window.localStorage.setItem('authUser', JSON.stringify(session.user));
  if (session.user.role === 'admin') {
    window.localStorage.setItem('adminToken', session.token);
  }
  window.dispatchEvent(new Event('auth-changed'));
}

export function clearSession() {
  window.localStorage.removeItem('authToken');
  window.localStorage.removeItem('authUser');
  window.localStorage.removeItem('adminToken');
  window.dispatchEvent(new Event('auth-changed'));
}
