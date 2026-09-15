import { GlobalLoadingSkeleton } from "@/components/global-loading";

/** Instant skeleton for /profile — mirrors the profile page layout (header + cards). */
export default function Loading() {
  return <GlobalLoadingSkeleton backHref={null} />;
}
