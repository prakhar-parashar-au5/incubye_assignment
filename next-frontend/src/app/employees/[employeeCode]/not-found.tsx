import Link from "next/link";

// One page for unknown and inaccessible employees, so the response never reveals whether an
// employee outside the caller's access exists.
export default function EmployeeNotFound() {
  return (
    <main id="main" className="px-4 pt-10 pb-16 sm:px-8 lg:px-12">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Employee not found</h1>
      <p className="mt-2 max-w-xl text-[0.9375rem] text-muted-foreground">
        No employee with this ID is available to your HR account.
      </p>
      <p className="mt-6">
        <Link href="/employees" className="font-medium text-primary underline underline-offset-4">
          Back to employees
        </Link>
      </p>
    </main>
  );
}
