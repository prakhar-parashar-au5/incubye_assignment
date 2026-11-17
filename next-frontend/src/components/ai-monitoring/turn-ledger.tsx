import type { ReactNode } from "react";

import { JsonSection } from "@/components/ai-monitoring/json-section";
import { RecordLine, StatusLabel } from "@/components/ai-monitoring/monitoring-ui";
import {
  CALL_STATUS_LABELS,
  MODEL_STATUS_LABELS,
  TRACE_STATUS_LABELS,
  VALIDATION_LABELS,
  answerText,
  buildTimeline,
  callTone,
  formatDuration,
  formatNumber,
  outcomeNotRecorded,
  outputText,
  promptText,
  stageLabel,
  type TimelineStep,
  type ToolCall,
  type TraceDetail,
} from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// The turn ledger: one ordered list of ruled steps, built from sequence numbers only. The same
// component renders the formatted view (from the server page) and the raw view (from the client,
// after the warning). In the raw view every stored value is shown as JSON and nothing is
// summarised. All text is rendered by React as text.

type Mode = "formatted" | "raw";

function StepFrame({ index, total, id, title, status, children }: { index: number; total: number; id: string; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <li id={id} className="grid scroll-mt-4 gap-x-4 border-t border-line py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <p aria-hidden="true" className="text-[0.75rem] font-semibold text-muted-foreground tabular-nums">
        Step {index}
      </p>
      <div className="flex min-w-0 flex-col gap-3">
        <h3 tabIndex={-1} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[0.875rem] font-semibold outline-none">
          <span className="sr-only">
            Step {index} of {total}:{" "}
          </span>
          <span className="break-words">{title}</span>
          {status ? <span className="text-[0.8125rem] font-normal">{status}</span> : null}
        </h3>
        {children}
      </div>
    </li>
  );
}

function Text({ children }: { children: string }) {
  return <p className="text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap">{children}</p>;
}

function toolStatusWords(call: ToolCall): { words: string; tone: "ok" | "error" | "warn" | "muted" } {
  if (outcomeNotRecorded(call.errorCategory)) return { words: "Outcome not recorded", tone: "muted" };
  return { words: CALL_STATUS_LABELS[call.status], tone: callTone(call.status) };
}

export function TurnLedger({ detail, mode }: { detail: TraceDetail; mode: Mode }) {
  const steps = buildTimeline(detail);
  const total = steps.length;
  const idPrefix = mode === "raw" ? "raw-step" : "step";
  const prompt = promptText(detail.userContent);
  const finalText = answerText(detail.finalResponse);
  const stepTitle = (step: TimelineStep): string => {
    switch (step.kind) {
      case "prompt":
        return "User prompt";
      case "model":
        return `Model call ${step.call.sequence}`;
      case "tool":
        return `Tool call ${step.call.sequence}: ${step.call.toolName}`;
      case "final":
        return "Final response";
      case "stopped":
        return "Stopped here";
      case "running":
        return "In progress";
    }
  };

  return (
    <ol aria-label={mode === "raw" ? "Turn timeline, raw data" : "Turn timeline"} className="flex flex-col">
      {steps.map((step, i) => {
        const index = i + 1;
        const id = `${idPrefix}-${index}`;
        const title = stepTitle(step);
        if (step.kind === "prompt") {
          return (
            <StepFrame key={step.key} index={index} total={total} id={id} title={title}>
              {mode === "formatted" && prompt !== null ? <Text>{prompt}</Text> : <JsonSection label="Recorded user content" value={detail.userContent} />}
              <JsonSection collapsed label="Conversation messages sent to the model" value={detail.modelMessages} />
            </StepFrame>
          );
        }
        if (step.kind === "model") {
          const call = step.call;
          const text = outputText(call.output);
          const notRecorded = outcomeNotRecorded(call.failureCategory);
          return (
            <StepFrame
              key={step.key}
              index={index}
              total={total}
              id={id}
              title={title}
              status={<StatusLabel tone={notRecorded ? "muted" : callTone(call.status)}>{notRecorded ? "Outcome not recorded" : MODEL_STATUS_LABELS[call.status]}</StatusLabel>}
            >
              <RecordLine
                items={[
                  { label: "Model", value: `${call.provider} · ${call.model}` },
                  { label: "Latency", value: formatDuration(call.latencyMs) },
                  {
                    label: "Tokens in · out · total",
                    value: `${call.inputTokens === null ? "—" : formatNumber(call.inputTokens)} · ${call.outputTokens === null ? "—" : formatNumber(call.outputTokens)} · ${call.totalTokens === null ? "—" : formatNumber(call.totalTokens)}`,
                  },
                  { label: "Reasoning tokens (count only; content is not recorded)", value: call.reasoningTokens === null ? "—" : formatNumber(call.reasoningTokens) },
                  { label: "Provider request ID", value: call.providerRequestId ?? "—" },
                ]}
              />
              {call.status === "FAILED" ? (
                <p className="text-[0.8125rem] text-destructive">
                  Model · Model call failed{call.failureCategory ? `: ${call.failureCategory}` : ""}
                </p>
              ) : null}
              <JsonSection collapsed label="Input sent to the model" value={call.input} />
              <JsonSection collapsed label="Tools offered" value={call.tools} />
              {mode === "formatted" && text !== null ? <Text>{text}</Text> : call.output !== null ? <JsonSection label="Output" value={call.output} /> : null}
              {step.tools.length === 0 && call.status === "SUCCEEDED" ? (
                <p className="text-[0.8125rem] text-muted-foreground">No tool requested.</p>
              ) : step.tools.length > 0 ? (
                <p className="text-[0.8125rem]">
                  Tool decision: {step.tools.map((tool) => `${tool.toolName}${tool.providerToolCallId ? ` (${tool.providerToolCallId})` : ""}`).join(", ")}
                </p>
              ) : null}
              {call.toolDecisions !== null && (mode === "raw" || step.tools.length > 0) ? <JsonSection collapsed label="Tool decisions" value={call.toolDecisions} /> : null}
              {call.safeError !== null ? <JsonSection label="Safe error details" value={call.safeError} /> : null}
            </StepFrame>
          );
        }
        if (step.kind === "tool") {
          const call = step.call;
          const status = toolStatusWords(call);
          return (
            <StepFrame key={step.key} index={index} total={total} id={id} title={title} status={<StatusLabel tone={status.tone}>{status.words}</StatusLabel>}>
              <RecordLine
                items={[
                  { label: "Validation", value: VALIDATION_LABELS[call.validationStatus] },
                  { label: "Execution", value: status.words },
                  { label: "Duration", value: formatDuration(call.durationMs) },
                  { label: "Requested by", value: `Model call ${call.modelCallSequence}` },
                ]}
              />
              <JsonSection label="Requested arguments" value={call.requestedArguments} />
              {call.validationErrors !== null ? <JsonSection label="Validation errors" value={call.validationErrors} /> : null}
              {call.status === "SUCCEEDED" && call.result !== null ? <JsonSection label="Result" value={call.result} /> : null}
              {call.status === "REJECTED" ? <p className="text-[0.8125rem]">Not executed: rejected by validation{call.errorCategory ? ` (${call.errorCategory})` : ""}.</p> : null}
              {call.status === "FAILED" && !outcomeNotRecorded(call.errorCategory) ? (
                <p className="text-[0.8125rem] text-destructive">Tool · Tool failed while running{call.errorCategory ? `: ${call.errorCategory}` : ""}</p>
              ) : null}
              {outcomeNotRecorded(call.errorCategory) ? <p className="text-[0.8125rem]">The outcome could not be recorded, so the assistant stopped here.</p> : null}
              {call.status === "STARTED" ? <p className="text-[0.8125rem] text-muted-foreground">Still running.</p> : null}
              {call.safeError !== null ? <JsonSection label="Safe error details" value={call.safeError} /> : null}
            </StepFrame>
          );
        }
        if (step.kind === "final") {
          return (
            <StepFrame key={step.key} index={index} total={total} id={id} title={title}>
              {mode === "formatted" && finalText !== null ? <Text>{finalText}</Text> : null}
              <JsonSection collapsed={mode === "formatted" && finalText !== null} label="Final response" value={detail.finalResponse} />
            </StepFrame>
          );
        }
        if (step.kind === "stopped") {
          return (
            <StepFrame key={step.key} index={index} total={total} id={id} title={title} status={<StatusLabel tone="error">Failed</StatusLabel>}>
              <p className={cn("text-[0.875rem] font-medium text-destructive")}>{stageLabel(detail.trace.failureStage) ?? "Failure stage not recorded"}</p>
              <RecordLine
                items={[
                  { label: "Error category", value: detail.trace.errorCategory ?? "—" },
                  { label: "Stopped at", value: detail.trace.completedAt ? formatDateTime(detail.trace.completedAt) : "—" },
                ]}
              />
              <p className="text-[0.8125rem] text-muted-foreground">No assistant answer was recorded for this turn. Every step above was saved before it stopped.</p>
            </StepFrame>
          );
        }
        return (
          <StepFrame key={step.key} index={index} total={total} id={id} title={title} status={<StatusLabel tone="muted">{TRACE_STATUS_LABELS.STARTED}</StatusLabel>}>
            <p className="text-[0.8125rem] text-muted-foreground">This turn has not finished. Reload to see later steps.</p>
          </StepFrame>
        );
      })}
    </ol>
  );
}

/** The number of the "Stopped here" step, for the header's "Go to step" link. */
export function stoppedStepIndex(detail: TraceDetail): number | null {
  const steps = buildTimeline(detail);
  const index = steps.findIndex((step) => step.kind === "stopped");
  return index === -1 ? null : index + 1;
}
