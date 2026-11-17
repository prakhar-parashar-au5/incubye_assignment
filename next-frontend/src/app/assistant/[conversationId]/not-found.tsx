import Link from "next/link";

// One page for unknown and someone else's conversations, so the response never reveals whether a
// conversation that is not yours exists.
export default function ConversationNotFound() {
  return (
    <main id="main" className="px-4 pt-10 pb-16 sm:px-8 lg:px-12">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Conversation not found</h1>
      <p className="mt-2 max-w-xl text-[0.9375rem] text-muted-foreground">This conversation does not exist or is not yours.</p>
      <p className="mt-6">
        <Link href="/assistant" className="font-medium text-primary underline underline-offset-4">
          Back to the assistant
        </Link>
      </p>
    </main>
  );
}
