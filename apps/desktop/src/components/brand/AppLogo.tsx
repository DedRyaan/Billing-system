// AppLogo - the Settle mark (a coin at rest on a level ledger, navy tile) as
// inline SVG so it renders crisply at any size with no asset request. Same
// geometry as src-tauri/icons/settle-mark.svg, the app-icon source.
import { APP_NAME } from "../../lib/strings/brand";

export function AppLogo({ size = 48, decorative = false }: { size?: number; decorative?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${APP_NAME} logo`}
      aria-hidden={decorative ? true : undefined}
      className="shrink-0"
    >
      <rect x="0" y="0" width="512" height="512" rx="114" fill="#1F2A44" />
      <circle cx="256" cy="192" r="56" fill="#EF9F27" />
      <rect x="136" y="264" width="240" height="44" rx="22" fill="#F5F3EE" />
      <rect x="136" y="332" width="240" height="44" rx="22" fill="#F5F3EE" />
    </svg>
  );
}
