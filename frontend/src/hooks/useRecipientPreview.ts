'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/services/api';
import { Contact } from '@/services/contacts';
import { groupsApi } from '@/services/groups';

export interface RecipientPreview {
  contact: Contact;
  sources: string[];
  direct: boolean;
}

export function useRecipientPreview(
  groupIds: string[],
  directContactIds: string[],
  contacts: Contact[],
) {
  const [groupContacts, setGroupContacts] = useState<RecipientPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directContacts = useMemo(() => {
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    return directContactIds
      .map((id) => contactsById.get(id))
      .filter(Boolean)
      .map((contact) => ({
        contact: contact as Contact,
        sources: [],
        direct: true,
      }));
  }, [contacts, directContactIds]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const groups = await Promise.all(groupIds.map((id) => groupsApi.getOne(id)));
        if (cancelled) {
          return;
        }
        const next = groups.flatMap((group) =>
          (group.contacts || []).map((contact) => ({
            contact,
            sources: [group.name],
            direct: false,
          })),
        );
        setGroupContacts(next);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof ApiError ? e.message : 'Failed to resolve recipients',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [groupIds]);

  const recipients = useMemo(() => {
    const map = new Map<string, RecipientPreview>();
    for (const entry of [...groupContacts, ...directContacts]) {
      if (entry.contact.doNotContact) {
        continue;
      }
      const existing = map.get(entry.contact._id);
      if (existing) {
        existing.sources = [...new Set([...existing.sources, ...entry.sources])];
        existing.direct = existing.direct || entry.direct;
      } else {
        map.set(entry.contact._id, {
          contact: entry.contact,
          sources: entry.sources,
          direct: entry.direct,
        });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.contact.email.localeCompare(b.contact.email),
    );
  }, [directContacts, groupContacts]);

  return { recipients, loading, error };
}
