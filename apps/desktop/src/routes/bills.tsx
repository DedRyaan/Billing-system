import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { HeaderRow } from "../shell/HeaderRow";
import { PlaceholderScreen } from "./../shell/PlaceholderScreen";
import {
  PLACEHOLDER_BILLS_BODY,
  PLACEHOLDER_BILLS_TITLE,
} from "../lib/strings/shell";

// Placeholder per UI-SPEC Copywriting table (exact copy, S3 ghost). Phase 4
// replaces this with bill drafting - the shell never restructures (D-66).
function BillsPlaceholder() {
  return (
    <>
      <HeaderRow title={PLACEHOLDER_BILLS_TITLE} />
      <PlaceholderScreen
        icon={<FileText size={40} aria-hidden="true" />}
        title={PLACEHOLDER_BILLS_TITLE}
        body={PLACEHOLDER_BILLS_BODY}
      />
    </>
  );
}

export const Route = createFileRoute("/bills")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BillsPlaceholder,
});
