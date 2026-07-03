'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  contactsApi,
  CreateContactBody,
  Contact,
  ListContactsParams,
} from '@/services/contacts';
import { ApiError } from '@/services/api';

/**
 * Contacts data hook. Components use this instead of calling fetch/services
 * directly so loading, error, refetch, and create state stay in one place.
 */
export function useContacts(initial: ListContactsParams = {}) {
  const [data, setData] = useState<{
    items: Contact[];
    total: number;
    page: number;
    limit: number;
  } | null>(null);
  const [params, setParams] = useState<ListContactsParams>(initial);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (options: { cancelPrevious?: boolean } = {}) => {
    if (options.cancelPrevious) {
      abortRef.current?.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    setLoading(true);
    setError(null);
    try {
      const res = await contactsApi.list(params, { signal: controller.signal });
      if (requestSeq !== requestSeqRef.current) return;
      setData({
        items: res.items,
        total: res.total,
        page: res.page,
        limit: res.limit,
      });
    } catch (e) {
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current) {
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Failed to load contacts');
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }
  }, [params]);

  useEffect(() => {
    load({ cancelPrevious: true });

    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const createContact = useCallback(
    async (body: CreateContactBody) => {
      setCreating(true);
      setCreateError(null);
      try {
        await contactsApi.create(body);
        await load();
        return true;
      } catch (e) {
        setCreateError(
          e instanceof ApiError ? e.message : 'Failed to create contact',
        );
        return false;
      } finally {
        setCreating(false);
      }
    },
    [load],
  );

  return {
    data,
    loading,
    creating,
    error,
    createError,
    params,
    setParams,
    reload: load,
    createContact,
  };
}
