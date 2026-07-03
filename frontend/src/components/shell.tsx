'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Mail, Users, FolderGit2, LogOut, LogIn, Menu, X, User, Loader2, ShieldCheck } from 'lucide-react';

interface ShellProps {
  children: React.ReactNode;
  authLoadingLabel?: string;
}

export default function Shell({ children, authLoadingLabel = 'Checking session...' }: ShellProps) {
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const isPublicRoute = pathname === '/' || pathname === '/login';
  const requiresAuth = !isPublicRoute;

  const navItems = [
    { name: 'Home', href: '/', icon: Mail },
    { name: 'Contacts', href: '/contacts', icon: User },
    { name: 'Groups', href: '/groups', icon: Users },
    { name: 'Campaigns', href: '/campaigns', icon: FolderGit2 },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 w-full bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo area */}
            <div className="flex items-center gap-10">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
                  <div className="w-4 h-4 bg-white rounded-sm rotate-45"></div>
                </div>
                <span className="text-xl font-bold tracking-tight text-slate-800">
                  ReachOut
                </span>
              </Link>
              
              {/* Desktop Nav Links */}
              <nav className="hidden md:flex md:items-center space-x-6 h-full">
                {navItems.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`inline-flex items-center h-full border-b-2 text-sm font-semibold transition-all ${
                        active
                          ? 'text-indigo-600 border-indigo-600'
                          : 'text-slate-500 border-transparent hover:text-slate-800 hover:border-slate-200'
                      }`}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Auth / User Switcher */}
            <div className="hidden md:flex md:items-center md:gap-4">
              {/* System status badge from theme */}
              <div className="h-8 bg-slate-100 rounded-full flex items-center px-3.5 gap-2 border border-slate-200/50">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                  System Ready
                </span>
              </div>

              {user ? (
                <div className="relative pl-4 border-l border-slate-200 h-10 flex items-center">
                  <button
                    onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                    className="flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
                  >
                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-850 group-hover:text-indigo-600 transition-colors">{user.name}</p>
                      <p className="text-[10px] text-slate-400 font-medium capitalize">{user.role || 'Pro Account'}</p>
                    </div>
                    <div className="w-10 h-10 bg-slate-100 rounded-full border-2 border-white shadow-sm overflow-hidden flex items-center justify-center font-bold text-slate-600 text-xs tracking-wider transition-transform group-hover:scale-105">
                      {user.name.split(' ').map(n => n.charAt(0)).join('').toUpperCase()}
                    </div>
                  </button>

                  {userDropdownOpen && (
                    <div className="absolute right-0 top-14 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-50 text-slate-800 animate-in fade-in slide-in-from-top-1">
                      <div className="px-4 py-2 border-b border-slate-100 text-[10px] text-slate-400 font-bold tracking-wider uppercase">
                        Current Account
                      </div>
                      <div className="px-4 py-2.5">
                        <div className="font-semibold text-sm text-slate-900">{user.name}</div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                        <span className="inline-block mt-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md text-[10px] font-bold uppercase tracking-wider border border-indigo-100">
                          {user.role}
                        </span>
                      </div>
                      <div className="border-t border-slate-100 pt-1.5">
                        <button
                          onClick={logout}
                          className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 font-bold flex items-center transition-colors"
                        >
                          <LogOut className="h-4 w-4 mr-2" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pl-4 border-l border-slate-200">
                  <Link
                    href="/login"
                    className="inline-flex items-center px-4 py-2 border border-slate-200 text-xs font-bold rounded-lg text-slate-700 bg-white hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign In / Demo Access
                  </Link>
                </div>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="flex items-center md:hidden">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus:outline-none"
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu, show/hide based on menu state. */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-2 pt-2 pb-3 space-y-1">
            {navItems.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center px-4 py-2.5 rounded-md text-base font-medium transition-colors ${
                    active
                      ? 'text-slate-950 bg-slate-100 font-semibold'
                      : 'text-slate-600 hover:text-slate-950 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="mr-3 h-5 w-5 text-slate-500" />
                  {item.name}
                </Link>
              );
            })}

            {user ? (
              <div className="border-t border-slate-100 mt-4 pt-4 px-4">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm">
                    {user.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.email}</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center px-4 py-2 text-base font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                >
                  <LogOut className="h-5 w-5 mr-3" />
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="border-t border-slate-100 mt-4 pt-4 px-2">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center w-full px-4 py-2.5 border border-slate-200 text-base font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
                >
                  <LogIn className="h-5 w-5 mr-3 text-slate-500" />
                  Sign In / Demo Access
                </Link>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {requiresAuth && isLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center text-sm font-semibold text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-indigo-600" />
            {authLoadingLabel}
          </div>
        ) : requiresAuth && !user ? (
          <section className="mx-auto flex min-h-[56vh] max-w-xl flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              Sign in required
            </h1>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              Contacts, groups, and campaigns are workspace data. Sign in with a demo profile to continue.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm shadow-indigo-100 transition-colors hover:bg-indigo-500"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign In / Demo Access
            </Link>
          </section>
        ) : (
          children
        )}
      </main>

      {/* Clean Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center text-slate-400 text-xs">
          <div>
            &copy; 2026 Campaign Sequencer. Simulated outbox only.
          </div>
          <div className="mt-2 sm:mt-0 flex space-x-6">
            <span>Server-side LLM generation</span>
            <span>No real emails are sent</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
