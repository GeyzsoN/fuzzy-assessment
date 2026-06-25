'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import {
  authApi,
  clearSession,
  getStoredAdminToken,
  getStoredToken,
  SessionUser,
  storeSession,
} from '@/services/auth';

export function useAuth() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setUser(await authApi.me(token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Session expired');
      clearSession();
      setUser(null);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('auth-changed', refresh);
    return () => window.removeEventListener('auth-changed', refresh);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const session = await authApi.login({ email, password });
    storeSession(session);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setUsers([]);
  }, []);

  const loadUsers = useCallback(async () => {
    const adminToken = getStoredAdminToken() || getStoredToken() || undefined;
    if (!adminToken) {
      setUsers([]);
      return [];
    }

    const result = await authApi.users(adminToken);
    setUsers(result);
    return result;
  }, []);

  const switchUser = useCallback(async (userId: string) => {
    const adminToken = getStoredAdminToken() || getStoredToken() || undefined;
    const session = await authApi.impersonate(userId, adminToken);
    window.localStorage.setItem('authToken', session.token);
    window.localStorage.setItem('authUser', JSON.stringify(session.user));
    setUser(session.user);
    window.dispatchEvent(new Event('auth-changed'));
    return session.user;
  }, []);

  return {
    user,
    users,
    loading,
    error,
    login,
    logout,
    refresh,
    loadUsers,
    switchUser,
    isAdminSession: Boolean(getStoredAdminToken()),
  };
}
