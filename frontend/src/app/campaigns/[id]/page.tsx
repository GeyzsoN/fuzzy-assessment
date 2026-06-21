'use client';

import { use } from 'react';

/**
 * STARTER campaign detail page. Build:
 *  - load the campaign (campaignsApi.getOne) via a hook,
 *  - list its attached contacts,
 *  - a "Generate message" button per contact that calls campaignsApi.generate
 *    and shows: idle -> generating -> result, plus a clear error/failed state.
 *
 * Follow the useContacts hook pattern for your data fetching.
 */
export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <div>
      <h1>Campaign</h1>
      <p>Campaign id: <code>{id}</code></p>
      {/* TODO(candidate): build the campaign detail + per-contact generate UI. */}
    </div>
  );
}
