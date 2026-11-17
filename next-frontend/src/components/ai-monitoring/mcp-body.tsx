import { JsonSection } from "@/components/ai-monitoring/json-section";
import { RecordLine } from "@/components/ai-monitoring/monitoring-ui";
import { outcomeNotRecorded, type McpDetail } from "@/lib/ai-monitoring";

// The body of one MCP call, in either view: arguments, validation result, result, and safe error.
// There is no model call, token count, or review for MCP.

export function McpBody({ detail }: { detail: McpDetail }) {
  const call = detail.call;
  return (
    <div className="flex flex-col gap-3">
      <JsonSection label="Requested arguments" value={call.requestedArguments} />
      {call.validationErrors !== null ? <JsonSection label="Validation errors" value={call.validationErrors} /> : null}
      {call.status === "REJECTED" ? <p className="text-[0.8125rem]">Not executed: rejected by validation.</p> : null}
      {call.result !== null ? <JsonSection label="Result" value={call.result} /> : call.status === "SUCCEEDED" ? null : <p className="text-[0.8125rem] text-muted-foreground">No result was recorded.</p>}
      {call.status === "FAILED" ? (
        <RecordLine
          items={[
            { label: "Error category", value: call.errorCategory ?? "—" },
            { label: "Meaning", value: outcomeNotRecorded(call.errorCategory) ? "The outcome could not be recorded" : "Tool failed while running" },
          ]}
        />
      ) : null}
      {call.safeError !== null ? <JsonSection label="Safe error details" value={call.safeError} /> : null}
    </div>
  );
}
