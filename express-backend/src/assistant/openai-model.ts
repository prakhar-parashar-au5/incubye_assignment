// OpenAI Responses API adapter (official `openai` SDK).
//
// - Function tools with strict JSON schemas; no hosted tools (no web search).
// - store: false, so OpenAI keeps no conversation state; the session replays
//   its own input list, including encrypted reasoning items, each round.
// - One SDK request timeout per call and no SDK retries: the service's
//   overall deadline bounds the whole turn.
// - SDK errors become ModelFailure categories. Provider messages and bodies
//   are never copied into the error or the log.
// - Telemetry (Task 03): the request ID from the x-request-id header (SDK
//   `_request_id` on responses, `requestID` on APIError, per the openai-node
//   README "Request IDs" section, read 2026-11-16) and the usage token counts.
//   Encrypted reasoning items stay inside this session's input list for the
//   live loop only; they are never returned through ModelReply.
import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { Response, ResponseCreateParamsNonStreaming, ResponseInputItem } from 'openai/resources/responses/responses';

import { ModelFailure } from './model.js';
import type { ModelAdapter, ModelReply, ModelRequest, ModelSession, ModelTelemetry, ModelToolOutput, ModelUsage } from './model.js';

/** Default model: the current balanced model on the OpenAI models page. Override with OPENAI_MODEL. */
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 20_000;
export const MAX_OUTPUT_TOKENS = 1_500;

/** The one SDK method the adapter uses, so tests can inject a fake without network access. */
export type CreateResponse = (body: ResponseCreateParamsNonStreaming, options: { signal: AbortSignal; timeout: number; maxRetries: number }) => Promise<Response>;

/** Provider request IDs are short opaque tokens; anything else is dropped. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,120}$/;
export function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined;
}

export function categorizeOpenAiError(error: unknown): ModelFailure {
  if (error instanceof ModelFailure) return error;
  const providerRequestId = error instanceof APIError ? safeRequestId(error.requestID) : undefined;
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) return new ModelFailure('timeout', { providerRequestId });
  if (error instanceof RateLimitError) return new ModelFailure('rate_limited', { providerRequestId });
  if (error instanceof APIError) return new ModelFailure('provider_error', { providerRequestId });
  if (error instanceof Error && error.name === 'AbortError') return new ModelFailure('timeout');
  return new ModelFailure('provider_error');
}

const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);

/** Only the allowlisted telemetry fields of a response. */
export function responseTelemetry(response: Response): ModelTelemetry {
  const usage = response.usage;
  const tokens: ModelUsage = {};
  const input = count(usage?.input_tokens);
  const output = count(usage?.output_tokens);
  const total = count(usage?.total_tokens);
  const reasoning = count(usage?.output_tokens_details?.reasoning_tokens);
  if (input !== undefined) tokens.inputTokens = input;
  if (output !== undefined) tokens.outputTokens = output;
  if (total !== undefined) tokens.totalTokens = total;
  if (reasoning !== undefined) tokens.reasoningTokens = reasoning;
  const telemetry: ModelTelemetry = { usage: tokens };
  const requestId = safeRequestId(Reflect.get(response, '_request_id'));
  if (requestId !== undefined) telemetry.providerRequestId = requestId;
  return telemetry;
}

export function createOpenAiModelAdapter({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  callTimeoutMs = DEFAULT_MODEL_CALL_TIMEOUT_MS,
  createResponse,
}: {
  apiKey: string;
  model?: string;
  callTimeoutMs?: number;
  /** Injected in tests. Defaults to the real SDK client. */
  createResponse?: CreateResponse;
}): ModelAdapter {
  const create: CreateResponse = createResponse ?? (() => {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: callTimeoutMs });
    return (body, options) => client.responses.create(body, options);
  })();

  return {
    provider: 'openai',
    model,
    open(request: ModelRequest): ModelSession {
      const input: ResponseInputItem[] = request.messages.map((m) => ({ type: 'message', role: m.role, content: m.content }));
      const tools = request.tools.map((t) => ({
        type: 'function' as const,
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: true,
      }));

      return {
        async next(toolOutputs: readonly ModelToolOutput[], signal: AbortSignal): Promise<ModelReply> {
          for (const o of toolOutputs) input.push({ type: 'function_call_output', call_id: o.callId, output: o.output });
          let response: Response;
          try {
            response = await create({
              model,
              instructions: request.instructions,
              input,
              tools,
              tool_choice: 'auto',
              parallel_tool_calls: true,
              store: false,
              include: ['reasoning.encrypted_content'],
              max_output_tokens: MAX_OUTPUT_TOKENS,
            }, { signal, timeout: callTimeoutMs, maxRetries: 0 });
          } catch (error) {
            throw categorizeOpenAiError(error);
          }
          const telemetry = responseTelemetry(response);
          if (response.error) throw new ModelFailure('provider_error', { providerRequestId: telemetry.providerRequestId });
          // Keep reasoning and function_call items for the next round (live loop only).
          input.push(...toResponseInputItems(response.output));
          const calls = response.output.flatMap((item) =>
            item.type === 'function_call' ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }] : []);
          const text = response.output_text.trim();
          if (calls.length > 0) return { kind: 'tool_calls', calls, ...(text === '' ? {} : { text }), telemetry };
          if (text === '') throw new ModelFailure('invalid_response', { providerRequestId: telemetry.providerRequestId });
          return { kind: 'answer', text, telemetry };
        },
      };
    },
  };
}
