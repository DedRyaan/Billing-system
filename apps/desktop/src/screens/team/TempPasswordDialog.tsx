// TempPasswordDialog - shows a one-time temporary password exactly once, with
// a "Copy login details" action the admin pastes into WhatsApp/SMS. The
// password is never stored client-side; closing the dialog discards it.
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { APP_NAME } from "../../lib/strings/brand";
import {
  TEMP_PASSWORD_BODY,
  TEMP_PASSWORD_COPIED,
  TEMP_PASSWORD_COPY,
  TEMP_PASSWORD_DONE,
  loginDetailsMessage,
} from "../../lib/strings/team";

export interface TempPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  name: string;
  email: string;
  password: string;
}

export function TempPasswordDialog({ open, onClose, title, name, email, password }: TempPasswordDialogProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(loginDetailsMessage({ appName: APP_NAME, name, email, password }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-[color:var(--color-scrim)]"
          style={{ zIndex: 60 }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          style={{ zIndex: 70 }}
          className="fixed left-1/2 top-1/2 w-(--width-confirm-dialog) max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-surface p-xl shadow-dialog"
        >
          <Dialog.Title className="text-heading text-ink">{title}</Dialog.Title>
          <p className="mt-sm text-body text-ink-secondary">{TEMP_PASSWORD_BODY}</p>
          <dl className="mt-md flex flex-col gap-xs rounded-lg border border-hairline bg-paper px-md py-sm">
            <div className="flex items-baseline justify-between gap-md">
              <dt className="text-caption text-ink-secondary">Email</dt>
              <dd className="truncate text-body text-ink">{email}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-md">
              <dt className="text-caption text-ink-secondary">Temporary password</dt>
              <dd data-testid="temp-password" className="select-all font-mono text-body text-ink">
                {password}
              </dd>
            </div>
          </dl>
          <div className="mt-lg flex items-center justify-end gap-sm">
            <Button
              variant="secondary"
              onClick={() => void copy()}
              leadingIcon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            >
              {copied ? TEMP_PASSWORD_COPIED : TEMP_PASSWORD_COPY}
            </Button>
            <Button variant="primary" autoFocus onClick={onClose}>
              {TEMP_PASSWORD_DONE}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
