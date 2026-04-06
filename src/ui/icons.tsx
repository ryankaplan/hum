import type { CSSProperties, SVGProps } from "react";

type AppIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  size?: number;
  color?: string;
};

function AppIcon({
  size = 16,
  color = "currentColor",
  style,
  children,
  ...props
}: AppIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{
        display: "block",
        flexShrink: 0,
        color,
        ...(style as CSSProperties | undefined),
      }}
      {...props}
    >
      {children}
    </svg>
  );
}

export function InfoIcon(props: AppIconProps) {
  return (
    <AppIcon {...props}>
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="2" />
      <circle cx="10" cy="6.2" r="1.2" fill="currentColor" />
      <path
        d="M9.15 9.2C9.15 8.73 9.53 8.35 10 8.35C10.47 8.35 10.85 8.73 10.85 9.2V13.55C10.85 14.02 10.47 14.4 10 14.4C9.53 14.4 9.15 14.02 9.15 13.55V9.2Z"
        fill="currentColor"
      />
    </AppIcon>
  );
}

export function PlayIcon(props: AppIconProps) {
  return (
    <AppIcon {...props}>
      <path
        d="M6.35 4.85C6.35 4.11 7.16 3.66 7.78 4.05L15.05 8.66C15.63 9.03 15.63 9.97 15.05 10.34L7.78 14.95C7.16 15.34 6.35 14.89 6.35 14.15V4.85Z"
        fill="currentColor"
      />
    </AppIcon>
  );
}

export function StopIcon(props: AppIconProps) {
  return (
    <AppIcon {...props}>
      <rect x="5" y="5" width="10" height="10" rx="2.6" fill="currentColor" />
    </AppIcon>
  );
}

export function VolumeOnIcon(props: AppIconProps) {
  return (
    <AppIcon {...props}>
      <path
        d="M3.5 7.4C3.5 6.9 3.9 6.5 4.4 6.5H6.8L10.35 3.8C10.94 3.35 11.8 3.77 11.8 4.52V15.48C11.8 16.23 10.94 16.65 10.35 16.2L6.8 13.5H4.4C3.9 13.5 3.5 13.1 3.5 12.6V7.4Z"
        fill="currentColor"
      />
      <path
        d="M13.55 7.2C14.9 8.21 14.9 11.79 13.55 12.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.75 5.55C18.07 7.34 18.07 12.66 15.75 14.45"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </AppIcon>
  );
}

export function VolumeOffIcon(props: AppIconProps) {
  return (
    <AppIcon {...props}>
      <path
        d="M3.5 7.4C3.5 6.9 3.9 6.5 4.4 6.5H6.8L10.35 3.8C10.94 3.35 11.8 3.77 11.8 4.52V15.48C11.8 16.23 10.94 16.65 10.35 16.2L6.8 13.5H4.4C3.9 13.5 3.5 13.1 3.5 12.6V7.4Z"
        fill="currentColor"
      />
      <path
        d="M14.05 7.05L17.2 12.95"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17.2 7.05L14.05 12.95"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </AppIcon>
  );
}
