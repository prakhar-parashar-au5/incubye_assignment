import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 pt-[16vh] pb-16">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Page not found</h1>
      <p className="mt-2 text-[0.9375rem] text-muted-foreground">This address does not match a page in ACME Compensation Manager.</p>
      <p className="mt-6">
        <Link href="/employees" className="font-medium text-primary underline underline-offset-4">
          Go to Employees
        </Link>
      </p>
    </main>
  );
}
