'use client';

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  RefreshCw,
  Search,
  Plus,
  Loader2,
  AlertCircle,
  Check,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from 'lucide-react';
import Shell from '@/components/shell';
import { useContacts } from '@/hooks/useContacts';

const DEFAULT_LIMIT = 10;
const ALLOWED_LIMITS = [10, 20, 50];
type ContactSort = 'name' | 'email' | 'company' | 'createdAt';
type ContactSortDirection = 'asc' | 'desc';

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readLimit(value: string | null) {
  const parsed = readPositiveInt(value, DEFAULT_LIMIT);
  return ALLOWED_LIMITS.includes(parsed) ? parsed : DEFAULT_LIMIT;
}

function readContactsSort(value: string | null): ContactSort {
  return ['name', 'email', 'company', 'createdAt'].includes(value || '')
    ? (value as ContactSort)
    : 'name';
}

function defaultSortDirection(sort: ContactSort): ContactSortDirection {
  return sort === 'createdAt' ? 'desc' : 'asc';
}

function readSortDirection(
  value: string | null,
  sort: ContactSort,
): ContactSortDirection {
  return value === 'asc' || value === 'desc' ? value : defaultSortDirection(sort);
}

function ContactsSortIcon({
  activeSort,
  activeDirection,
  sortKey,
}: {
  activeSort: ContactSort;
  activeDirection: ContactSortDirection;
  sortKey: ContactSort;
}) {
  if (activeSort !== sortKey) {
    return <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />;
  }

  return activeDirection === 'asc' ? (
    <ArrowUp className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
  );
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<Shell><div className="text-sm text-slate-500">Loading contacts...</div></Shell>}>
      <ContactsPageContent />
    </Suspense>
  );
}

function ContactsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const urlPage = readPositiveInt(searchParams.get('page'), 1);
  const urlLimit = readLimit(searchParams.get('limit'));
  const activeSearch = searchParams.get('search') || '';
  const activeSort = readContactsSort(searchParams.get('sort'));
  const activeDirection = readSortDirection(searchParams.get('direction'), activeSort);

  const [createSuccess, setCreateSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Search and Pagination
  const [searchQuery, setSearchQuery] = useState(activeSearch);

  // New Contact Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [suppressed, setSuppressed] = useState(false);
  const {
    data,
    loading,
    creating,
    error: loadError,
    createError,
    setParams,
    reload,
    createContact,
  } = useContacts({
    page: urlPage,
    limit: urlLimit,
    search: activeSearch,
    sort: activeSort,
    direction: activeDirection,
  });

  const contacts = (data?.items || []).map((contact) => ({
    id: contact._id,
    name: contact.name,
    email: contact.email,
    company: contact.company || '',
    title: contact.title || '',
    suppressed: Boolean(contact.doNotContact),
    createdAt: contact.createdAt,
  }));
  const page = data?.page || urlPage;
  const totalCount = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / (data?.limit || urlLimit)));

  const updateListUrl = useCallback(
    (next: {
      page?: number;
      limit?: number;
      search?: string;
      sort?: ContactSort;
      direction?: ContactSortDirection;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      const nextPage = next.page ?? urlPage;
      const nextLimit = next.limit ?? urlLimit;
      const nextSearch = next.search ?? activeSearch;
      const nextSort = next.sort ?? activeSort;
      const nextDirection = next.direction ?? activeDirection;

      params.set('page', String(Math.max(1, nextPage)));
      params.set('limit', String(nextLimit));
      params.set('sort', nextSort);
      params.set('direction', nextDirection);
      if (nextSearch.trim()) {
        params.set('search', nextSearch.trim());
      } else {
        params.delete('search');
      }

      router.push(`/contacts?${params.toString()}`, { scroll: false });
    },
    [activeDirection, activeSearch, activeSort, router, searchParams, urlLimit, urlPage],
  );

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    let changed = false;

    if (params.get('page') !== String(urlPage)) {
      params.set('page', String(urlPage));
      changed = true;
    }
    if (params.get('limit') !== String(urlLimit)) {
      params.set('limit', String(urlLimit));
      changed = true;
    }
    if (params.get('sort') !== activeSort) {
      params.set('sort', activeSort);
      changed = true;
    }
    if (params.get('direction') !== activeDirection) {
      params.set('direction', activeDirection);
      changed = true;
    }

    if (changed) {
      router.replace(`/contacts?${params.toString()}`, { scroll: false });
    }
  }, [activeDirection, activeSort, queryString, router, urlLimit, urlPage]);

  useEffect(() => {
    setSearchQuery(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    setParams({
      page: urlPage,
      limit: urlLimit,
      search: activeSearch,
      sort: activeSort,
      direction: activeDirection,
    });
  }, [activeDirection, activeSearch, activeSort, setParams, urlLimit, urlPage]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateListUrl({ page: 1, search: searchQuery });
  };

  const handleRefresh = () => {
    reload();
  };

  const handleSortChange = (sort: ContactSort) => {
    updateListUrl({
      page: 1,
      sort,
      direction:
        activeSort === sort
          ? activeDirection === 'asc'
            ? 'desc'
            : 'asc'
          : defaultSortDirection(sort),
    });
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreateSuccess(false);

    if (!name.trim() || !email.trim()) {
      setFormError('Name and Email are required.');
      return;
    }

    const created = await createContact({
      name: name.trim(),
      email: email.trim(),
      company: company.trim() || undefined,
      title: title.trim() || undefined,
      doNotContact: suppressed,
    });

    if (created) {
      // Clear Form
      setName('');
      setEmail('');
      setCompany('');
      setTitle('');
      setSuppressed(false);
      setCreateSuccess(true);

      // Reload list
      if (urlPage !== 1) {
        updateListUrl({ page: 1 });
      }
    }
  };

  return (
    <Shell>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-5 mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-sans font-semibold tracking-tight text-slate-950">
            Contacts
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Manage recipients, set suppression lists, and track audience profiles
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center px-3.5 py-2 border border-slate-200 text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 transition-colors shadow-sm cursor-pointer"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh Contacts
        </button>
      </div>

      {/* Main Grid: Create on Left (Desktop), Table on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Column: Create Contact Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sticky top-24 shadow-sm">
            <h2 className="text-sm font-sans font-bold text-slate-900 mb-5 uppercase tracking-wider">
              Add New Contact
            </h2>

            {(formError || createError) && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium flex items-start">
                <AlertCircle className="h-4 w-4 mr-1.5 shrink-0 mt-0.5 text-red-500" />
                <span>{formError || createError}</span>
              </div>
            )}

            {createSuccess && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700 font-medium flex items-center">
                <Check className="h-4 w-4 mr-1.5 text-emerald-600" />
                <span>Contact created successfully!</span>
              </div>
            )}

            <form onSubmit={handleCreateContact} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alice Vance"
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@techcorp.io"
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Company
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="TechCorp"
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="VP of Engineering"
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-50/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={suppressed}
                    onChange={(e) => setSuppressed(e.target.checked)}
                    className="h-4.5 w-4.5 accent-indigo-600 border-slate-300 rounded focus:ring-0 cursor-pointer"
                  />
                  <div>
                    <span className="block text-xs font-semibold text-slate-700">Suppress outreach</span>
                    <span className="block text-[10px] text-slate-400 leading-none">Do-not-contact / blacklisted</span>
                  </div>
                </label>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
              >
                {creating ? (
                  <>
                    <Loader2 className="animate-spin h-3.5 w-3.5 mr-2" />
                    Adding Contact...
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    Add Contact
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Search + Table */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Search section */}
          <form onSubmit={handleSearchSubmit} className="flex gap-2.5">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, company, title..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 transition-all shadow-sm"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
            >
              Search
            </button>
          </form>

          {/* Load Error Panel */}
          {loadError && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
              <span>{loadError}</span>
            </div>
          )}

          {/* Table Area */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin mb-3 text-indigo-500" />
                <span className="text-sm font-medium text-slate-500">Loading contact logs...</span>
              </div>
            ) : contacts.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-slate-400 text-sm">No contacts found.</p>
                {activeSearch && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      updateListUrl({ page: 1, search: '' });
                    }}
                    className="mt-3 inline-flex items-center px-3.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50"
                  >
                    Clear Search Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] table-fixed text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-55 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="w-[20%] px-6 py-4">
                        <button
                          type="button"
                          onClick={() => handleSortChange('name')}
                          className="inline-flex items-center gap-1 hover:text-slate-700"
                        >
                          Name / Title <ContactsSortIcon activeSort={activeSort} activeDirection={activeDirection} sortKey="name" />
                        </button>
                      </th>
                      <th className="w-[32%] px-6 py-4">
                        <button
                          type="button"
                          onClick={() => handleSortChange('email')}
                          className="inline-flex items-center gap-1 hover:text-slate-700"
                        >
                          Email <ContactsSortIcon activeSort={activeSort} activeDirection={activeDirection} sortKey="email" />
                        </button>
                      </th>
                      <th className="w-[26%] px-6 py-4">
                        <button
                          type="button"
                          onClick={() => handleSortChange('company')}
                          className="inline-flex items-center gap-1 hover:text-slate-700"
                        >
                          Company <ContactsSortIcon activeSort={activeSort} activeDirection={activeDirection} sortKey="company" />
                        </button>
                      </th>
                      <th className="w-[11%] px-6 py-4 text-center">Status</th>
                      <th className="w-[11%] px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortChange('createdAt')}
                          className="ml-auto inline-flex items-center gap-1 hover:text-slate-700"
                        >
                          Created <ContactsSortIcon activeSort={activeSort} activeDirection={activeDirection} sortKey="createdAt" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 text-slate-700 text-sm">
                    {contacts.map((contact) => (
                      <tr key={contact.id} className="hover:bg-indigo-50/10 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{contact.name}</div>
                          <div className="text-xs text-slate-400 font-medium mt-0.5">{contact.title || '—'}</div>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-500 break-all">
                          {contact.email}
                        </td>
                        <td className="px-6 py-4">
                          {contact.company ? (
                            <div className="max-w-[260px] rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-1.5 text-xs font-semibold leading-snug text-slate-600 break-words">
                              {contact.company}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {contact.suppressed ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100">
                              Suppressed
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-xs text-slate-400">
                          {new Date(contact.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination Footer */}
          {!loading && pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 pt-5">
              <div className="text-xs text-slate-400 font-medium">
                Showing page <span className="text-slate-700 font-semibold">{page}</span> of <span className="text-slate-700 font-semibold">{pageCount}</span> ({totalCount} total contacts)
              </div>
              <div className="flex items-center space-x-2">
                <select
                  value={urlLimit}
                  onChange={(e) => updateListUrl({ page: 1, limit: Number(e.target.value) })}
                  className="px-2.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                  aria-label="Contacts per page"
                >
                  {ALLOWED_LIMITS.map((limit) => (
                    <option key={limit} value={limit}>
                      {limit} / page
                    </option>
                  ))}
                </select>
                <button
                  disabled={page <= 1}
                  onClick={() => updateListUrl({ page: Math.max(page - 1, 1) })}
                  className="px-3.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={page >= pageCount}
                  onClick={() => updateListUrl({ page: Math.min(page + 1, pageCount) })}
                  className="px-3.5 py-1.5 border border-slate-200 text-xs font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
