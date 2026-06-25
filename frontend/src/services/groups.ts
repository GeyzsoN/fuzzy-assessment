import { request } from './api';
import { Contact } from './contacts';

export interface ContactGroup {
  _id: string;
  name: string;
  description?: string;
  memberCount: number;
  contacts?: Contact[];
}

export interface CreateGroupBody {
  name: string;
  description?: string;
}

export const groupsApi = {
  list(): Promise<ContactGroup[]> {
    return request<ContactGroup[]>('/groups');
  },

  getOne(id: string): Promise<ContactGroup> {
    return request<ContactGroup>(`/groups/${id}`);
  },

  create(body: CreateGroupBody): Promise<ContactGroup> {
    return request<ContactGroup>('/groups', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  addContacts(id: string, contactIds: string[]): Promise<ContactGroup> {
    return request<ContactGroup>(`/groups/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ contactIds }),
    });
  },

  removeContact(id: string, contactId: string): Promise<ContactGroup> {
    return request<ContactGroup>(`/groups/${id}/contacts/${contactId}`, {
      method: 'DELETE',
    });
  },
};
