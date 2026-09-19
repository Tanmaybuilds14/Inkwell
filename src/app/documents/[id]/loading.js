import { EditorLoadingSkeleton } from "@/components/global-loading";

/**
 * Route boundary while the editor chunk streams in — the same editor-shaped
 * skeleton the editor itself shows while its document fetch resolves, so the
 * transition between the two states is seamless.
 */
export default function Loading() {
  return <EditorLoadingSkeleton />;
}
