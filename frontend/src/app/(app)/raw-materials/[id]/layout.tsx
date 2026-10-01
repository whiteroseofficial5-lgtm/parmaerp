import * as React from 'react';
import { rawMaterials } from '@/lib/demo-data';

export function generateStaticParams() {
  return rawMaterials.map((m: any) => ({ id: m.id }));
}

export default function RawMaterialDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
