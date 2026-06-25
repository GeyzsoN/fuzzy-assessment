'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import { Campaign, OutboxMessage, campaignsApi } from '@/services/campaigns';

export function useCampaign(id: string) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingContactId, setGeneratingContactId] = useState<string | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCampaign, nextOutbox] = await Promise.all([
        campaignsApi.getOne(id),
        campaignsApi.getOutbox(id),
      ]);
      setCampaign(nextCampaign);
      setOutbox(nextOutbox);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = useCallback(
    async (contactId: string) => {
      setGeneratingContactId(contactId);
      setError(null);
      try {
        const result = await campaignsApi.generate(id, contactId);
        setCampaign((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            contacts: current.contacts.map((contact) =>
              contact.contactId === contactId
                ? {
                    ...contact,
                    status: result.status as typeof contact.status,
                    generatedMessage: result.message,
                    error: result.error,
                  }
                : contact,
            ),
          };
        });
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : 'Failed to generate message',
        );
      } finally {
        setGeneratingContactId(null);
      }
    },
    [id],
  );

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      setCampaign(await campaignsApi.launch(id));
      setOutbox(await campaignsApi.getOutbox(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to launch campaign');
    } finally {
      setLaunching(false);
    }
  }, [id]);

  return {
    campaign,
    outbox,
    loading,
    launching,
    error,
    generatingContactId,
    reload: load,
    generate,
    launch,
  };
}
