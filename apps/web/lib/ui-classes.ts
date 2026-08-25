// Small shared class strings rather than a full component library — this is a solo portfolio app,
// not a design system product; consistency matters more than abstraction here.
export const inputClass =
  "w-full rounded-control border border-text-muted/30 bg-bg-surface px-3 py-2 text-base text-text-primary outline-none transition focus:border-accent-primary motion-reduce:transition-none";

export const primaryButtonClass =
  "w-full rounded-control bg-accent-primary px-4 py-2 text-base font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const secondaryButtonClass =
  "w-full rounded-control border border-text-muted/30 px-4 py-2 text-base font-medium text-text-primary transition hover:bg-bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

// Same visual treatment as the two above but without w-full — for a button sitting inline next to
// an input (composer, "New chat" add-participant row). Appending "w-auto" to the classes above
// doesn't reliably override their baked-in w-full: both are same-specificity utility classes, so
// which one wins depends on Tailwind's generated stylesheet order, not className string order —
// the button ended up winning w-full, which squeezed its sibling input down to almost nothing.
export const primaryButtonCompactClass =
  "shrink-0 rounded-control bg-accent-primary px-4 py-2 text-base font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const secondaryButtonCompactClass =
  "shrink-0 rounded-control border border-text-muted/30 px-4 py-2 text-base font-medium text-text-primary transition hover:bg-bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const linkClass = "text-accent-primary underline underline-offset-2";

export const errorTextClass = "text-sm text-status-error";

export const cardClass = "rounded-bubble border border-text-muted/20 bg-bg-surface p-4";
