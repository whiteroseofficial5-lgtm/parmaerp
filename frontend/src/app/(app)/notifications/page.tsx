'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Empty, PageHeader, Panel } from '@/components/ui/misc';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import { fmtDateTime, humanize } from '@/lib/utils';

export default function Notifications() {
  const router = useRouter(); const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<any>('/notifications', { query: { pageSize: 100 } }), refetchInterval: 60_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notif-count'] }); };
  const open = async (n: any) => { if (!n.readAt) { await api(`/notifications/${n.id}/read`, { method: 'POST' }); refresh(); } if (n.link) router.push(n.link); };
  return (
    <>
      <PageHeader title="Notifications" description="Low stock, reorder, expiry, QC approvals and batch releases for your role." actions={<Button variant="outline" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); refresh(); }}>Mark all read</Button>} />
      <Panel flush>{data?.data.length ? <ul className="divide-y">{data.data.map((n: any) => (
        <li key={n.id}><button onClick={() => open(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-tint/50 ${n.readAt ? 'opacity-60' : ''}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`} aria-label={n.readAt ? 'Read' : 'Unread'} />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{n.title}</span><StatusBadge status={n.severity} /><span className="text-xs text-muted-foreground">{humanize(n.type)}</span></div><p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p></div>
          <span className="num shrink-0 text-xs text-muted-foreground">{fmtDateTime(n.createdAt)}</span></button></li>))}</ul> : <Empty title="You're all caught up" hint="Alerts appear here when stock, expiry or approval thresholds are crossed." />}</Panel>
    </>
  );
}
