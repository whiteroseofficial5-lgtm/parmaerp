import type { Config } from 'tailwindcss';

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: hsl('background'), foreground: hsl('foreground'),
        card: hsl('card'), muted: hsl('muted'), 'muted-foreground': hsl('muted-foreground'),
        border: hsl('border'), input: hsl('input'), ring: hsl('ring'),
        primary: hsl('primary'), 'primary-foreground': hsl('primary-foreground'), tint: hsl('tint'),
        sidebar: hsl('sidebar'), 'sidebar-foreground': hsl('sidebar-foreground'), 'sidebar-muted': hsl('sidebar-muted'),
        success: hsl('success'), warning: hsl('warning'), danger: hsl('danger'),
      },
      borderRadius: { DEFAULT: '6px', md: '6px', lg: '8px' },
      fontFamily: { sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'], mono: ['var(--font-mono)', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config;
