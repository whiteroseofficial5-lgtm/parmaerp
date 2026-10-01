import * as React from 'react';
import { batches } from '@/lib/demo-data';

export function generateStaticParams() {
  return batches.map((b: any) => ({ batchNumber: b.batchNumber }));
}

export default function TraceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
