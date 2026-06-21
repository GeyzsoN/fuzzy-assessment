'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  contactsApi,
  Contact,
  ListContactsParams,
} from '@/services/contacts';
import { ApiError } from '@/services/api';

/**
 * EXAMPLE hook — this is the pattern to follow for data fetching.
 *
 * A hook owns: the data, loading state, and error state. Components consume the
 * hook and render; they never call `fetch` or the service directly. Note the
 * loading flag is reset on BOTH success and error.
 *
 * Use this as a template for the campaign detail page's hook(s) too.
 */
export function useContacts(initial: ListContactsParams = {}) {
  const [data, setData] = useState<{ items: Contact[]; total: number } | null>(
    null,
  );
  const [params, setParams] = useState<ListContactsParams>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await contactsApi.list(params);
      setData({ items: res.items, total: res.total });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, params, setParams, reload: load };
}
