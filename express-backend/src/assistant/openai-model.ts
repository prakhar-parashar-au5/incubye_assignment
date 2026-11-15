// OpenAI Responses API adapter (official `openai` SDK).
//
// - Function tools with strict JSON schemas; no hosted tools (no web search).
// - store: false, so OpenAI keeps no conversation state; the session replays
//   its own input list, including encrypted reasoning items, each round.
// - One SDK request timeout per call and no SDK retries: the service's
//   overall deadline bounds the whole turn.
// - SDK errors become ModelFailure categories. Provider messages and bodies
//   are never copied into the error or the log.
import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { Response, ResponseCreateParamsNonStreaming, ResponseInputItem } from 'openai/resources/responses/responses';

import { ModelFailure } from './model.js';
import type { ModelAdapter, ModelReply, ModelRequest, ModelSession, ModelToolOutput } from './model.js';

/** Default model: the current balanced model on the OpenAI models page. Override with OPENAI_MODEL. */
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 20_000;
export const MAX_OUTPUT_TOKENS = 1_500;

/** The one SDK method the adapter uses, so tests can inject a fake without network access. */
export type CreateResponse = (body: ResponseCreateParamsNonStreaming, options: { signal: AbortSignal; timeout: number; maxRetries: number }) => Promise<Response>;

export function categorizeOpenAiError(error: unknown): ModelFailure {
  if (error instanceof ModelFailure) return error;
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) return new ModelFailure('timeout');
  if (error instanceof RateLimitError) return new ModelFailure('rate_limited');
  if (error instanceof APIError) return new ModelFailure('provider_error');
  if (error instanceof Error && error.name === 'AbortError') return new ModelFailure('timeout');
  return new ModelFailure('provider_error');
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
          if (response.error) throw new ModelFailure('provider_error');
          // Keep reasoning and function_call items for the next round.
          input.push(...toResponseInputItems(response.output));
          const calls = response.output.flatMap((item) =>
            item.type === 'function_call' ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }] : []);
          if (calls.length > 0) return { kind: 'tool_calls', calls };
          const text = response.output_text.trim();
          if (text === '') throw new ModelFailure('invalid_response');
          return { kind: 'answer', text };
        },
      };
    },
  };
}
