'use client';

// Form
//
// Every text field and select is M3E's outlined form field (@m3e/web
// form-field): the label floats inside the outline and rises onto it, the
// hint or the error sits in its subscript, and M3E links both to the control
// for a screen reader. A Field is one such form field around the one control
// it holds, handing it its id and invalid state through context; an Input or
// a Select without a Field brings a form field of its own, without a label
// (the caller names it with aria-label or a <label htmlFor> beside it).

import {
  Children, type ComponentProps, createContext, type CSSProperties, Fragment, isValidElement, type ReactNode,
  type Ref, type RefCallback, type RefObject, useCallback, useContext, useEffect, useId, useMemo,
} from 'react';
import { M3eCheckbox } from '@m3e/react/checkbox';
import { M3eFormField } from '@m3e/react/form-field';
import { M3eOptGroup, M3eOption } from '@m3e/react/option';
import { M3eLinearProgressIndicator } from '@m3e/react/progress-indicator';
import { M3eSelect } from '@m3e/react/select';
import { M3eSwitch } from '@m3e/react/switch';
import { useT } from '@/lib/i18n/react';
import { cx } from './shared';

type FieldWiring = {
  id: string;
  invalid: boolean;
  required: boolean;
};
const FieldContext = createContext<FieldWiring | null>(null);

function useFieldWiring(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown; invalid?: boolean }) {
  const f = useContext(FieldContext);
  const invalid = !!props.invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true' || !!f?.invalid;
  return {
    id: props.id ?? f?.id,
    'aria-describedby': props['aria-describedby'] || undefined,
    'aria-invalid': invalid || undefined,
    'aria-required': f?.required || undefined,
  };
}

/**
 * The subscript a form field shows: never one where there is nothing to say
 * (a field in a row of others must not reserve the space), and always where
 * there is — M3E would otherwise show a hint only while the field is focused.
 */
const subscript = (shown: boolean) => (shown ? 'never' : 'always');

/**
 * Inputs that draw their own empty state ("tt.mm.jjjj"): a label resting
 * inside the outline would sit on top of it, so theirs stays above the value.
 */
const OWN_EMPTY_STATE = new Set(['date', 'month', 'week', 'time', 'datetime-local']);
const drawsOwnEmptyState = (children: ReactNode) =>
  Children.toArray(children).some((child) => {
    if (!isValidElement<{ type?: unknown }>(child)) return false;
    const type = child.props.type;
    return typeof type === 'string' && OWN_EMPTY_STATE.has(type);
  });

export function Field({
  label, htmlFor, hint, error, required, optional, trailing, labelHidden, floatLabel, className, children,
}: {
  label: ReactNode;
  /** The control's id. Generated when omitted (and handed to the control). */
  htmlFor?: string;
  hint?: ReactNode;
  /** Shown under the control in red, linked via aria-describedby; marks it invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Says "(optional)" after the label — for forms where most fields are required. */
  optional?: boolean;
  /** Sits at the right end of the label row. */
  trailing?: ReactNode;
  /** Keeps the label for screen readers only. */
  labelHidden?: boolean;
  /** "always": the label stays above the value. A date, month or time Input gets it by itself (it draws its own empty state). */
  floatLabel?: 'always';
  /** Replaces the default bottom margin. */
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const auto = useId();
  const id = htmlFor ?? `field${auto}`;
  // The label floats inside the outline when it is alone on its row. A row
  // that also carries something (a counter, a link) keeps the label above
  // the field, and the field goes without one.
  const floating = !labelHidden && !trailing;
  const wiring = useMemo<FieldWiring>(
    () => ({ id, invalid: !!error, required: !!required }),
    [id, error, required],
  );
  const labelText = (
    <>
      {label}
      {optional && <span className="font-normal">{` ${t.shell.ui.optional}`}</span>}
    </>
  );

  return (
    <div className={cx('flex flex-col gap-1.5', className ?? 'mb-4')}>
      {!floating && (
        <div className={cx('flex items-baseline justify-between gap-3', labelHidden && !trailing && 'sr-only')}>
          <label htmlFor={id} className={cx('text-[13px] leading-snug font-semibold text-ink-2', labelHidden && 'sr-only')}>
            {labelText}
            {required && <span aria-hidden className="ml-0.5 text-ink-3">*</span>}
          </label>
          {trailing}
        </div>
      )}
      <M3eFormField
        variant="outlined"
        floatLabel={floatLabel ?? (drawsOwnEmptyState(children) ? 'always' : 'auto')}
        error={!!error}
        hideSubscript={subscript(!!(error || hint))}
        hideRequiredMarker={!required}
        className="w-full"
      >
        {floating && <label slot="label" htmlFor={id}>{labelText}</label>}
        <FieldContext.Provider value={wiring}>{children}</FieldContext.Provider>
        {hint && <span slot="hint">{hint}</span>}
        {error && <span slot="error">{error}</span>}
      </M3eFormField>
    </div>
  );
}

/**
 * A control inside M3E's form field: on its own a form field of its own, in
 * a Field the Field's. `slots` are the form field's other children (prefix,
 * suffix), handed over as siblings of the control, as M3E reads them.
 */
function InFormField({
  control, slots, invalid, dense, className,
}: { control: ReactNode; slots?: ReactNode; invalid: boolean; dense?: boolean; className?: string }) {
  if (useContext(FieldContext)) {
    return (
      <>
        {slots}
        {control}
      </>
    );
  }
  return (
    <M3eFormField
      variant="outlined"
      error={invalid}
      hideSubscript="always"
      className={className ?? 'w-full'}
      style={dense ? ({ '--md-sys-density-scale': '-2' } as CSSProperties) : undefined}
    >
      {slots}
      {control}
    </M3eFormField>
  );
}

/**
 * A field says what is wrong in Girovo's words — its Field's error, which M3E
 * holds as the control's custom validity. M3E's form field would also judge
 * the control by the browser's own constraints (`required`, a date's min and
 * max, which are there for its picker) on every blur and change, and show the
 * browser's sentence ("Fülle dieses Feld aus.") in red under a field nobody
 * has got wrong yet. So the control answers M3E's check with Girovo's verdict
 * alone: invalid while an error stands, else valid. Girovo's forms are
 * noValidate; nothing else asks the browser.
 */
/**
 * Focus on an M3E control that may only just have been put on the page (a
 * button that comes back when a form closes): until its first update it has
 * no tabindex, and focus() falls to <body>. `still` is asked right before, so
 * a control that has gone, or been replaced, is left alone.
 */
export function focusOnceDrawn(el: HTMLElement | null | undefined, still: () => boolean = () => true): void {
  if (!el) return;
  void Promise.resolve((el as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete).then(() => requestAnimationFrame(() => {
    if (el.isConnected && still()) el.focus({ preventScroll: true });
  }));
}

/**
 * The cursor in a field as soon as its frame has drawn it: until the M3E form
 * field's first render the input has no box and focus() does nothing. Asked
 * again whenever `when` changes; does nothing while the field isn't there.
 */
export function useFocusWhenDrawn(ref: RefObject<HTMLInputElement | null>, when?: unknown) {
  useEffect(() => {
    const frame = ref.current?.closest<HTMLElement & { updateComplete?: Promise<unknown> }>('m3e-form-field');
    if (!frame) return;
    let live = true;
    void Promise.resolve(frame.updateComplete).then(() => requestAnimationFrame(() => {
      if (live) ref.current?.focus({ preventScroll: true });
    }));
    return () => {
      live = false;
    };
  }, [ref, when]);
}

function useOwnVerdict<T extends HTMLInputElement | HTMLTextAreaElement>(ref: Ref<T> | undefined): RefCallback<T> {
  return useCallback((el: T | null) => {
    if (el) el.checkValidity = () => !el.validity.customError;
    if (typeof ref === 'function') return ref(el);
    if (ref) (ref as RefObject<T | null>).current = el;
  }, [ref]);
}

export type InputProps = ComponentProps<'input'> & {
  invalid?: boolean;
  /** Decorative mark inside the left edge (search glyph, currency). */
  leading?: ReactNode;
  /** Inside the right edge; may be interactive (a reveal toggle, a clear button). */
  trailing?: ReactNode;
  containerClassName?: string;
};

export function Input({ className, invalid, leading, trailing, containerClassName, ref, ...rest }: InputProps) {
  const wiring = useFieldWiring({ ...rest, invalid });
  const ownRef = useOwnVerdict(ref);
  return (
    <InFormField
      invalid={!!wiring['aria-invalid']}
      className={containerClassName}
      slots={(
        <>
          {leading && <span slot="prefix" aria-hidden className="flex items-center text-ink-3">{leading}</span>}
          {trailing && <span slot="suffix" className="flex items-center">{trailing}</span>}
        </>
      )}
      control={<input {...rest} {...wiring} ref={ownRef} className={className} />}
    />
  );
}

/** What a Select's onChange hands over: the chosen value, where a native select's event has it. */
export type SelectChange = { target: { value: string }; currentTarget: { value: string } };

export type SelectProps = {
  /** The m3e-select itself — what an error moves focus to. */
  ref?: Ref<HTMLElement>;
  id?: string;
  name?: string;
  value: string;
  onChange?: (e: SelectChange) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** A row's control rather than a form's field: M3E's density -2 (48px rather than 56). */
  dense?: boolean;
  /** Classes for the form field around the select (its width, its margins). */
  containerClassName?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  /**
   * <option> and <optgroup> elements, as for a native select: they become
   * M3E's options in its own menu panel.
   */
  children: ReactNode;
};

/** <option>/<optgroup> children as M3E's: m3e-option, and m3e-optgroup with its label in the label slot. */
function m3eOptions(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const props = child.props as { value?: string | number; disabled?: boolean; label?: ReactNode; children?: ReactNode };
    if (child.type === 'option') {
      return (
        <M3eOption value={props.value == null ? undefined : String(props.value)} disabled={props.disabled}>
          {props.children}
        </M3eOption>
      );
    }
    if (child.type === 'optgroup') {
      return (
        <M3eOptGroup>
          <span slot="label">{props.label}</span>
          {m3eOptions(props.children)}
        </M3eOptGroup>
      );
    }
    if (child.type === Fragment) return m3eOptions(props.children);
    return child;
  });
}

/**
 * M3E's select (@m3e/web select): an outlined form field whose list opens as
 * an M3 menu panel, never the browser's own popup — whose colours and shape
 * no theme reaches.
 */
export function Select({
  ref, id, name, value, onChange, disabled, invalid, dense, containerClassName, className, children, ...aria
}: SelectProps) {
  const wiring = useFieldWiring({ id, 'aria-describedby': aria['aria-describedby'], invalid });
  return (
    <InFormField
      invalid={!!wiring['aria-invalid']}
      dense={dense}
      className={containerClassName}
      control={(
        <M3eSelect
          ref={ref as Ref<never>}
          id={wiring.id}
          name={name}
          value={value}
          disabled={disabled}
          aria-label={aria['aria-label']}
          aria-describedby={wiring['aria-describedby']}
          aria-invalid={wiring['aria-invalid']}
          className={className}
          onChange={(e: Event) => {
            const v = String((e.currentTarget as unknown as { value: unknown }).value ?? '');
            onChange?.({ target: { value: v }, currentTarget: { value: v } });
          }}
        >
          {m3eOptions(children)}
        </M3eSelect>
      )}
    />
  );
}

export type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean; showCount?: boolean };

export function Textarea({ className, invalid, showCount, maxLength, value, ref, ...rest }: TextareaProps) {
  const wiring = useFieldWiring({ ...rest, invalid });
  const ownRef = useOwnVerdict(ref);
  const count = typeof value === 'string' ? value.length : null;
  return (
    <>
      <InFormField
        invalid={!!wiring['aria-invalid']}
        control={(
          <textarea
            {...rest}
            {...wiring}
            ref={ownRef}
            value={value}
            maxLength={maxLength}
            className={cx('block min-h-[96px] resize-y leading-[1.45]', className)}
          />
        )}
      />
      {showCount && maxLength != null && count != null && (
        <span className="tnum self-end text-[12.5px] text-ink-3" aria-hidden>
          {count}/{maxLength}
        </span>
      )}
    </>
  );
}

/** What a Checkbox's onChange hands over: the new state, where a native checkbox's event has it. */
export type CheckboxChange = { target: { checked: boolean } };

/**
 * M3E's checkbox (@m3e/web checkbox), its label and description beside it.
 * The label is a <label for> the checkbox, so a press on the words toggles
 * it too.
 */
export function Checkbox({
  label, description, className, disabled, checked, onChange, id, name,
}: {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  disabled?: boolean;
  checked: boolean;
  onChange?: (e: CheckboxChange) => void;
  id?: string;
  name?: string;
}) {
  const auto = useId();
  const boxId = id ?? `cb${auto}`;
  const descId = description ? `${boxId}-desc` : undefined;
  return (
    <span className={cx('inline-flex items-start gap-1 text-[15px] leading-snug text-ink', disabled && 'opacity-55', className)}>
      {/* The box is 18px in a 40px state layer: pulled up and in, its
          middle stays on the label's first line and its edge on the text's. */}
      <M3eCheckbox
        id={boxId}
        name={name}
        checked={checked}
        disabled={!!disabled}
        aria-describedby={descId}
        className="-my-2.5 -ml-2.5 shrink-0"
        onChange={(e: Event) => onChange?.({ target: { checked: !!(e.currentTarget as unknown as { checked: boolean }).checked } })}
      />
      <span className="min-w-0 py-px">
        <label htmlFor={boxId} className={cx('block', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>{label}</label>
        {description && <span id={descId} className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}
      </span>
    </span>
  );
}

export function Switch({
  checked, onChange, label, description, describedBy, disabled, id, className, 'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label; without it, pass aria-label — or label it with a `<label for>` of its own. */
  label?: ReactNode;
  description?: ReactNode;
  /** A description drawn elsewhere (a settings row's summary), for a switch without `label`. */
  describedBy?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const auto = useId();
  const switchId = id ?? `sw${auto}`;
  const descId = description ? `${switchId}-desc` : describedBy;
  // M3E's switch (@m3e/web switch): the M3 track and handle, the check in
  // the handle while on, the handle growing while pressed.
  const control = (
    <M3eSwitch
      id={switchId}
      icons="selected"
      checked={checked}
      disabled={!!disabled}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={descId}
      // Bare, the caller's classes are the control's own; with a label, its row's.
      className={cx('shrink-0', !label && className)}
      onChange={(e: Event) => onChange(!!(e.currentTarget as unknown as { checked: boolean }).checked)}
    />
  );
  if (!label) return control;
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <span className="min-w-0">
        <label htmlFor={switchId} className={cx('block text-[15px] leading-snug text-ink', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
        {description && <span id={descId} className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}
      </span>
      {control}
    </div>
  );
}

/**
 * How far something has got (a download): M3E's wavy linear progress
 * indicator (@m3e/web progress-indicator) — the done part a travelling wave,
 * the rest a flat track with its stop at the end.
 */
export function Progress({
  value, label, valueText, className,
}: { value: number; label: string; valueText?: string; className?: string }) {
  return (
    <M3eLinearProgressIndicator
      variant="wavy"
      value={Math.max(0, Math.min(100, value))}
      max={100}
      aria-label={label}
      aria-valuetext={valueText}
      className={cx('block w-full', className)}
    />
  );
}
