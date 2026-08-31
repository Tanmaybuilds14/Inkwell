import { AppHeader } from "@/components/app-header";

export default function DocumentsLayout({ children }) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader />
      <div className="flex flex-1 bg-background">{children}</div>
    </div>
  );
}
