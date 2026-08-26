// Billing form schema (plan 04-04, INV-01/INV-07/INV-08).
//
// D-47 staff discount cap: 50% max enforced at schema level and backed by
// trg_staff_discount_guard at DB level. D-45 ad-hoc lines distinguished
// by catalog_item_id=null (no stock impact at finalize).
import { z } from "zod";

export const lineItemSchema = z.object({
  /** Client-generated UUID for React key stability. */
  id: z.string(),
  /** null = ad-hoc custom line (D-45, no stock decrement). */
  catalog_item_id: z.string().uuid().nullish(),
  description: z.string().min(1, "Description is required"),
  hsn_sac: z.string().optional(),
  quantity: z.number().positive("Quantity must be positive"),
  /** Rupee amount as a number (integer paise conversion happens at the GST engine boundary). */
  unit_price: z.number().min(0, "Price cannot be negative"),
  /** Percent 0-50 (D-47 staff cap). */
  discount_pct: z.number().min(0).max(50, "Staff discount capped at 50% (D-47)"),
  /** Percent-string from CURRENT_SLABS_BPS (e.g. 18 = 18%). */
  gst_rate: z.number().min(0, "GST rate cannot be negative"),
  unit: z.string().default("nos"),
});

export const billFormSchema = z.object({
  customer_id: z.string().uuid().nullish(),
  lines: z.array(lineItemSchema).min(1, "Add at least one line item"),
});

export type LineItemDraft = z.infer<typeof lineItemSchema>;
export type BillFormData = z.infer<typeof billFormSchema>;
