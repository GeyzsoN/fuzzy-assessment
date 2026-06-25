import { request } from './api';

/**
 * Contacts service layer used by hooks/components instead of raw fetch calls.
 */

export interface Contact {
  _id: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
  doNotContact?: boolean;
  createdAt: string;
}

export interface PaginatedContacts {
  items: Contact[];
  total: number;
  page: number;
  limit: number;
}

export interface ListContactsParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: 'name' | 'createdAt';
}

export interface CreateContactBody {
  name: string;
  email: string;
  company?: string;
  title?: string;
  doNotContact?: boolean;
}

export const contactsApi = {
  list(params: ListContactsParams = {}): Promise<PaginatedContacts> {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<PaginatedContacts>(`/contacts${qs ? `?${qs}` : ''}`);
  },

  create(body: CreateContactBody): Promise<Contact> {
    return request<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
