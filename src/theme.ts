import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    ":where(html, .chakra-theme)": {
      "--app-bg":
        "var(--chakra-colors-app-bg, var(--chakra-colors-appBg, #fbf8ff))",
      "--app-surface":
        "var(--chakra-colors-app-surface, var(--chakra-colors-appSurface, #f3f2ff))",
      "--app-surface-subtle":
        "var(--chakra-colors-app-surface-subtle, var(--chakra-colors-appSurfaceSubtle, #ececff))",
      "--app-text":
        "var(--chakra-colors-app-text, var(--chakra-colors-appText, #2e3145))",
      "--app-text-muted":
        "var(--chakra-colors-app-text-muted, var(--chakra-colors-appTextMuted, #5b5e74))",
      "--app-border":
        "var(--chakra-colors-app-border, var(--chakra-colors-appBorder, #dfe1fb))",
      "--app-border-muted":
        "var(--chakra-colors-app-border-muted, var(--chakra-colors-appBorderMuted, #aeb0c9))",
      "--app-accent":
        "var(--chakra-colors-app-accent, var(--chakra-colors-appAccent, #4d44e3))",
      "--app-focus-ring":
        "var(--chakra-colors-app-focus-ring, var(--chakra-colors-appFocusRing, #4d44e3))",
    },

    ".mix-slider": {
      flex: "1",
      minWidth: "0",
      appearance: "none",
      height: "4px",
      borderRadius: "2px",
      background: "var(--app-border-muted)",
      outline: "none",
      cursor: "pointer",
    },
    ".mix-slider::-webkit-slider-thumb": {
      appearance: "none",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      background: "var(--app-accent)",
      cursor: "pointer",
    },
    ".mix-slider::-moz-range-thumb": {
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      background: "var(--app-accent)",
      cursor: "pointer",
      border: "none",
    },

    ".timeline-slider": {
      width: "100%",
      appearance: "none",
      height: "4px",
      borderRadius: "999px",
      background: "var(--app-border)",
      outline: "none",
      cursor: "pointer",
    },
    ".timeline-slider::-webkit-slider-thumb": {
      appearance: "none",
      width: "13px",
      height: "13px",
      borderRadius: "50%",
      background: "var(--app-surface)",
      border: "1px solid var(--app-border-muted)",
      boxShadow: "0 1px 2px rgba(46, 49, 69, 0.24)",
      cursor: "pointer",
    },
    ".timeline-slider::-moz-range-thumb": {
      width: "13px",
      height: "13px",
      borderRadius: "50%",
      background: "var(--app-surface)",
      border: "1px solid var(--app-border-muted)",
      boxShadow: "0 1px 2px rgba(46, 49, 69, 0.24)",
      cursor: "pointer",
    },

    ".timeline-lane": {
      borderBottom: "1px solid color-mix(in srgb, var(--app-border-muted) 42%, transparent)",
      background: "transparent",
      userSelect: "none",
      touchAction: "none",
    },
    ".timeline-lane.is-alt": {
      background:
        "color-mix(in srgb, var(--app-surface-subtle) 35%, transparent)",
    },
    ".timeline-lane.is-selected-lane": {
      background: "color-mix(in srgb, var(--app-accent) 11%, transparent)",
      boxShadow:
        "inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 28%, transparent)",
    },
    ".timeline-beat": {
      position: "absolute",
      top: "0",
      bottom: "0",
      width: "1px",
      background:
        "color-mix(in srgb, var(--app-border-muted) 35%, transparent)",
      pointerEvents: "none",
    },
    ".timeline-segment": {
      position: "absolute",
      top: "9px",
      bottom: "9px",
      border:
        "1px solid color-mix(in srgb, var(--app-border-muted) 72%, transparent)",
      borderRadius: "6px",
      background:
        "color-mix(in srgb, var(--app-surface) 72%, transparent)",
      display: "flex",
      alignItems: "center",
      cursor: "grab",
      overflow: "hidden",
      isolation: "isolate",
    },
    ".timeline-segment:active": {
      cursor: "grabbing",
    },
    ".timeline-segment.is-selected": {
      borderColor: "color-mix(in srgb, var(--app-accent) 56%, transparent)",
      background: "color-mix(in srgb, var(--app-accent) 18%, transparent)",
      boxShadow:
        "0 0 0 1px color-mix(in srgb, var(--app-accent) 34%, transparent)",
    },
    ".segment-waveform": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "1px",
      width: "100%",
      height: "100%",
      padding: "0 4px",
      pointerEvents: "none",
      position: "relative",
      zIndex: "1",
    },
    ".segment-bar": {
      width: "1.5px",
      borderRadius: "999px",
      background:
        "color-mix(in srgb, var(--app-text-muted) 45%, transparent)",
      alignSelf: "center",
    },
    ".segment-volume-svg": {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "3",
    },
    ".segment-volume-line": {
      fill: "none",
      stroke: "color-mix(in srgb, var(--app-accent) 76%, white)",
      strokeWidth: "2.25",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      filter: "drop-shadow(0 0 2px color-mix(in srgb, var(--app-accent) 35%, transparent))",
    },
    ".segment-volume-brush": {
      position: "absolute",
      top: "0",
      bottom: "0",
      background:
        "color-mix(in srgb, var(--app-accent) 18%, transparent)",
      pointerEvents: "none",
      zIndex: "2",
    },
    ".timeline-playhead": {
      position: "absolute",
      top: "0",
      bottom: "0",
      width: "1px",
      marginLeft: "-0.5px",
      background: "var(--app-accent)",
      boxShadow:
        "0 0 0 1px color-mix(in srgb, var(--app-text) 35%, transparent)",
      pointerEvents: "none",
      zIndex: "10",
    },

    ".mix-slider:disabled, .timeline-slider:disabled": {
      opacity: "0.35",
      cursor: "not-allowed",
    },
  },
  theme: {
    keyframes: {
      recPulse: {
        "0%, 100%": { opacity: 1 },
        "50%": { opacity: 0.25 },
      },
    },
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
    layerStyles: {
      appScreenShell: {
        minH: "100vh",
        bg: "appBg",
      },
      appPanel: {
        bg: "appSurface",
        border: "1px solid",
        borderColor: "appBorder",
        borderRadius: "2xl",
        boxShadow:
          "0 10px 24px color-mix(in srgb, var(--app-text) 10%, transparent)",
      },
      appErrorBanner: {
        bg: "appErrorBg",
        border: "1px solid",
        borderColor: "appErrorBorder",
        borderRadius: "md",
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
