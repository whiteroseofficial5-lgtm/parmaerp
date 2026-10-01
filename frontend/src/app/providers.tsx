'use client';
import '@/lib/demo-fetch'; // serves /api/* in the fully static build (GitHub Pages preview)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import * as React from 'react';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={qc}>
        <AuthProvider>{children}<Toaster richColors position="top-right" closeButton /></AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
