'use client';
import { useParams } from 'next/navigation';
import { FormulaEditor } from '@/components/formula-editor';
export default function EditFormula() { const { id } = useParams<{ id: string }>(); return <FormulaEditor formulaId={id} />; }
