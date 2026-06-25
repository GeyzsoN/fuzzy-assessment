'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RefreshCw, Play, Mail, Users, CheckCircle2, AlertCircle, Loader2, ArrowLeft, Sparkles, Check, AlertTriangle, HelpCircle } from 'lucide-react';
import Shell from '@/components/shell';
import { campaignsService, groupsService, Campaign, OutboxRow, ContactGeneration, Contact } from '@/services/api';

function looksLikeGenerationInstruction(value: string) {
  return /^\s*(write|draft|generate|create)\b/i.test(value || '');
}

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [generations, setGenerations] = useState<Record<string, ContactGeneration>>({});
  const [groupContacts, setGroupContacts] = useState<Contact[]>([]);

  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [sequenceGenerating, setSequenceGenerating] = useState(false);
  const [generatingContactId, setGeneratingContactId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const previousStatusRef = useRef<string | null>(null);

  // Load Campaign and outbox logs
  const loadCampaignData = useCallback(async (options?: { silent?: boolean }) => {
    if (!id) return;
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const camp = await campaignsService.getById(id);
      setCampaign(camp);

      // Load outbox logs if running or completed
      if (
        camp.status !== 'draft' &&
        camp.status !== 'generating' &&
        camp.status !== 'failed'
      ) {
        const outboxData = await campaignsService.getOutbox(id);
        setOutbox(outboxData.outbox);
        setGenerations(outboxData.generations);
      } else {
        setOutbox([]);
        setGenerations({});
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load campaign details.');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    loadCampaignData();
  }, [loadCampaignData]);

  useEffect(() => {
    if (!campaign) return;

    const previousStatus = previousStatusRef.current;
    if (previousStatus === 'generating' && campaign.status === 'draft') {
      setGenerationNotice('Campaign sequence generated. Review the email templates, then launch when ready.');
    }
    if (previousStatus === 'generating' && campaign.status === 'failed') {
      setGenerationNotice('Campaign generation failed. Review the error and generate a new draft.');
    }
    previousStatusRef.current = campaign.status;
  }, [campaign]);

  useEffect(() => {
    if (!campaign || campaign.status !== 'generating') return;

    const interval = window.setInterval(() => {
      loadCampaignData({ silent: true });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [campaign, loadCampaignData]);

  useEffect(() => {
    if (!campaign || campaign.targetGroupIds.length === 0) {
      setGroupContacts([]);
      return;
    }

    let cancelled = false;
    Promise.all(
      campaign.targetGroupIds.map((groupId) =>
        groupsService.getById(groupId).catch(() => null),
      ),
    ).then((groups) => {
      if (cancelled) return;
      const members = groups
        .filter(Boolean)
        .flatMap((group) => group?.members || []);
      setGroupContacts(members);
    });

    return () => {
      cancelled = true;
    };
  }, [campaign]);

  // Launch campaign handler
  const handleLaunch = async () => {
    if (!campaign) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      await campaignsService.launch(campaign.id);
      await loadCampaignData();
    } catch (err: any) {
      setLaunchError(err.message || 'Launch failed.');
    } finally {
      setLaunching(false);
    }
  };

  const handleGenerateSequence = async () => {
    if (!campaign) return;
    setSequenceGenerating(true);
    setLaunchError(null);
    try {
      const updated = await campaignsService.generateSequence(campaign.id);
      setCampaign(updated);
      setGenerationNotice('Generating campaign emails. This page will update when the sequence is ready.');
    } catch (err: any) {
      setLaunchError(err.message || 'Failed to generate campaign sequence.');
    } finally {
      setSequenceGenerating(false);
    }
  };

  // Prepare the next queued outbox email from the generated body template.
  const handleGenerate = async (contactId: string) => {
    if (!campaign) return;
    setGeneratingContactId(contactId);
    setLaunchError(null);
    try {
      await campaignsService.generateForContact(campaign.id, contactId);
      // Reload campaign outbox and generations
      const outboxData = await campaignsService.getOutbox(campaign.id);
      setOutbox(outboxData.outbox);
      setGenerations(outboxData.generations);

      // Update local campaign status in case it completed
      const camp = await campaignsService.getById(campaign.id);
      setCampaign(camp);
    } catch (err: any) {
      setLaunchError(err.message || 'Email template preparation failed.');
    } finally {
      setGeneratingContactId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-slate-50 text-slate-600 border-slate-200/60';
      case 'generating': return 'bg-amber-50 text-amber-700 border-amber-200/60 animate-pulse';
      case 'launching': return 'bg-amber-50 text-amber-700 border-amber-200/60 animate-pulse';
      case 'running': return 'bg-indigo-50 text-indigo-700 border-indigo-100 animate-pulse';
      case 'completed': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'failed': return 'bg-rose-50 text-rose-700 border-rose-100';
      default: return 'bg-slate-50 text-slate-500';
    }
  };

  const outboxByContact = useMemo(() => {
    const grouped = new Map<string, OutboxRow[]>();
    outbox.forEach((row) => {
      const rows = grouped.get(row.contactId) || [];
      rows.push(row);
      grouped.set(row.contactId, rows);
    });
    grouped.forEach((rows) => rows.sort((a, b) => a.stepOrder - b.stepOrder));
    return grouped;
  }, [outbox]);

  const isPreLaunch = campaign
    ? campaign.status === 'draft' ||
      campaign.status === 'generating' ||
      campaign.status === 'failed'
    : false;

  const sequenceNeedsGeneration = Boolean(
    campaign &&
      campaign.status === 'draft' &&
      campaign.targetGroupIds.length > 0 &&
      campaign.sequenceSteps.some((step) =>
        looksLikeGenerationInstruction(step.promptTemplate),
      ),
  );

  const audienceContacts = useMemo(() => {
    if (!campaign) return [];

    const rows = new Map<
      string,
      {
        id: string;
        name: string;
        email: string;
        company: string;
        title: string;
        source: string;
        directEntry?: Campaign['contacts'][number];
      }
    >();

    groupContacts.forEach((contact) => {
      rows.set(contact.id, {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        company: contact.company,
        title: contact.title,
        source: 'Group',
      });
    });

    campaign.contacts.forEach((entry) => {
      if (!entry.contact) return;
      const existing = rows.get(entry.contactId);
      rows.set(entry.contactId, {
        id: entry.contactId,
        name: entry.contact.name,
        email: entry.contact.email,
        company: entry.contact.company,
        title: entry.contact.title,
        source: existing ? 'Group + Attached' : 'Attached',
        directEntry: entry,
      });
    });

    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [campaign, groupContacts]);

  const getOutboxStatusColor = (status: string) => {
    switch (status) {
      case 'queued': return 'bg-amber-50 text-amber-700 border-amber-150';
      case 'processing': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
      case 'sent': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'failed': return 'bg-rose-50 text-rose-700 border-rose-100';
      default: return 'bg-slate-50 text-slate-500';
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="py-24 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="h-10 w-10 animate-spin mb-3 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-500">Resolving sequence parameters...</span>
        </div>
      </Shell>
    );
  }

  if (error || !campaign) {
    return (
      <Shell>
        <div className="max-w-2xl mx-auto py-12">
          <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center space-y-4 shadow-sm">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h2 className="text-lg font-bold text-slate-900">Campaign Not Found</h2>
            <p className="text-sm text-red-600 font-medium">{error || 'The requested campaign sequence could not be found.'}</p>
            <button
              onClick={() => router.push('/campaigns')}
              className="inline-flex items-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-100 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Return to Registry
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Detail Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-5 mb-8 gap-4">
        <div className="space-y-1">
          <button
            onClick={() => router.push('/campaigns')}
            className="inline-flex items-center text-xs font-bold text-slate-400 hover:text-slate-900 transition-colors group mb-1.5 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1 group-hover:-translate-x-0.5 transition-transform" />
            Back to Campaigns
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-sans font-bold tracking-tight text-slate-950">
              {campaign.name}
            </h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${getStatusColor(campaign.status)}`}>
              {campaign.status}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Created on {new Date(campaign.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center space-x-3 w-full md:w-auto">
          {/* Refresh Action */}
          <button
            onClick={() => loadCampaignData()}
            className="flex-1 md:flex-none inline-flex items-center justify-center px-3.5 py-2 border border-slate-200 text-xs font-semibold rounded-xl text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
            Refresh
          </button>

          {sequenceNeedsGeneration && (
            <button
              onClick={handleGenerateSequence}
              disabled={sequenceGenerating}
              className="flex-1 md:flex-none inline-flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer active:scale-95"
            >
              {sequenceGenerating ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5 mr-1.5" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Generate Sequence
                </>
              )}
            </button>
          )}

          {/* Launch Action */}
          {campaign.status === 'draft' &&
            campaign.sequenceSteps.length > 0 &&
            !sequenceNeedsGeneration && (
            <button
              onClick={handleLaunch}
              disabled={launching}
              className="flex-1 md:flex-none inline-flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer active:scale-95"
            >
              {launching ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5 mr-1.5" />
                  Locking Snapshot...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
                  Launch Sequence
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {launchError && (
        <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center shadow-sm">
          <AlertCircle className="h-5 w-5 mr-3 shrink-0 text-red-500" />
          <span>{launchError}</span>
        </div>
      )}

      {generationNotice && (
        <div className={`mb-8 p-4 rounded-2xl text-sm font-medium flex items-center shadow-sm ${
          campaign.status === 'failed'
            ? 'bg-red-50 border border-red-100 text-red-600'
            : 'bg-emerald-50 border border-emerald-100 text-emerald-700'
        }`}>
          {campaign.status === 'failed' ? (
            <AlertCircle className="h-5 w-5 mr-3 shrink-0 text-red-500" />
          ) : (
            <CheckCircle2 className="h-5 w-5 mr-3 shrink-0 text-emerald-600" />
          )}
          <span>{generationNotice}</span>
        </div>
      )}

      {/* Grid: Overview Summary Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Status</span>
          <span className={`inline-block text-xs font-bold uppercase tracking-wider border rounded-lg px-2.5 py-1 ${getStatusColor(campaign.status)}`}>
            {campaign.status}
          </span>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Sequence Steps</span>
          <span className="text-lg font-sans font-extrabold text-slate-900">{campaign.sequenceSteps.length} Steps</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Audience</span>
          <span className="text-lg font-sans font-extrabold text-slate-900">
            {isPreLaunch
              ? `${campaign.targetGroupIds.length} Groups / ${audienceContacts.length} Contacts`
              : `${campaign.recipients.length} Contacts`}
          </span>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Total Outbox Rows</span>
          <span className="text-lg font-sans font-extrabold text-slate-900">
            {isPreLaunch ? '—' : `${outbox.length} Logs`}
          </span>
        </div>
      </div>

      {/* Main View Split columns */}
      <div className="space-y-8">

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              Sequence Steps
            </span>
            <span className="text-xs font-semibold text-slate-500">
              {campaign.sequenceSteps.length} email templates
            </span>
          </div>

          {campaign.sequenceSteps.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
              {campaign.status === 'generating'
                ? 'Generating email templates from the LLM...'
                : 'No sequence steps available.'}
            </div>
          ) : (
            <div className="space-y-4">
              {campaign.sequenceSteps.map((step) => {
                const pending = looksLikeGenerationInstruction(step.promptTemplate);
                return (
                  <section
                    key={step.order}
                    className="rounded-xl border border-slate-200 bg-slate-50/40 p-5"
                  >
                    <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white font-mono text-sm font-bold text-slate-900">
                          {step.order}
                        </span>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Subject
                          </div>
                          <div className="mt-1 text-sm font-bold text-slate-950">
                            {step.subjectTemplate}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                        Delay: {step.delayMinutes} mins
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Email Body
                      </div>
                      <div className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm leading-7 text-slate-700">
                        {pending
                          ? 'Email body pending generation.'
                          : step.promptTemplate}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Audience contacts and per-contact generation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Audience Contacts
              </span>
              <p className="mt-1 text-xs text-slate-500">
                Contacts selected directly or through campaign groups.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 bg-slate-50 text-[10px] text-slate-600 font-bold border border-slate-200 rounded-lg">
              {audienceContacts.length} contacts
            </span>
          </div>

          {audienceContacts.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
              No contacts found for this audience yet.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-55 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Generated Message / Error</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 text-slate-700">
                  {audienceContacts.map((row) => {
                    const entry = row.directEntry;
                    const isGenerating = Boolean(entry && generatingContactId === entry.contactId);
                    const status = isGenerating ? 'pending' : entry?.status || 'ready';
                    return (
                      <tr key={row.id} className="hover:bg-indigo-50/10 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">
                            {row.name || 'Contact unavailable'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {row.title || 'No title'} at {row.company || 'No company'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border bg-slate-50 text-slate-600 border-slate-200">
                            {row.source}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${
                            status === 'finished'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : status === 'failed'
                                ? 'bg-rose-50 text-rose-700 border-rose-100'
                                : status === 'pending'
                                  ? 'bg-amber-50 text-amber-700 border-amber-100'
                                  : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                            {isGenerating ? 'generating' : status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {isGenerating ? (
                            <span className="inline-flex items-center text-slate-500">
                              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin text-amber-500" />
                              Generating message...
                            </span>
                          ) : entry?.status === 'finished' ? (
                            <p className="whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-600 bg-slate-50/60 border border-slate-200/70 rounded-xl p-3">
                              {entry.generatedMessage}
                            </p>
                          ) : entry?.status === 'failed' ? (
                            <p className="text-[11px] leading-relaxed text-rose-600 bg-rose-50/60 border border-rose-100 rounded-xl p-3">
                              {entry.error || 'Generation failed.'}
                            </p>
                          ) : !entry ? (
                            <span className="text-slate-400">Included when the sequence is launched.</span>
                          ) : (
                            <span className="text-slate-400">No message generated yet.</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => entry && handleGenerate(entry.contactId)}
                            disabled={!entry || isGenerating || !entry.contact}
                            className="inline-flex items-center justify-center px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-[11px] rounded-xl transition-all shadow-sm cursor-pointer"
                          >
                            {isGenerating ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Generating
                              </>
                            ) : !entry ? (
                              <>
                                <Users className="h-3.5 w-3.5 mr-1.5" />
                                Group Target
                              </>
                            ) : (
                              <>
                                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                                Generate Message
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Row 2: IF DRAFT, show TARGETING summary. IF ACTIVE, show recipients, outbox and generations */}
        {isPreLaunch ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-sm shadow-sm py-12 space-y-4">
            {campaign.status === 'generating' ? (
              <>
                <Loader2 className="h-8 w-8 text-amber-500 mx-auto animate-spin" />
                <h3 className="font-bold text-slate-800">Generating Campaign Sequence</h3>
                <p className="max-w-md mx-auto text-xs text-slate-400 leading-relaxed">
                  The backend accepted the campaign and queued the LLM job. This page refreshes automatically until the email templates are ready.
                </p>
              </>
            ) : campaign.status === 'failed' ? (
              <>
                <AlertCircle className="h-8 w-8 text-rose-500 mx-auto" />
                <h3 className="font-bold text-slate-800">Campaign Generation Failed</h3>
                <p className="max-w-md mx-auto text-xs text-rose-500 leading-relaxed">
                  {campaign.generationError || 'The LLM draft generation job failed.'}
                </p>
              </>
            ) : (
              <>
                <Sparkles className="h-8 w-8 text-indigo-400 mx-auto" />
                <h3 className="font-bold text-slate-800">Campaign Sequence in Draft</h3>
                <p className="max-w-md mx-auto text-xs text-slate-400 leading-relaxed">
                  Targeting configurations are saved, but recipients have not been locked. Click the <strong className="text-slate-700 font-bold">Launch Sequence</strong> button at the top to take a snapshot of active contacts and initialize the automated outbox logs.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-8">

            {/* Split: Snapshot Recipients & Original per-contact generation */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

              {/* Left Column: Snapshot Recipients (2/5 cols) */}
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Recipient Snapshot ({campaign.recipients.length})
                </span>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto shadow-sm">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-55 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-3">Name / Company</th>
                        <th className="px-3 py-3">Email</th>
                        <th className="px-3 py-3 text-right">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700">
                      {campaign.recipients.map((rec) => (
                        <tr key={rec.id} className="hover:bg-indigo-50/10 transition-colors">
                          <td className="px-3 py-3.5">
                            <div className="font-semibold text-slate-900">{rec.name}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{rec.company || '—'} • {rec.title || '—'}</div>
                          </td>
                          <td className="px-3 py-3.5 font-mono text-[10px] text-slate-500">
                            {rec.email}
                          </td>
                          <td className="px-3 py-3.5 text-right">
                            <span className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[9px] font-semibold text-slate-500">
                              {rec.source}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Column: Original per-contact generation section (3/5 cols) */}
              <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Generated Email Drafts
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 bg-indigo-50 text-[10px] text-indigo-700 font-bold border border-indigo-100 rounded-lg shadow-sm">
                    template hydration
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto shadow-sm">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-55 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3.5">Target Contact</th>
                        <th className="px-4 py-3.5">Draft Generation Status</th>
                        <th className="px-4 py-3.5 text-right">Drip Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700">
                      {campaign.recipients.map((rec) => {
                        const genKey = `${campaign.id}:${rec.id}`;
                        const genState = generations[genKey] || { status: 'idle', message: '', error: null };
                        const rowsForContact = outboxByContact.get(rec.id) || [];
                        const nextActionableRow = rowsForContact.find(
                          (row) => row.status === 'queued' || row.status === 'failed',
                        );
                        const processingRow = rowsForContact.find(
                          (row) => row.status === 'processing',
                        );
                        const sentRows = rowsForContact.filter((row) => row.status === 'sent');
                        const latestSentRow = sentRows[sentRows.length - 1];
                        const isGenerating = generatingContactId === rec.id;
                        const canGenerate = Boolean(nextActionableRow) && !processingRow;

                        return (
                          <tr key={rec.id} className="hover:bg-indigo-50/10 transition-colors">
                            <td className="px-4 py-4 w-48">
                              <div className="font-semibold text-slate-900">{rec.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{rec.email}</div>
                            </td>
                            <td className="px-4 py-4 max-w-xs">
                              {isGenerating ? (
                                <div className="flex items-center text-xs text-indigo-600 font-bold">
                                  <Loader2 className="animate-spin h-3.5 w-3.5 mr-1.5 text-indigo-500" />
                                  Preparing email...
                                </div>
                              ) : processingRow ? (
                                <div className="space-y-1">
                                  <div className="flex items-center text-xs text-indigo-600 font-bold uppercase tracking-wider">
                                    <Loader2 className="animate-spin h-3.5 w-3.5 mr-1 text-indigo-500" />
                                    Processing step {processingRow.stepOrder}
                                  </div>
                                  <p className="text-[10px] text-slate-500">
                                    Worker is hydrating this campaign email template.
                                  </p>
                                </div>
                              ) : nextActionableRow?.status === 'failed' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center text-xs text-rose-600 font-bold uppercase tracking-wider">
                                    <AlertTriangle className="h-3.5 w-3.5 mr-1 text-rose-500" />
                                    Step {nextActionableRow.stepOrder} failed
                                  </div>
                                  <p className="text-[9px] text-rose-500 font-medium">
                                    {nextActionableRow.error || 'Ready to retry generation.'}
                                  </p>
                                </div>
                              ) : nextActionableRow ? (
                                <div className="space-y-1">
                                  <div className="flex items-center text-xs text-amber-600 font-bold uppercase tracking-wider">
                                    <Mail className="h-3.5 w-3.5 mr-1 text-amber-500" />
                                    Step {nextActionableRow.stepOrder} queued
                                  </div>
                                  <p className="text-[10px] text-slate-500">
                                    Scheduled for {new Date(nextActionableRow.scheduledAt).toLocaleString()}
                                  </p>
                                </div>
                              ) : latestSentRow ? (
                                <div className="space-y-1">
                                  <div className="flex items-center text-xs text-emerald-600 font-bold uppercase tracking-wider">
                                    <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                                    {sentRows.length} email{sentRows.length === 1 ? '' : 's'} generated
                                  </div>
                                  <p className="whitespace-pre-wrap break-words text-[12px] text-slate-600 font-sans leading-6 bg-slate-50 p-3 border border-slate-200/60 rounded-lg">
                                    &ldquo;{latestSentRow.message}&rdquo;
                                  </p>
                                </div>
                              ) : genState.status === 'completed' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center text-xs text-emerald-600 font-bold uppercase tracking-wider">
                                    <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                                    Completed
                                  </div>
                                  <p className="whitespace-pre-wrap break-words text-[12px] text-slate-600 font-sans leading-6 bg-slate-50 p-3 border border-slate-200/60 rounded-lg">
                                    &ldquo;{genState.message}&rdquo;
                                  </p>
                                </div>
                              ) : genState.status === 'failed' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center text-xs text-rose-600 font-bold uppercase tracking-wider">
                                    <AlertTriangle className="h-3.5 w-3.5 mr-1 text-rose-500" />
                                    Failed
                                  </div>
                                  <p className="text-[9px] text-rose-500 font-medium">{genState.error || 'Template runtime error.'}</p>
                                </div>
                              ) : (
                                <div className="flex items-center text-xs text-slate-400 italic font-medium">
                                  <HelpCircle className="h-3.5 w-3.5 mr-1 text-slate-300" />
                                  Ready to generate
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4 text-right w-36">
                              <button
                                onClick={() => handleGenerate(rec.id)}
                                disabled={!canGenerate || isGenerating || generatingContactId !== null}
                                className="inline-flex items-center px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 text-white disabled:text-slate-400 text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
                              >
                                {isGenerating ? (
                                  <Loader2 className="animate-spin h-3 w-3" />
                                ) : nextActionableRow?.status === 'failed' ? (
                                  <>
                                    <Sparkles className="h-3 w-3 mr-1" />
                                    Retry
                                  </>
                                ) : nextActionableRow ? (
                                  <>
                                    <Sparkles className="h-3 w-3 mr-1" />
                                    Generate
                                  </>
                                ) : (
                                  <>
                                    <Check className="h-3 w-3 mr-1" />
                                    Generated
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>

            {/* Outbox Drip Send logs (full-width) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Simulated Campaign Outbox Logs
                </span>
                <span className="inline-flex items-center px-2 py-0.5 bg-indigo-50 text-[10px] text-indigo-750 border border-indigo-100 rounded-lg text-xs font-bold uppercase tracking-wide">
                  Outbox is simulated. No real emails are delivered
                </span>
              </div>

              {outbox.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  No outbox logs initialized.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-55 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3">Recipient</th>
                        <th className="px-4 py-3 text-center">Step</th>
                        <th className="px-4 py-3">Subject Line</th>
                        <th className="px-4 py-3">Message Body Draft</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3 text-center">Attempts</th>
                        <th className="px-4 py-3 text-right">Scheduled / Sent At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700">
                      {outbox.map((row) => (
                        <tr key={row.id} className="hover:bg-indigo-50/10 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{row.recipientName}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.recipientEmail}</div>
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-semibold text-slate-500">
                            Step {row.stepOrder}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {row.subject}
                          </td>
                          <td className="px-4 py-3 min-w-[22rem]">
                            {row.status === 'sent' ? (
                              <p className="whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-600 bg-slate-50/50 p-3 border border-slate-200/60 rounded-xl font-sans">
                                {row.message}
                              </p>
                            ) : row.status === 'failed' ? (
                              <p className="text-[10px] leading-relaxed text-rose-600 bg-rose-50/50 p-2.5 border border-rose-200/60 rounded-xl font-mono">
                                {row.error || 'Simulated Delivery Failure'}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-400 italic font-medium">
                                Email pending. Click &apos;Generate&apos; above.
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${getOutboxStatusColor(row.status)}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                            {row.attempts}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[10px] text-slate-400">
                            {row.status === 'sent' && row.sentAt ? (
                              <div>
                                <span className="block text-slate-700 font-bold mb-0.5">Sent At</span>
                                {new Date(row.sentAt).toLocaleString()}
                              </div>
                            ) : (
                              <div>
                                <span className="block text-amber-600 font-bold mb-0.5">Scheduled</span>
                                {new Date(row.scheduledAt).toLocaleString()}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

    </Shell>
  );
}
