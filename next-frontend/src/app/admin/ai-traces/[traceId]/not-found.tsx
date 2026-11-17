import Link from "next/link";

// Unknown and deleted traces get the same page.
export default function TraceNotFound() {
  return (
    <main id="main" className="px-4 pt-10 pb-16 sm:px-8 lg:px-12">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Trace not found</h1>
      <p className="mt-2 max-w-xl text-[0.9375rem] text-muted-foreground">This trace does not exist or was deleted.</p>
      <p className="mt-6">
        <Link href="/admin/ai-traces" className="font-medium text-primary underline underline-offset-4">
          Back to AI traces
        </Link>
      </p>
    </main>
  );
}
