// The persistence port of the recorded assistant (Task 03): exactly the
// observability-repository operations a turn and the owned-conversation API
// use. Production passes the MySQL repository; fast tests pass an in-memory
// fake with fault injection (test/support/fake-assistant-store.ts).
import type { createObservabilityRepository } from './observability/repository.js';

type Repository = ReturnType<typeof createObservabilityRepository>;

export type AssistantStore = Pick<Repository,
  | 'createConversation'
  | 'listConversationSummaries'
  | 'readConversation'
  | 'findTraceByIdempotency'
  | 'createTrace'
  | 'startModelCall'
  | 'finishModelCall'
  | 'startToolCall'
  | 'finishToolCall'
  | 'finishTrace'>;
