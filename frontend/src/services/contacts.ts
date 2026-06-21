import { request } from './api';

/**
 * STARTER service layer for contacts. Fill in the calls your pages need.
 * Keep types honest — they should match the API responses.
 */

export interface Contact {
  _id: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
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

export const contactsApi = {
  list(params: ListContactsParams = {}): Promise<PaginatedContacts> {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<PaginatedContacts>(`/contacts${qs ? `?${qs}` : ''}`);
  },

  create(body: {
    name: string;
    email: string;
    company?: string;
    title?: string;
  }): Promise<Contact> {
    return request<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
