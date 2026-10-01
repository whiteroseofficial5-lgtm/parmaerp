import * as React from 'react';
import { batches } from '@/lib/demo-data';

// The demo pages fetch their data in the browser, but a static export still has to know
// the dynamic paths up front. They all come from the same demo dataset the app shows.
export function generateStaticParams() {
  return batches.map((b: any) => ({ id: b.id }));
}

export default function BatchDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
