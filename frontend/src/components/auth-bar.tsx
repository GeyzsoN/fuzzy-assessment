'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function AuthBar() {
  const { user, users, loading, logout, loadUsers, switchUser, isAdminSession } =
    useAuth();

  useEffect(() => {
    if (user?.role === 'admin' || isAdminSession) {
      loadUsers().catch(() => undefined);
    }
  }, [isAdminSession, loadUsers, user?.role]);

  if (loading) {
    return <span className="text-sm text-muted-foreground">Loading...</span>;
  }

  if (!user) {
    return (
      <Button asChild size="sm">
        <Link href="/login">Login</Link>
      </Button>
    );
  }

  async function handleSwitch(userId: string) {
    await switchUser(userId);
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Badge variant="secondary">
        <UserRound />
        {user.name}
      </Badge>
      {(user.role === 'admin' || isAdminSession) && users.length > 0 && (
        <select
          aria-label="Switch user"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={user.id}
          onChange={(event) => handleSwitch(event.target.value)}
        >
          {users.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.role})
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          logout();
          window.location.href = '/login';
        }}
      >
        <LogOut />
        Logout
      </Button>
    </div>
  );
}
