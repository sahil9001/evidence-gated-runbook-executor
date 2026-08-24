import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Arial", "sans-serif"],
        serif: ["var(--font-instrument-serif)", "Georgia", "serif"]
      },
      colors: {
        signal: "#0284c7",
        ink: "#0b0f1a",
        paper: "#ededed",
        panel: "#eef7ff"
      },
      boxShadow: {
        soft: "0 18px 60px rgb(11 15 26 / 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
