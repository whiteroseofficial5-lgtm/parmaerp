import * as React from 'react';
import { formulas } from '@/lib/demo-data';

export function generateStaticParams() {
  return formulas.map((f: any) => ({ id: f.id }));
}

export default function FormulaDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
