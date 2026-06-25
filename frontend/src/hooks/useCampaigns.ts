'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import {
  Campaign,
  CreateCampaignBody,
  campaignsApi,
} from '@/services/campaigns';

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCampaigns(await campaignsApi.list());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createCampaign = useCallback(async (body: CreateCampaignBody) => {
    setSaving(true);
    setError(null);
    try {
      return await campaignsApi.create(body);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create campaign');
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    campaigns,
    loading,
    saving,
    error,
    reload: load,
    createCampaign,
  };
}
