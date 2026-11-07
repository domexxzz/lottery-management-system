import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import babelParser from "@babel/eslint-parser";

// TypeScript 7 ยังไม่รองรับใน typescript-eslint จึงใช้ Babel parser สำหรับ Syntax
// และใช้ Next plugin โดยตรงตามทางเลือก granular ในคู่มือ Next.js
export default defineConfig([
  {
    files: ["**/*.{js,mjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        requireConfigFile: false,
        babelOptions: { presets: ["@babel/preset-typescript", ["@babel/preset-react", { runtime: "automatic" }]] },
      },
    },
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
