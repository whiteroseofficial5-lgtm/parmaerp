'use client';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * The app's real entry point is the dashboard. A client-side redirect keeps this working
 * in the fully static export too (server `redirect()` needs a running Node server).
 */
export default function Home() {
  const router = useRouter();
  React.useEffect(() => { router.replace('/dashboard'); }, [router]);
  return null;
}
