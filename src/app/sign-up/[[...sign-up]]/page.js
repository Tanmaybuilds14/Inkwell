import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <SignUp />
    </main>
  );
}
