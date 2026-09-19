import { AppHeader } from "@/components/app-header";
import { GlobalLoadingSkeleton } from "@/components/global-loading";

/** Instant skeleton for /profile — mirrors the profile page (own header + cards). */
export default function Loading() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader backHref="/documents" />
      <GlobalLoadingSkeleton />
    </div>
  );
}
