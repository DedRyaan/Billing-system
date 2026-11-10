// AddStaffSheet - admin creates a staff account directly (no email link: the
// desktop app cannot receive invite links). On success the one-time temporary
// password is handed to the parent, which shows it in TempPasswordDialog.
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStaffAccount } from "@billing/api/memberships";
import { listBusinesses, type BusinessRow } from "@billing/api/businesses";
import { keysFor } from "@billing/api/query-keys";
import { Sheet } from "../../components/ui/Sheet";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { ToggleChip } from "../../components/ui/ToggleChip";
import {
  ADD_STAFF_BUSINESSES_LABEL,
  ADD_STAFF_EMAIL_LABEL,
  ADD_STAFF_NAME_LABEL,
  ADD_STAFF_SHEET_SUBTITLE,
  ADD_STAFF_SHEET_TITLE,
  ARCHIVED_CHIP_SUFFIX,
} from "../../lib/strings/team";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreatedStaff {
  name: string;
  email: string;
  tempPassword: string;
}

export interface AddStaffSheetProps {
  open: boolean;
  onClose: () => void;
  client: SupabaseClient;
  onCreated: (created: CreatedStaff) => void;
}

export function AddStaffSheet({ open, onClose, client, onCreated }: AddStaffSheetProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [businessIds, setBusinessIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const businesses = useQuery({
    queryKey: keysFor.businesses(),
    enabled: open,
    queryFn: async () => {
      const res = await listBusinesses(client);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });
  const activeBusinesses = (businesses.data ?? []).filter((b: BusinessRow) => b.archived_at === null);

  const dirty = name !== "" || email !== "" || businessIds.size > 0;

  const toggle = (id: string) => {
    const next = new Set(businessIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusinessIds(next);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const nextErrors: typeof errors = {};
    if (trimmedName === "") nextErrors.name = "Enter their name.";
    if (!EMAIL_RE.test(trimmedEmail)) nextErrors.email = "Enter a valid email address.";
    setErrors(nextErrors);
    if (nextErrors.name !== undefined || nextErrors.email !== undefined) return;

    setSaving(true);
    const res = await createStaffAccount(client, {
      email: trimmedEmail,
      fullName: trimmedName,
      businessIds: [...businessIds],
    });
    setSaving(false);
    if (!res.ok) {
      if (/already exists/i.test(res.error.message)) setErrors({ email: res.error.message });
      else setErrors({ form: res.error.message });
      return;
    }
    setName("");
    setEmail("");
    setBusinessIds(new Set());
    setErrors({});
    onCreated({ name: trimmedName, email: trimmedEmail, tempPassword: res.data.tempPassword });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ADD_STAFF_SHEET_TITLE}
      subtitle={ADD_STAFF_SHEET_SUBTITLE}
      dirty={dirty}
      onSave={() => void submit()}
      saveDisabled={saving}
    >
      <form className="flex flex-col gap-md" onSubmit={(e) => void submit(e)} noValidate>
        <Field id="staff-name" label={ADD_STAFF_NAME_LABEL} error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="staff-email" label={ADD_STAFF_EMAIL_LABEL} error={errors.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <div role="group" aria-label={ADD_STAFF_BUSINESSES_LABEL}>
          <p className="mb-xs text-caption text-ink-secondary">{ADD_STAFF_BUSINESSES_LABEL}</p>
          <div className="flex flex-wrap gap-xs">
            {activeBusinesses.map((b) => (
              <ToggleChip
                key={b.id}
                label={`${b.legal_name}${b.archived_at !== null ? ` ${ARCHIVED_CHIP_SUFFIX}` : ""}`}
                on={businessIds.has(b.id)}
                onToggle={() => toggle(b.id)}
              />
            ))}
          </div>
          <p className="mt-xs text-caption text-ink-secondary">
            You can change this later from their Team entry.
          </p>
        </div>
        {errors.form !== undefined && (
          <p role="alert" className="text-caption text-danger">
            {errors.form}
          </p>
        )}
      </form>
    </Sheet>
  );
}
