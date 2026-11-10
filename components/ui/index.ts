// The interface primitives. Every control in the app is built from these, so a
// focus ring, a hit area, a keyboard contract or a colour role is decided once
// here and cannot drift between screens.
//
// Conventions that hold for everything below:
// - Action blue (accent) is the only interactive colour. Navy is chrome.
// - Pills for buttons, 8px chips for filters, 6px fields, 12px tiles, 16px
//   sheets. Sentence-case labels.
// - Anything that opens on top of the page (Overlay, Menu, Popover) renders in
//   place — never portalled out of the tree — so it stays inside app/page.tsx's
//   print:hidden wrapper and never reaches paper.
// - `cx` is a plain join, not a merge: a component never relies on a caller's
//   class overriding one of its own. Where a caller needs to change spacing,
//   the component takes the margin off when a className is given.
//
// One module per family: button, form, alert, overlay (with layers, the
// focus and layer machinery under it), disclosure, tabs, chips, floating
// (Menu, Popover) and content. Screens import from here, never from a
// module directly.

export { cx } from './shared';
export { Button, CopyButton, IconButton, Spinner } from './button';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './button';
export { Checkbox, Field, Input, Progress, Select, Switch, Textarea, focusOnceDrawn, useFocusWhenDrawn } from './form';
export type { CheckboxChange, InputProps, SelectChange, SelectProps, TextareaProps } from './form';
export { Alert } from './alert';
export type { AlertTone } from './alert';
export { coarsePointer, focusFirst } from './layers';
export type { FocusFallback } from './layers';
export { Dialog, DialogActions, DialogHeader, Drawer, Overlay, Sheet, useScrollEdges, useUnpinned } from './overlay';
export type { OverlayProps } from './overlay';
export { Disclosure } from './disclosure';
export { Segmented, tabDomId, TabPanel, tabPanelDomId, Tabs } from './tabs';
export type { TabItem } from './tabs';
export { Chip, CountBadge, Dot, FilterChip, Tag } from './chips';
export type { TagTone } from './chips';
export { Menu, MenuGroup, MenuItem, MenuItemRadio, MenuLabel, MenuSeparator, Popover } from './floating';
export type { TriggerProps } from './floating';
export { DotList, EmptyState, ErrorState, Kbd, Skeleton, Tile, TileHeader } from './content';
export type { Illustration } from './content';
export type { Placement } from '@/lib/anchor';

// Re-exported so screens written against the old single-module API keep
// importing their icons from here.
export {
  ArrowRightIcon, ChevronIcon, ClockIcon, CloseIcon, PowerIcon, RefreshIcon, SearchIcon, ShieldIcon, UserIcon,
} from '../icons';
