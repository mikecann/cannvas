import type { PropsWithChildren } from "react";
import { DialogBackdrop } from "./DialogBackdrop";

type ConfirmDialogProps = PropsWithChildren<{
  open: boolean;
  title: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>;

// Confirmations only close through their buttons. On a wall screen a brush
// against the backdrop is more likely than a deliberate "never mind".
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <DialogBackdrop>
      <section
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="dialog-symbol">!</div>
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-copy">{children}</div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel} disabled={confirmDisabled}>Keep it</button>
          <button className="button danger" onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</button>
        </div>
      </section>
    </DialogBackdrop>
  );
}
