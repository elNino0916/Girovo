// The app's line icons — one family, drawn on a 24-unit grid with a 1.8 stroke,
// round caps and joins, in currentColor so an icon always takes the colour of
// the text it stands beside.
//
// Every icon is decorative (aria-hidden): meaning is carried by the visible
// label or the aria-label of the control that holds it, never by the glyph
// alone. No emoji anywhere in the interface — they render differently on every
// machine and cannot be coloured to the theme.

import type { ReactNode, SVGProps } from 'react';
import type { AvatarId } from '@/lib/avatars';
import type { CategoryId } from '@/lib/categories';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Rendered width and height in px. */
  size?: number | string;
};

const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export function Icon({
  size = 18, strokeWidth = 1.8, className, children, ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={join('shrink-0', className)}
      {...rest}
    >
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The original set. Their default sizes are kept exactly, because screens not
// yet moved to the new layout size their rows around them.
// ---------------------------------------------------------------------------

const CHEVRON = {
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
} as const;

/** Points down by default; `.chev[data-open=false]` turns it to the right. */
export function ChevronIcon({ size = 14, dir = 'down', strokeWidth = 2.1, ...rest }: IconProps & { dir?: keyof typeof CHEVRON }) {
  return <Icon size={size} strokeWidth={strokeWidth} {...rest}><path d={CHEVRON[dir]} /></Icon>;
}

export function CloseIcon({ size = 17, strokeWidth = 2, ...rest }: IconProps) {
  return <Icon size={size} strokeWidth={strokeWidth} {...rest}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
}

export function ShieldIcon({ size = 14, check = false, ...rest }: IconProps & { check?: boolean }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M12 3l7 3v5.5c0 4.4-2.9 8.1-7 9.5-4.1-1.4-7-5.1-7-9.5V6l7-3z" />
      {check && <path d="M9 12l2.1 2.1L15.2 10" />}
    </Icon>
  );
}

export function SearchIcon({ size = 16, ...rest }: IconProps) {
  return <Icon size={size} {...rest}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></Icon>;
}

/** A forward chevron (the old "arrow" — a disclosure into a list row). */
export function ArrowRightIcon({ size = 18, ...rest }: IconProps) {
  return <Icon size={size} {...rest}><path d={CHEVRON.right} /></Icon>;
}

export function ClockIcon({ size = 17, ...rest }: IconProps) {
  return <Icon size={size} {...rest}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>;
}

export function RefreshIcon({ size = 15, ...rest }: IconProps) {
  return <Icon size={size} {...rest}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></Icon>;
}

export function PowerIcon({ size = 15, ...rest }: IconProps) {
  return <Icon size={size} {...rest}><path d="M12 3v8" /><path d="M7.5 6.3a7.5 7.5 0 1 0 9 0" /></Icon>;
}

export function UserIcon({ size = 15, ...rest }: IconProps) {
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20c.7-3.7 3.7-5.8 7.2-5.8s6.5 2.1 7.2 5.8" />
    </Icon>
  );
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export function BellIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M18 16v-5a6 6 0 0 0-12 0v5l-1.5 2.5h15L18 16z" />
      <path d="M10 21a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Icon>
  );
}

export function EyeOffIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 3.5l17 17" />
      <path d="M10.4 5.7c.5-.1 1-.2 1.6-.2 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.6" />
      <path d="M6.6 7.4C4 9.2 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1.1" />
      <path d="M10 10.1a2.8 2.8 0 0 0 3.9 3.9" />
    </Icon>
  );
}

export function DownloadIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></Icon>;
}

export function UploadIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14" /></Icon>;
}

export function QrIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <path d="M13.5 13.5h3v3M20.5 13.5v.01M13.5 20.5h.01M17 20.5h3.5V17" />
    </Icon>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </Icon>
  );
}

export function CheckIcon(p: IconProps) {
  return <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
}

/** Two opposing arrows — money moving from one place to another. */
export function TransferIcon(p: IconProps) {
  return <Icon {...p}><path d="M4 8h14M14.5 4.5L18 8l-3.5 3.5M20 16H6M9.5 12.5L6 16l3.5 3.5" /></Icon>;
}

/** Echtzeit. */
export function BoltIcon(p: IconProps) {
  return <Icon {...p}><path d="M13.5 2.5L5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z" /></Icon>;
}

export function ChartIcon(p: IconProps) {
  return <Icon {...p}><path d="M4 4v15.5a.5.5 0 0 0 .5.5H20M8.5 16v-4M13 16V8M17.5 16v-6" /></Icon>;
}

export function TrendUpIcon(p: IconProps) {
  return <Icon {...p}><path d="M3.5 17.5l5.5-5.5 4 4 7.5-7.5M15 8.5h5.5V14" /></Icon>;
}

export function RepeatIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M17 3.5l3 3-3 3M4 11.5v-1a4 4 0 0 1 4-4h12" />
      <path d="M7 20.5l-3-3 3-3M20 12.5v1a4 4 0 0 1-4 4H4" />
    </Icon>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  );
}

export function FilterIcon(p: IconProps) {
  return <Icon {...p}><path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5z" /></Icon>;
}

export function TagIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-8.1 8.1a1 1 0 0 1-1.4 0l-7.4-7.4a1 1 0 0 1-.3-.7z" />
      <circle cx="8" cy="8" r="1.4" />
    </Icon>
  );
}

export function PencilIcon(p: IconProps) {
  return <Icon {...p}><path d="M15.5 4.5l4 4-11 11-5 1 1-5 11-11zM13.5 6.5l4 4" /></Icon>;
}

export function KeyboardIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
    </Icon>
  );
}

/** ⌘ — the command palette. */
export function CommandIcon(p: IconProps) {
  return <Icon {...p}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z" /></Icon>;
}

export function InfoIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" /></Icon>;
}

export function AlertTriangleIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M10.3 4.2L2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </Icon>
  );
}

export function CheckCircleIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.4l2.8 2.8L16 10" /></Icon>;
}

export function XCircleIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" /></Icon>;
}

export function HelpIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.7M12 17h.01" />
    </Icon>
  );
}

export function MailIcon(p: IconProps) {
  return <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></Icon>;
}

export function InboxIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 13.5l2.6-7.4A1.6 1.6 0 0 1 7.6 5h8.8a1.6 1.6 0 0 1 1.5 1.1l2.6 7.4" />
      <path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5l-1.5 2.5h-4l-1.5-2.5h-5z" />
    </Icon>
  );
}

export function MenuIcon(p: IconProps) {
  return <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
}

export function MoreIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function HomeIcon(p: IconProps) {
  return <Icon {...p}><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5z" /></Icon>;
}

export function WalletIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M17.5 5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9.5a1 1 0 0 0-1-1h-14a2 2 0 0 1-2-2" />
      <path d="M17.5 5v3.5" />
      <circle cx="16.5" cy="14.2" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function PiggyIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M18.5 12.5a7 5.5 0 1 1-14 0 7 5.5 0 1 1 14 0z" />
      <path d="M18.5 11h1.2a.8.8 0 0 1 .8.8v1.5a.8.8 0 0 1-.8.8h-1.3M8.5 17.4v2.1M14.5 17.4v2.1M12.6 7.2L14 4.8l1.6 2.9M4.6 11.6C3.7 11.5 3 10.8 3 10M9.5 9.3h3" />
      <circle cx="16" cy="11.2" r=".9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CardIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19M6 15h4" />
    </Icon>
  );
}

export function BuildingIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 20.5V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15.5M14.5 9.5h4a1 1 0 0 1 1 1v10M3 20.5h18" />
      <path d="M8 8h3M8 11.5h3M8 15h3" />
    </Icon>
  );
}

/** A bank or a public institution: a pediment over columns. */
export function LandmarkIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 9.2L12 4.5l8.5 4.7H3.5zM3 20.5h18M4.5 17.5h15" />
      <path d="M6.5 11.5v6M10 11.5v6M14 11.5v6M17.5 11.5v6" />
    </Icon>
  );
}

export function PlusIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function MinusIcon(p: IconProps) {
  return <Icon {...p}><path d="M5 12h14" /></Icon>;
}

/** Money going out. */
export function ArrowUpRightIcon(p: IconProps) {
  return <Icon {...p}><path d="M7 17L17 7M8.5 7H17v8.5" /></Icon>;
}

/** Money coming in. */
export function ArrowDownLeftIcon(p: IconProps) {
  return <Icon {...p}><path d="M17 7L7 17M15.5 17H7V8.5" /></Icon>;
}

export function BackIcon(p: IconProps) {
  return <Icon {...p}><path d="M19.5 12h-15M10.5 6l-6 6 6 6" /></Icon>;
}

export function ForwardIcon(p: IconProps) {
  return <Icon {...p}><path d="M4.5 12h15M13.5 6l6 6-6 6" /></Icon>;
}

/** Zurücküberweisen — sending something back the way it came. */
export function UndoIcon(p: IconProps) {
  return <Icon {...p}><path d="M9 14L4.5 9.5 9 5M4.5 9.5H15a5 5 0 0 1 0 10h-3" /></Icon>;
}

export function SunIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon(p: IconProps) {
  return <Icon {...p}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" /></Icon>;
}

export function MonitorIcon(p: IconProps) {
  return <Icon {...p}><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></Icon>;
}

/** The interface language. */
export function GlobeIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.25 12h17.5M12 3.25c2.4 2.5 3.6 5.4 3.6 8.75s-1.2 6.25-3.6 8.75c-2.4-2.5-3.6-5.4-3.6-8.75S9.6 5.75 12 3.25z" />
    </Icon>
  );
}

export function LogoutIcon(p: IconProps) {
  return <Icon {...p}><path d="M9.5 20.5h-3a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3M15.5 16.5L20 12l-4.5-4.5M20 12H9.5" /></Icon>;
}

export function ImageIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="M20.5 15.5l-4.8-4.8L5 21" />
    </Icon>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 6.5h16M9.5 6.5v-2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6 6.5l.9 12.6a1.6 1.6 0 0 0 1.6 1.4h7a1.6 1.6 0 0 0 1.6-1.4L18 6.5M10 11v5.5M14 11v5.5" />
    </Icon>
  );
}

export function StarIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" /></Icon>;
}

export function ReceiptIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5.5 3.5h13v17l-2.2-1.4-2.1 1.4-2.2-1.4-2.2 1.4-2.1-1.4-2.2 1.4v-17z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </Icon>
  );
}

/** A document — Kontoauszug, Beleg. */
export function FileIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5z" />
      <path d="M14 3.5v5h5M9 13h6M9 16.5h4" />
    </Icon>
  );
}

export function ExternalIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14 4.5h5.5V10M19.5 4.5L11 13" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </Icon>
  );
}

/** The phone a decoupled TAN is confirmed on. */
export function PhoneIcon(p: IconProps) {
  return <Icon {...p}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></Icon>;
}

export function LockIcon(p: IconProps) {
  return <Icon {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5v-3a4 4 0 0 1 8 0v3" /></Icon>;
}

// ---------------------------------------------------------------------------
// Categories and account types — pictograms for content, never for chrome.
// ---------------------------------------------------------------------------

export function BriefcaseIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
    </Icon>
  );
}

/** Money arriving into a tray — "Sonstige Eingänge". */
export function InflowIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 4v10M8 10l4 4 4-4M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></Icon>;
}

export function BasketIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.5 9.5h17l-1.6 9.1a1.5 1.5 0 0 1-1.5 1.2H6.6a1.5 1.5 0 0 1-1.5-1.2L3.5 9.5z" />
      <path d="M7.5 9.5L10 4.5M16.5 9.5L14 4.5M9.5 13v3.5M14.5 13v3.5" />
    </Icon>
  );
}

export function CarIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="11.5" width="17" height="5.5" rx="1.5" />
      <path d="M5.5 11.5l1.6-4.3a1.5 1.5 0 0 1 1.4-1h7a1.5 1.5 0 0 1 1.4 1l1.6 4.3M6.5 17v2M17.5 17v2M7 14.2h.01M17 14.2h.01" />
    </Icon>
  );
}

export function BagIcon(p: IconProps) {
  return <Icon {...p}><path d="M5.5 8h13l-1 12.5h-11L5.5 8zM9 8V6.5a3 3 0 0 1 6 0V8" /></Icon>;
}

/** Gastronomie and going out. */
export function CutleryIcon(p: IconProps) {
  return <Icon {...p}><path d="M6 3.5V8a2.5 2.5 0 0 0 5 0V3.5M8.5 3.5v17M17.5 20.5v-17c-2 1-3 3.5-3 6.5v3h3" /></Icon>;
}

export function PlayIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10 9.2v5.6l4.7-2.8L10 9.2z" />
    </Icon>
  );
}

export function HeartPulseIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      <path d="M7.5 12.5h2.2l1.3-2 2 4 1.3-2h2.2" />
    </Icon>
  );
}

export function UmbrellaIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 3.5a9 9 0 0 1 9 8.5H3a9 9 0 0 1 9-8.5zM12 12v6.5a2 2 0 0 1-4 0" /></Icon>;
}

export function PercentIcon(p: IconProps) {
  return <Icon {...p}><path d="M19 5L5 19" /><circle cx="7" cy="7" r="2.2" /><circle cx="17" cy="17" r="2.2" /></Icon>;
}

export function BanknoteIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5h.01M18 14.5h.01" />
    </Icon>
  );
}

export function PieIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12V3.5z" /><path d="M15 3.9a8.5 8.5 0 0 1 5.1 5.1H15V3.9z" /></Icon>;
}

export function DotsCircleIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth={2.4} />
    </Icon>
  );
}

const CATEGORY_ICONS: Record<CategoryId, (p: IconProps) => ReactNode> = {
  income: BriefcaseIcon,
  otherIn: InflowIcon,
  transfer: TransferIcon,
  housing: HomeIcon,
  groceries: BasketIcon,
  mobility: CarIcon,
  shopping: BagIcon,
  leisure: CutleryIcon,
  media: PlayIcon,
  health: HeartPulseIcon,
  insurance: UmbrellaIcon,
  taxes: LandmarkIcon,
  cash: BanknoteIcon,
  fees: PercentIcon,
  savings: PiggyIcon,
  other: DotsCircleIcon,
};

/** The pictogram for a booking category. Unknown ids fall back to "Sonstiges". */
export function CategoryIcon({ id, ...rest }: IconProps & { id: CategoryId }) {
  const Glyph = CATEGORY_ICONS[id] ?? DotsCircleIcon;
  return <Glyph {...rest} />;
}

export type AccountKind =
  | 'giro' | 'savings' | 'fixed' | 'securities' | 'loan' | 'card' | 'fund' | 'homeSavings' | 'insurance' | 'other';

// lib-fints names (lib/format.ts ACCOUNT_TYPES keys).
const KIND_BY_TYPE: Record<string, AccountKind> = {
  CheckingAccount: 'giro',
  SavingsAccount: 'savings',
  FixedDepositAccount: 'fixed',
  SecuritiesAccount: 'securities',
  LoanMortgageAccount: 'loan',
  CreditCardAccount: 'card',
  HomeSavingsContract: 'homeSavings',
  InsurancePolicy: 'insurance',
  InvestmentCompanyFund: 'fund',
  Miscellaneous: 'other',
};

// The numeric FinTS Kontoart (HIUPD), in decades: 1–9 Kontokorrent, 10–19
// Spar, 20–29 Festgeld, 30–39 Depot, 40–49 Darlehen, 50–59 Kreditkarte,
// 60–69 Fonds, 70–79 Bauspar, 80–89 Versicherung, 90–99 Sonstige.
const KIND_BY_DECADE: AccountKind[] = [
  'giro', 'savings', 'fixed', 'securities', 'loan', 'card', 'fund', 'homeSavings', 'insurance', 'other',
];

/**
 * What kind of account this is, for its pictogram. The product name wins
 * where it is specific — banks file a Tagesgeld under whatever Kontoart their
 * core system has, but nobody names a Girokonto "Tagesgeld Plus".
 */
export function accountKind(type: string | null | undefined, product?: string | null): AccountKind {
  const p = String(product ?? '').toLowerCase();
  if (p) {
    if (/bauspar/.test(p)) return 'homeSavings';
    if (/tagesgeld|spar|sparbuch|extra ?konto/.test(p)) return 'savings';
    if (/festgeld|termingeld/.test(p)) return 'fixed';
    if (/depot/.test(p)) return 'securities';
    if (/kreditkarte|visa|master ?card|credit ?card|\bcard\b/.test(p)) return 'card';
    if (/darlehen|kredit|baufinanz|hypothek/.test(p)) return 'loan';
    if (/giro|kontokorrent|girokonto/.test(p)) return 'giro';
  }
  const t = String(type ?? '').trim();
  if (KIND_BY_TYPE[t]) return KIND_BY_TYPE[t];
  if (/^\d{1,2}$/.test(t)) return KIND_BY_DECADE[Math.floor(Number(t) / 10)] ?? 'other';
  return 'other';
}

const ACCOUNT_ICONS: Record<AccountKind, (p: IconProps) => ReactNode> = {
  giro: WalletIcon,
  savings: PiggyIcon,
  fixed: LockIcon,
  securities: TrendUpIcon,
  loan: PercentIcon,
  card: CardIcon,
  fund: PieIcon,
  homeSavings: HomeIcon,
  insurance: UmbrellaIcon,
  other: LandmarkIcon,
};

/** The pictogram for an account, from its FinTS account type (and product name, when given). */
export function AccountTypeIcon({ type, product, ...rest }: IconProps & { type: string; product?: string | null }) {
  const Glyph = ACCOUNT_ICONS[accountKind(type, product)];
  return <Glyph {...rest} />;
}

// ---------------------------------------------------------------------------
// Profile pictures (lib/avatars.ts): what a user can put on their profile
// chip instead of their initials. The same grid, stroke and caps as the rest
// of the family, so a picture sits in the masthead like any other glyph.
// ---------------------------------------------------------------------------

const AVATAR_GLYPHS: Record<Exclude<AvatarId, 'piggy' | 'star'>, ReactNode> = {
  cat: (
    <>
      <path d="M4.6 10.4V4.8l4.1 2.8c1-.4 2.1-.6 3.3-.6s2.3.2 3.3.6l4.1-2.8v5.6c.9 1.2 1.4 2.5 1.4 3.9 0 3.6-3.9 6.2-8.8 6.2s-8.8-2.6-8.8-6.2c0-1.4.5-2.7 1.4-3.9z" />
      <circle cx="9" cy="13.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.4" r="1" fill="currentColor" stroke="none" />
      <path d="M11.1 16.2h1.8L12 17.2z" fill="currentColor" strokeWidth={1} />
    </>
  ),
  leaf: <path d="M5 19c0-8.6 5-14.1 14.5-14.5C19.5 14 14.5 19 6.5 19H5zM3.5 20.5L13 11" />,
  flower: (
    <>
      <path d="M7.5 5L10 7.5 12 4.5l2 3L16.5 5v5a4.5 4.5 0 0 1-9 0V5zM12 14.5v6.5" />
      <path d="M12 18.6c-2.5 0-4.2-1.5-4.2-3.7 2.5 0 4.2 1.5 4.2 3.7z" />
    </>
  ),
  mountain: (
    <>
      <path d="M2.5 19.5L9.2 7l4.4 8 2.6-4 5.3 8.5h-19zM7.4 10.5l1.4 1.2 1.3-1.1 1.2 1 .8-1.1" />
      <circle cx="18" cy="5.5" r="1.6" />
    </>
  ),
  wave: (
    <path d="M3 7.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 12c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 16.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" />
  ),
  coffee: (
    <path d="M4.5 10H16v4.5a4.5 4.5 0 0 1-4.5 4.5H9a4.5 4.5 0 0 1-4.5-4.5V10zM16 11.5h1.5a2.25 2.25 0 0 1 0 4.5h-1.9M8.2 3.8c-.7.8-.7 1.7 0 2.5M11.2 3.8c-.7.8-.7 1.7 0 2.5M14.2 3.8c-.7.8-.7 1.7 0 2.5" />
  ),
  music: (
    <>
      <path d="M9 17.5V5.5l10-2v12" />
      <circle cx="6.6" cy="17.5" r="2.4" />
      <circle cx="16.6" cy="15.5" r="2.4" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 2.8c3.3 2.1 4.8 5.4 4.8 9.4L15.2 16H8.8l-1.6-3.8c0-4 1.5-7.3 4.8-9.4z" />
      <circle cx="12" cy="9.3" r="1.7" />
      <path d="M7.6 12.8L5 15.4v2.8l3.4-1.6M16.4 12.8l2.6 2.6v2.8l-3.4-1.6M10.4 18.6c.3 1.3.8 2.1 1.6 2.7.8-.6 1.3-1.4 1.6-2.7" />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v13.5M8.5 10.5h7M4.5 13.5c0 4 3.4 7 7.5 7s7.5-3 7.5-7M3 15l1.5-1.5L6 15M18 15l1.5-1.5L21 15" />
    </>
  ),
};

/** A profile picture by its id (lib/avatars.ts). */
export function AvatarGlyph({ id, ...p }: IconProps & { id: AvatarId }) {
  if (id === 'piggy') return <PiggyIcon {...p} />;
  if (id === 'star') return <StarIcon {...p} />;
  return <Icon {...p}>{AVATAR_GLYPHS[id]}</Icon>;
}
