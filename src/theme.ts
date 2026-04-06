import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#f5f4ff" },
          100: { value: "#ebe9ff" },
          200: { value: "#d8d4ff" },
          300: { value: "#c2bcff" },
          400: { value: "#a39bff" },
          500: { value: "#8582ff" },
          600: { value: "#6a63f3" },
          700: { value: "#4d44e3" },
          800: { value: "#4034d7" },
          900: { value: "#2a13c5" },
        },
      },
      fonts: {
        heading: { value: "'Manrope', 'Avenir Next', 'Segoe UI', sans-serif" },
        body: { value: "'Manrope', 'Avenir Next', 'Segoe UI', sans-serif" },
      },
    },
    semanticTokens: {
      colors: {
        appBg: { value: "#fbf8ff" },
        appSurface: { value: "#f3f2ff" },
        appSurfaceSubtle: { value: "#ececff" },
        appSurfaceRaised: { value: "#e5e7fd" },
        appText: { value: "#2e3145" },
        appTextMuted: { value: "#5b5e74" },
        appTextSubtle: { value: "#767990" },
        appBorder: { value: "#dfe1fb" },
        appBorderMuted: { value: "#aeb0c9" },
        appOutline: { value: "#767990" },
        appAccent: { value: "{colors.brand.700}" },
        appAccentHover: { value: "{colors.brand.800}" },
        appAccentForeground: { value: "#faf6ff" },
        appFocusRing: { value: "{colors.brand.700}" },
        appErrorBg: { value: "#ffdde2" },
        appErrorBorder: { value: "#ff8b9a" },
        appErrorText: { value: "#782232" },
        appSuccess: { value: "#2f7a45" },
        appWarning: { value: "#9a6a1a" },
        appMediaBg: { value: "#0c0c0e" },
        "brand.solid": { value: "{colors.brand.700}" },
        "brand.muted": { value: "{colors.brand.100}" },
        "brand.text": { value: "{colors.brand.800}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
