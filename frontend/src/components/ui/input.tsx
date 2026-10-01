import * as React from 'react';
import { cn } from '@/lib/utils';

const base = 'w-full rounded border border-input bg-card px-3 text-sm placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(base, 'h-9', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(base, 'min-h-[80px] py-2', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(base, 'h-9 pr-8', className)} {...p}>{children}</select>
));
Select.displayName = 'Select';

export const Label = ({ children, className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn('field-label', className)} {...p}>{children}</label>;
