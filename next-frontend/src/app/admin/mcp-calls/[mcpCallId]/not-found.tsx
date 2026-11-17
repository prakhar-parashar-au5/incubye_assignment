import Link from "next/link";

export default function McpCallNotFound() {
  return (
    <main id="main" className="px-4 pt-10 pb-16 sm:px-8 lg:px-12">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">MCP call not found</h1>
      <p className="mt-2 max-w-xl text-[0.9375rem] text-muted-foreground">This MCP call does not exist or was removed.</p>
      <p className="mt-6">
        <Link href="/admin/mcp-calls" className="font-medium text-primary underline underline-offset-4">
          Back to MCP calls
        </Link>
      </p>
    </main>
  );
}
