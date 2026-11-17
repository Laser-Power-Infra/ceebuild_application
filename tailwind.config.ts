import type { Config } from 'tailwindcss';

// Theme tokens used by the shared table kit (src/components/data-table, src/components/ui),
// copied from GMD. Values live in globals.css as RGB triplets so opacity modifiers work.
const token = (name: string) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('foreground') },
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('primary-foreground') },
      },
    },
  },
  plugins: [],
};

export default config;
