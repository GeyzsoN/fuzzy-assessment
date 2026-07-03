'use client';

import type { ReactNode } from 'react';
import Shell from '@/components/shell';
import { useAuth } from '@/hooks/use-auth';

interface RequireAuthProps {
  children: ReactNode;
  loadingLabel?: string;
}

export default function RequireAuth({
  children,
  loadingLabel = 'Checking session...',
}: RequireAuthProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Shell authLoadingLabel={loadingLabel}>
        <div className="text-sm font-semibold text-slate-500">{loadingLabel}</div>
      </Shell>
    );
  }

  if (!user) {
    return <Shell>{null}</Shell>;
  }

  return <>{children}</>;
}
