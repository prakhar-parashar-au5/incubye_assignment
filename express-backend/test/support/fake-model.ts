// Fake model adapter: replays scripted replies and records what it was sent.
// No network access; automated tests never call OpenAI.
import type { ModelAdapter, ModelReply, ModelRequest, ModelToolOutput } from '../../src/assistant/model.js';

export interface FakeTurn {
  round: number;
  request: ModelRequest;
  outputs: readonly ModelToolOutput[];
  signal: AbortSignal;
}
export type FakeStep = (turn: FakeTurn) => ModelReply | Promise<ModelReply>;

export interface FakeModel extends ModelAdapter {
  requests: ModelRequest[];
  /** Tool outputs received per round (round 0 receives none). */
  outputsByRound: (readonly ModelToolOutput[])[];
}

/** Steps run in order; the last step repeats if the loop asks for more. */
export function scriptedModel(steps: readonly FakeStep[]): FakeModel {
  const requests: ModelRequest[] = [];
  const outputsByRound: (readonly ModelToolOutput[])[] = [];
  return {
    provider: 'fake',
    model: 'fake-model',
    requests,
    outputsByRound,
    open(request) {
      requests.push(request);
      let round = 0;
      return {
        async next(outputs, signal) {
          outputsByRound.push(outputs);
          const step = steps[Math.min(round, steps.length - 1)];
          if (step === undefined) throw new Error('fake model has no steps');
          const reply = await step({ round, request, outputs, signal });
          round += 1;
          return reply;
        },
      };
    },
  };
}

let callCounter = 0;
export const callTool = (name: string, args: unknown): ModelReply => {
  callCounter += 1;
  return { kind: 'tool_calls', calls: [{ callId: `call_${callCounter}`, name, arguments: JSON.stringify(args) }] };
};
export const rawCall = (name: string, rawArguments: string): ModelReply => {
  callCounter += 1;
  return { kind: 'tool_calls', calls: [{ callId: `call_${callCounter}`, name, arguments: rawArguments }] };
};
export const answer = (text: string): ModelReply => ({ kind: 'answer', text });

/** A model call that never settles unless aborted. */
export const hang: FakeStep = ({ signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});
