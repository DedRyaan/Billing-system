import { CapsLockIndicator } from "../../components/ui/CapsLockIndicator";

// S1's password-field hint slot - delegates to the kit primitive so the
// "Caps Lock is on" copy has exactly ONE source.
export function CapsLockHint({ active }: { active: boolean }) {
  return <CapsLockIndicator active={active} />;
}
