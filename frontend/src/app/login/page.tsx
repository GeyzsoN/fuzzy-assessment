'use client';

import React, { useState } from 'react';
import { Mail, Key, Shield, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth, DEMO_USERS } from '@/hooks/use-auth';
import Shell from '@/components/shell';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      if (!res.success) {
        setError(res.error || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(demoEmail, 'password123');
      if (!res.success) {
        setError(res.error || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div className="max-w-md mx-auto my-12">
        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-slate-100 rounded-full text-slate-900 mb-3">
              <Shield className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-sans font-semibold text-slate-900 tracking-tight">
              Access Campaign Sequencer
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Sign in with a demo profile or create your session
            </p>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Key className="h-4 w-4" />
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400 transition-colors"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400 font-medium">
                Hint: Demo accounts use password <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-semibold font-mono">password123</code>
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-slate-950 hover:bg-slate-800 disabled:bg-slate-300 text-white font-medium text-sm rounded-lg transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Verifying account...
                </>
              ) : (
                <>
                  Enter Workspace
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </button>
          </form>

          {/* Demo shortcuts */}
          <div className="mt-8 pt-6 border-t border-slate-200">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 text-center">
              Quick-Access Demo Profiles
            </span>
            <div className="space-y-2">
              {DEMO_USERS.map((user) => (
                <button
                  key={user.email}
                  type="button"
                  onClick={() => handleDemoLogin(user.email)}
                  disabled={submitting}
                  className="w-full text-left p-3 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors flex justify-between items-center"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800">{user.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{user.email}</div>
                  </div>
                  <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">
                    {user.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
