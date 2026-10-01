import * as React from 'react';
import { aiJobs } from '@/lib/demo-data';

export function generateStaticParams() {
  return aiJobs.map((j: any) => ({ id: j.id }));
}

export default function AiDocumentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
