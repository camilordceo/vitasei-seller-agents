import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Tokens de marca Vitasei como placeholder (no usar marca Rentmies).
      // Se reemplazan cuando Vitasei defina su sistema visual.
      colors: {
        brand: {
          DEFAULT: "#111827",
          fg: "#f9fafb",
        },
      },
    },
  },
  plugins: [],
};

export default config;
