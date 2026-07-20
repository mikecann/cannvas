import type { PropsWithChildren } from "react";

type ConfirmDialogProps = PropsWithChildren<{
  open: boolean;
  title: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}>;

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  onCancel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onCancel}>
      <section
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-symbol">!</div>
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-copy">{children}</div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel}>Keep it</button>
          <button className="button danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
