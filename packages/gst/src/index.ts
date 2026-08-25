// @billing/gst — zero-dependency pure GST engine public barrel.
// The complete public API: every function/type a consumer may import lives
// in this one surface. Nothing outside these modules gains exports later.
export {
  divRoundHalfUp,
  lineBasePaise,
  sumPaise,
  halfUpToRupee,
  roundOffPaise,
  parseDecimalHundredths,
  parseDecimalToPaise,
  serializePaise,
} from './money';
export type { ParseFailReason, ParseResult } from './money';
export { deriveFinancialYear } from './financial-year';
export type { CalendarDate, FyResult } from './financial-year';
export {
  CURRENT_SLABS_BPS,
  SLAB_EFFECTIVE_FROM,
  isLegalSlabRate,
  percentStringToBps,
  bpsToPercentString,
} from './rates';
export type { SlabGateResult, PercentFailReason, PercentToBpsResult } from './rates';
export {
  STATE_CODES,
  isValidStateCode,
  getStateEntry,
  secondHeadNameFor,
} from './state-codes';
export type { StateCodeEntry } from './state-codes';
export { derivePlaceOfSupply } from './place-of-supply';
export type {
  SupplyKind,
  PosInput,
  TaxHead,
  SupplyType,
  PosFailReason,
  PosResult,
} from './place-of-supply';
export { validateGstin } from './gstin';
export type { GstinFailReason, GstinResult } from './gstin';
export {
  TURNOVER_DIGIT_THRESHOLD_RUPEES,
  turnoverDigitWarning,
  validateHsnSac,
} from './hsn-sac';
export type {
  HsnSacKind,
  HsnSacFailReason,
  HsnSacResult,
  TurnoverDigitConfig,
  TurnoverDigitWarning,
} from './hsn-sac';
export {
  computeLine,
  classifyDraft,
  classifyDocument,
  gstr1FlavorFor,
  totalInvoice,
} from './invoice';
export type {
  LineCharacter,
  PricingMode,
  RegistrationType,
  LineInput,
  LineResult,
  LineOutcome,
  DocClass,
  DraftClassification,
  Gstr1Flavor,
  InvoiceTotals,
  InvoiceTotalsOutcome,
} from './invoice';
