'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import { ContactGroup, groupsApi } from '@/services/groups';

export function useGroups() {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ContactGroup | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextGroups = await groupsApi.list();
      setGroups(nextGroups);
      setSelectedGroup((current) => {
        if (!current) {
          return nextGroups[0] || null;
        }
        return nextGroups.find((group) => group._id === current._id) || null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectGroup = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setSelectedGroup(await groupsApi.getOne(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load group');
    } finally {
      setLoading(false);
    }
  }, []);

  const createGroup = useCallback(
    async (body: { name: string; description?: string }) => {
      setSaving(true);
      setError(null);
      try {
        const group = await groupsApi.create(body);
        await load();
        setSelectedGroup(await groupsApi.getOne(group._id));
        return group;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to create group');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const addContacts = useCallback(
    async (groupId: string, contactIds: string[]) => {
      setSaving(true);
      setError(null);
      try {
        await groupsApi.addContacts(groupId, contactIds);
        await load();
        setSelectedGroup(await groupsApi.getOne(groupId));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to add contacts');
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const removeContact = useCallback(
    async (groupId: string, contactId: string) => {
      setSaving(true);
      setError(null);
      try {
        await groupsApi.removeContact(groupId, contactId);
        await load();
        setSelectedGroup(await groupsApi.getOne(groupId));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to remove contact');
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  return {
    groups,
    selectedGroup,
    loading,
    saving,
    error,
    reload: load,
    selectGroup,
    createGroup,
    addContacts,
    removeContact,
  };
}
