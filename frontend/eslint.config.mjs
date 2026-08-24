import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "out/**"]
  },
  ...nextVitals,
  ...nextTypeScript
];

export default eslintConfig;
