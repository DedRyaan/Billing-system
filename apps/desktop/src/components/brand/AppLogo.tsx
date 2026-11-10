// AppLogo - the Bahi mark (indigo tile, ledger with ribbon and rupee) as
// inline SVG so it renders crisply at any size with no asset request. Same
// geometry as src-tauri/icons/bahi-mark.svg, the app-icon source.
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
      <rect x="0" y="0" width="512" height="512" rx="112" fill="#4A5FE5" />
      <rect x="124" y="92" width="264" height="328" rx="30" fill="#F5F3EE" />
      <rect x="124" y="92" width="52" height="328" rx="26" fill="#DED8CA" />
      <rect x="150" y="92" width="26" height="328" fill="#DED8CA" />
      <path d="M318 92 V178 L340 160 L362 178 V92 Z" fill="#C6403C" />
      <g fill="none" stroke="#1A1A18" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M214 196 H330" />
        <path d="M214 240 H330" />
        <path d="M214 196 H252 C306 196 306 284 252 284 H222 L318 372" />
      </g>
    </svg>
  );
}
