"use client";

import { OnboardingDialog } from "@/components/onboarding-dialog";

/** Client island mounted in the root layout. Renders nothing until /api/onboarding says a first sign-in is pending. */
export function OnboardingGate() {
  return <OnboardingDialog />;
}
