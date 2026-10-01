import * as React from 'react';
import { qcSamples } from '@/lib/demo-data';

export function generateStaticParams() {
  return qcSamples.map((s: any) => ({ id: s.id }));
}

export default function QcDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
