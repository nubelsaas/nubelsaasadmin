import type { Config } from 'tailwindcss';

const config: Config = {
    content: [
        './app/**/*.{js,ts,jsx,tsx,mdx}',
        './components/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: { extend: {} },
    plugins: [
        function ({ addUtilities }: { addUtilities: (u: Record<string, Record<string, string>>) => void }) {
            addUtilities({
                '.no-scrollbar': { '-ms-overflow-style': 'none', 'scrollbar-width': 'none' },
                '.no-scrollbar::-webkit-scrollbar': { display: 'none' },
            });
        },
    ],
};
export default config;
