import 'server-only';

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type { components } from '@/generated/api';
import contract from '@/generated/api-openapi.json';

// Runtime validation of backend responses. The validators are compiled from the same generated
// contract file the TypeScript types come from, so there is no second handwritten schema.

export type Schemas = components['schemas'];
export type LoginRequest = Schemas['LoginRequest'];
export type LoginResponse = Schemas['LoginResponse'];
export type CurrentUserResponse = Schemas['CurrentUserResponse'];
export type ErrorResponse = Schemas['ErrorResponse'];
export type PublicErrorCode = ErrorResponse['error']['code'];
export type DirectoryResponse = Schemas['DirectoryResponse'];
export type DirectoryRow = Schemas['DirectoryRow'];
export type SelectedCompensation = Schemas['SelectedCompensation'];
export type ExchangeRateContext = Schemas['ExchangeRateContext'];
export type EmployeeDetailResponse = Schemas['EmployeeDetailResponse'];
export type CompensationHistoryEntry = Schemas['CompensationHistoryEntry'];
export type DirectoryOptionsResponse = Schemas['DirectoryOptionsResponse'];
export type AssistantMessagesRequest = Schemas['AssistantMessagesRequest'];
export type AssistantMessagesResponse = Schemas['AssistantMessagesResponse'];
export type AssistantCard = Schemas['AssistantCard'];

const ajv = new Ajv2020({ allErrors: false, strict: false });
addFormats(ajv);

const schemas = contract.components.schemas;
// Directory schemas reference each other with `#/components/schemas/...`. Registering the
// components object as one document lets those JSON pointers resolve inside it.
ajv.addSchema({ $id: 'frontend-contract', components: { schemas } });

function compile<T>(name: keyof typeof schemas) {
  const validate = ajv.compile<T>({ $ref: `frontend-contract#/components/schemas/${name}` });
  return (value: unknown): value is T => validate(value);
}

export const isLoginResponse = compile<LoginResponse>('LoginResponse');
export const isCurrentUserResponse = compile<CurrentUserResponse>('CurrentUserResponse');
export const isErrorResponse = compile<ErrorResponse>('ErrorResponse');
export const isDirectoryResponse = compile<DirectoryResponse>('DirectoryResponse');
export const isEmployeeDetailResponse = compile<EmployeeDetailResponse>('EmployeeDetailResponse');
export const isDirectoryOptionsResponse = compile<DirectoryOptionsResponse>('DirectoryOptionsResponse');
export const isAssistantMessagesResponse = compile<AssistantMessagesResponse>('AssistantMessagesResponse');
