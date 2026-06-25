'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authApi } from '@/services/auth';

export interface User {
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const DEMO_USERS = [
  { email: 'admin@fuzzy.local', name: 'Admin User', role: 'admin' },
  { email: 'ava@fuzzy.local', name: 'Ava Rivera', role: 'user' },
  { email: 'ben@fuzzy.local', name: 'Ben Carter', role: 'user' },
  { email: 'clara@fuzzy.local', name: 'Clara Nguyen', role: 'user' },
];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const saved = window.localStorage.getItem('authUser');
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        window.localStorage.removeItem('authUser');
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const isPublicRoute = pathname === '/' || pathname === '/login';
    if (!user && !isPublicRoute) {
      router.push('/login');
    }
  }, [isLoading, pathname, router, user]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const result = await authApi.login({ email, password });
      const nextUser = {
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      };
      window.localStorage.setItem('authToken', result.token);
      window.localStorage.setItem('authUser', JSON.stringify(nextUser));
      setUser(nextUser);
      router.push('/campaigns');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    window.localStorage.removeItem('authToken');
    window.localStorage.removeItem('authUser');
    setUser(null);
    router.push('/');
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
