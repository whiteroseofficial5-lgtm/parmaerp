'use client';
import { useQuery } from '@tanstack/react-query';
import { Bell, LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { cn, humanize } from '@/lib/utils';
import { DemoBanner } from './demo-banner';
import { ScanBox } from './scanner';
import { Button } from './ui/button';

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const path = usePathname();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden><rect width="26" height="26" rx="6" fill="hsl(213 88% 45%)" /><path d="M8 8h6.5a3.5 3.5 0 010 7H11v3H8V8zm3 2.5v2h3a1 1 0 000-2h-3z" fill="#fff" /></svg>
        <div className="leading-tight"><div className="text-sm font-semibold">PharmaERP</div><div className="text-[0.6875rem] text-sidebar-muted">Meridian Life Sciences</div></div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4 pt-2" aria-label="Main">
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="px-2 pb-1 text-[0.75rem] text-sidebar-muted">{g.title}</div>
              {items.map((i) => {
                const active = path === i.href || path.startsWith(i.href + '/');
                return (
                  <Link key={i.href} href={i.href} onClick={onNavigate} className={cn('flex items-center gap-2.5 rounded px-2 py-1.5 text-[0.875rem] transition-colors', active ? 'bg-white/12 font-medium text-white' : 'text-sidebar-foreground/80 hover:bg-white/8')} aria-current={active ? 'page' : undefined}>
                    <i.icon className="h-4 w-4 shrink-0" />{i.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { data: unread } = useQuery({ queryKey: ['notif-count'], queryFn: () => api<{ unread: number }>('/notifications/count'), refetchInterval: 60_000, enabled: !!user });

  return (
    <div className="min-h-screen lg:pl-60">
      <DemoBanner />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64"><Sidebar onNavigate={() => setOpen(false)} /><button className="absolute right-2 top-3 text-white/80" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:px-5">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
        <ScanBox />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="relative" onClick={() => router.push('/notifications')} aria-label={`Notifications${unread?.unread ? `, ${unread.unread} unread` : ''}`}>
            <Bell className="h-4 w-4" />
            {!!unread?.unread && <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-semibold text-white">{unread.unread > 99 ? '99+' : unread.unread}</span>}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle dark mode"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></Button>
          <div className="mx-2 hidden h-6 w-px bg-border sm:block" />
          <div className="hidden text-right leading-tight sm:block"><div className="text-[0.8125rem] font-medium">{user?.name}</div><div className="text-[0.6875rem] text-muted-foreground">{humanize(user?.role)}</div></div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</main>
    </div>
  );
}
