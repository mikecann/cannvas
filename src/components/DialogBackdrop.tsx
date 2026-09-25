import type { PropsWithChildren } from "react";

type DialogBackdropProps = PropsWithChildren<{
  className?: string;
  /**
   * Called when the dimmed area around the dialog is touched. Leave it out for
   * forms with typed input, so a stray touch on the wall can't throw it away.
   */
  onDismiss?: () => void;
}>;

export function DialogBackdrop({ className, onDismiss, children }: DialogBackdropProps) {
  return (
    <div
      className={className ? `dialog-backdrop ${className}` : "dialog-backdrop"}
      role="presentation"
      onPointerDown={(event) => {
        // Only a touch on the backdrop itself, never one inside the dialog.
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      {children}
    </div>
  );
}
