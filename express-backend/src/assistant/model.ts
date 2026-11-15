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

export type ModelReply =
  | { kind: 'tool_calls'; calls: readonly ModelToolCall[] }
  | { kind: 'answer'; text: string };

/** One conversation turn. The first next() sends the messages; later calls send tool outputs. */
export interface ModelSession {
  next(toolOutputs: readonly ModelToolOutput[], signal: AbortSignal): Promise<ModelReply>;
}

export interface ModelAdapter {
  open(request: ModelRequest): ModelSession;
}

export const MODEL_FAILURE_CATEGORIES = Object.freeze(['not_configured', 'timeout', 'rate_limited', 'provider_error', 'invalid_response'] as const);
export type ModelFailureCategory = (typeof MODEL_FAILURE_CATEGORIES)[number];

/** A model failure with a loggable category. Its message never contains provider response text. */
export class ModelFailure extends Error {
  readonly category: ModelFailureCategory;

  constructor(category: ModelFailureCategory) {
    super(`model failure: ${category}`);
    this.name = 'ModelFailure';
    this.category = category;
  }
}
