'use client';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { AppShell } from '@/components/app-shell';
import { Spinner } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  React.useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  return <AppShell>{children}</AppShell>;
}
