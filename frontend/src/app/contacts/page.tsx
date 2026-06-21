'use client';

import { useContacts } from '@/hooks/useContacts';

/**
 * STARTER page. Build:
 *  - a paginated, searchable table of contacts (use the useContacts hook),
 *  - a form to create a contact (add a create hook or extend useContacts),
 *  - real loading + error states.
 *
 * Keep data access in services/hooks — no fetch() in this component.
 */
export default function ContactsPage() {
  const { data, loading, error, setParams, params } = useContacts({
    page: 1,
    limit: 20,
  });

  return (
    <div>
      <h1>Contacts</h1>

      {/* TODO(candidate): search input -> setParams({ ...params, search }) */}
      {/* TODO(candidate): create-contact form */}

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

      {data && (
        <table cellPadding={8}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th align="left">Email</th>
              <th align="left">Company</th>
              <th align="left">Title</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((c) => (
              <tr key={c._id}>
                <td>{c.name}</td>
                <td>{c.email}</td>
                <td>{c.company}</td>
                <td>{c.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* TODO(candidate): pagination controls -> setParams({ ...params, page }) */}
    </div>
  );
}
