import { GlobalLoading } from "@/components/global-loading";

/**
 * Root loading state (app/loading.js convention). Covers the landing page
 * and any route segment without its own loading.js.
 */
export default function Loading() {
  return <GlobalLoading />;
}
