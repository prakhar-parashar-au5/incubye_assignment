// Provider-independent model interface for the assistant tool loop.
// The OpenAI adapter implements it for production; tests use a fake.
import type { JsonObjectSchema } from './tool-schemas.js';

export interface ModelToolSpec {
  name: string;
  description: string;
  parameters: JsonObjectSchema;
}

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  instructions: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolSpec[];
}

/** A function call requested by the model. `arguments` is raw, untrusted JSON text. */
export interface ModelToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ModelToolOutput {
  callId: string;
  output: string;
}

/**
 * Token counts as reported by the provider. Each field is present only when
 * the provider supplied it. `reasoningTokens` is a count only: reasoning
 * content itself never crosses this interface.
 */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

/**
 * Observability envelope for one provider call (Task 03). Only the fields the
 * trace store needs: never provider bodies, headers, or encrypted reasoning.
 */
export interface ModelTelemetry {
  providerRequestId?: string;
  usage?: ModelUsage;
}

export type ModelReply = (
  | { kind: 'tool_calls'; calls: readonly ModelToolCall[]; /** Visible text sent alongside the calls, if any. */ text?: string }
  | { kind: 'answer'; text: string }
) & { telemetry?: ModelTelemetry };

/** One conversation turn. The first next() sends the messages; later calls send tool outputs. */
export interface ModelSession {
  next(toolOutputs: readonly ModelToolOutput[], signal: AbortSignal): Promise<ModelReply>;
}

export interface ModelAdapter {
  /** Provider name recorded with every model call, e.g. "openai". */
  readonly provider: string;
  /** Model identifier recorded with every model call. */
  readonly model: string;
  open(request: ModelRequest): ModelSession;
}

export const MODEL_FAILURE_CATEGORIES = Object.freeze(['not_configured', 'timeout', 'rate_limited', 'provider_error', 'invalid_response'] as const);
export type ModelFailureCategory = (typeof MODEL_FAILURE_CATEGORIES)[number];

/** A model failure with a loggable category. Its message never contains provider response text. */
export class ModelFailure extends Error {
  readonly category: ModelFailureCategory;
  /** Provider request ID when the provider returned one with the failure. */
  readonly providerRequestId: string | undefined;

  constructor(category: ModelFailureCategory, { providerRequestId }: { providerRequestId?: string | undefined } = {}) {
    super(`model failure: ${category}`);
    this.name = 'ModelFailure';
    this.category = category;
    this.providerRequestId = providerRequestId;
  }
}
