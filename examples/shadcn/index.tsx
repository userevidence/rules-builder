import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

/**
 * A small set of shadcn-style primitives (native elements + Tailwind), mirroring
 * the API of @template/ui so the rule-builder drop-in renderer is a near find-and-
 * replace away from the real product components.
 */

export type Option = { value: string; label: string; disabled?: boolean };

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export const Select = ({
  className,
  options,
  value,
  onChange,
  placeholder,
  ...props
}: SelectProps) => (
  <select
    className={cn(
      'h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    {...props}
  >
    {placeholder !== undefined && (
      <option value="" disabled>
        {placeholder}
      </option>
    )}
    {options.map((o) => (
      <option key={o.value} value={o.value} disabled={o.disabled}>
        {o.label}
      </option>
    ))}
  </select>
);

type MultiSelectProps = Omit<SelectProps, 'value' | 'onChange'> & {
  value: string[];
  onChange: (value: string[]) => void;
};

export const MultiSelect = ({
  className,
  options,
  value,
  onChange,
  ...props
}: MultiSelectProps) => (
  <select
    multiple
    className={cn(
      'min-h-7 rounded-md border border-input bg-background px-2 py-0.5 text-xs shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    value={value}
    onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
    {...props}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className, ...props }: InputProps) => (
  <input
    className={cn(
      'h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm',
      'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
);

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
      },
      size: { sm: 'h-7 px-2', md: 'h-8 px-3', icon: 'h-6 w-6' },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = ({ className, variant, size, type = 'button', ...props }: ButtonProps) => (
  <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
);

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        muted: 'border-transparent bg-muted text-muted-foreground',
        accent: 'border-transparent bg-accent text-accent-foreground',
        ok: 'border-transparent bg-emerald-100 text-emerald-700',
        danger: 'border-transparent bg-red-100 text-red-700',
      },
    },
    defaultVariants: { tone: 'muted' },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export const Badge = ({ className, tone, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ tone }), className)} {...props} />
);

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('rounded-lg border border-border bg-background p-2.5 shadow-sm', className)}
    {...props}
  />
);
