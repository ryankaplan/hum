import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#f0f4ff" },
          100: { value: "#dce6fd" },
          200: { value: "#b9cdfb" },
          300: { value: "#8faff8" },
          400: { value: "#6190f4" },
          500: { value: "#3b71ef" },
          600: { value: "#2255d4" },
          700: { value: "#1a41aa" },
          800: { value: "#132e80" },
          900: { value: "#0c1e57" },
        },
      },
      fonts: {
        heading: { value: "Georgia, serif" },
        body: { value: "system-ui, sans-serif" },
      },
    },
    semanticTokens: {
      colors: {
        "brand.solid": { value: "{colors.brand.500}" },
        "brand.muted": { value: "{colors.brand.100}" },
        "brand.text": { value: "{colors.brand.700}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
