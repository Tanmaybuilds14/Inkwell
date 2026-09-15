import { Outfit, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { OnboardingGate } from "@/components/onboarding-gate";
import { GlobalErrorReporter } from "@/components/global-error-reporter";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata = {
  title: {
    default: "Inkwell",
    template: "%s · Inkwell",
  },
  description:
    "A self-hostable, real-time collaborative document platform — create, organize, share, and co-edit in real time.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL}
      signInFallbackRedirectUrl="/documents"
      signUpFallbackRedirectUrl="/documents"
    >
      <html
        lang="en"
        className={`${outfit.variable} ${jetbrains.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col bg-background text-foreground">
          <ThemeProvider defaultTheme="system">
            <TooltipProvider delayDuration={300}>
              <ToastProvider>
                {children}
                <OnboardingGate />
                <GlobalErrorReporter />
              </ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
