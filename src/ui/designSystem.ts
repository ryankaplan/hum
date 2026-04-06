export const dsColors = {
  bg: "appBg",
  surface: "appSurface",
  surfaceSubtle: "appSurfaceSubtle",
  surfaceRaised: "appSurfaceRaised",
  text: "appText",
  textMuted: "appTextMuted",
  textSubtle: "appTextSubtle",
  border: "appBorder",
  borderMuted: "appBorderMuted",
  outline: "appOutline",
  accent: "appAccent",
  accentHover: "appAccentHover",
  accentForeground: "appAccentForeground",
  focusRing: "appFocusRing",
  errorBg: "appErrorBg",
  errorBorder: "appErrorBorder",
  errorText: "appErrorText",
  success: "appSuccess",
  warning: "appWarning",
  mediaBg: "appMediaBg",
} as const;

export const dsFocusRing =
  "0 0 0 1px var(--chakra-colors-app-focus-ring, var(--chakra-colors-appFocusRing, #4d44e3)), 0 0 0 3px color-mix(in srgb, var(--chakra-colors-app-focus-ring, var(--chakra-colors-appFocusRing, #4d44e3)) 18%, transparent)";

export const dsScreenShell = {
  minH: "100vh",
  bg: dsColors.bg,
  align: "center",
  justify: "center",
  px: 4,
  py: 6,
} as const;

export const dsPanel = {
  bg: dsColors.surface,
  border: "1px solid",
  borderColor: dsColors.border,
  borderRadius: "2xl",
  boxShadow:
    "0 10px 24px color-mix(in srgb, var(--chakra-colors-app-text, var(--chakra-colors-appText, #2e3145)) 10%, transparent)",
} as const;

export const dsInputControl = {
  bg: dsColors.surfaceSubtle,
  border: "1px solid",
  borderColor: "transparent",
  borderRadius: "xl",
  color: dsColors.text,
  _placeholder: { color: dsColors.textSubtle },
  _focus: {
    borderColor: dsColors.focusRing,
    boxShadow: dsFocusRing,
  },
} as const;

export const dsPrimaryButton = {
  borderRadius: "xl",
  bg: dsColors.accent,
  color: dsColors.accentForeground,
  _hover: { bg: dsColors.accentHover },
  _disabled: { opacity: 0.82, cursor: "default" },
} as const;

export const dsOutlineButton = {
  variant: "outline",
  borderRadius: "xl",
  borderColor: dsColors.outline,
  color: dsColors.textMuted,
  _hover: { bg: dsColors.surfaceRaised },
} as const;

export const dsErrorBanner = {
  bg: dsColors.errorBg,
  border: "1px solid",
  borderColor: dsColors.errorBorder,
  borderRadius: "md",
} as const;
