'use client';

import React from 'react';
import Link from 'next/link';
import { Mail, Users, FolderGit2, ArrowRight, UserPlus, Zap, Settings } from 'lucide-react';
import Shell from '@/components/shell';
import { useAuth } from '@/hooks/use-auth';

export default function Home() {
  const { user } = useAuth();

  return (
    <Shell>
      {/* Hero Section */}
      <div className="py-12 md:py-20 text-center max-w-4xl mx-auto">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-sans font-extrabold tracking-tight text-slate-900 leading-none">
          Automated outreach <br />
          <span className="text-indigo-600 font-bold">with high-precision sequencing</span>
        </h1>
        <p className="mt-6 text-lg text-slate-500 leading-relaxed max-w-2xl mx-auto">
          Manage your high-value contacts, segment them into target groups, and build multi-step simulated outbox sequences with personalized, context-aware messages backed by server-side LLM generation.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4">
          <Link
            href={user ? "/campaigns" : "/login"}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-all shadow-md shadow-indigo-100"
          >
            Manage Campaigns
            <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
          <Link
            href={user ? "/contacts" : "/login"}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-slate-200 text-base font-semibold rounded-xl text-slate-700 bg-white hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
          >
            View Contacts
          </Link>
        </div>
      </div>

      {/* Feature Section */}
      <div className="mt-16 border-t border-slate-200 pt-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-sans font-bold text-slate-900 tracking-tight">
            Designed for high-touch customer communication
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            A minimalist workspace engineered to organize audiences and build sequences without the clutter.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Feature 1: Contacts */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all duration-300">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-4">
              <UserPlus className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-sans font-semibold text-slate-900">
              Precise Contact Control
            </h3>
            <p className="mt-2.5 text-sm text-slate-500 leading-relaxed">
              Maintain an active roster of contacts with clear metadata (role, company, and email). Easily flag individual contacts to suppress or bypass outreach to preserve relationships.
            </p>
            <div className="mt-5">
              <Link href="/contacts" className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700">
                Manage Contacts <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Feature 2: Groups */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all duration-300">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-4">
              <Users className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-sans font-semibold text-slate-900">
              Segmented target groups
            </h3>
            <p className="mt-2.5 text-sm text-slate-500 leading-relaxed">
              Create specific segment groups based on industries, titles, or event cohorts. Dynamically add and remove members, with real-time membership synchronization across your lists.
            </p>
            <div className="mt-5">
              <Link href="/groups" className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700">
                Manage Groups <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Feature 3: Sequences */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all duration-300">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-4">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-sans font-semibold text-slate-900">
              AI-Powered Sequences
            </h3>
            <p className="mt-2.5 text-sm text-slate-500 leading-relaxed">
              Build sequence steps with custom delay timers. Design prompt templates that resolve contact details dynamically, enabling server-side LLM to generate personalized drafts.
            </p>
            <div className="mt-5">
              <Link href="/campaigns" className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700">
                Build Campaigns <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
