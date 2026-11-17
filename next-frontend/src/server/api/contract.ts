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
export type AssistantCard = Schemas['AssistantCard'];
export type AssistantConversationListResponse = Schemas['AssistantConversationListResponse'];
export type AssistantConversationResponse = Schemas['AssistantConversationResponse'];
export type AssistantConversationDetailResponse = Schemas['AssistantConversationDetailResponse'];
export type AssistantMessageRequest = Schemas['AssistantMessageRequest'];
export type AssistantTurnResponse = Schemas['AssistantTurnResponse'];
export type AdminTraceSummaryResponse = Schemas['AdminTraceSummaryResponse'];
export type AdminTraceOptionsResponse = Schemas['AdminTraceOptionsResponse'];
export type AdminTraceListResponse = Schemas['AdminTraceListResponse'];
export type AdminTraceDetailResponse = Schemas['AdminTraceDetailResponse'];
export type AdminTraceReviewRequest = Schemas['AdminTraceReviewRequest'];
export type AdminTraceReviewResponse = Schemas['AdminTraceReviewResponse'];
export type AdminTraceDeleteResponse = Schemas['AdminTraceDeleteResponse'];
export type AdminMcpListResponse = Schemas['AdminMcpListResponse'];
export type AdminMcpDetailResponse = Schemas['AdminMcpDetailResponse'];
export type SalaryAdjustmentCommand = Schemas['SalaryAdjustmentCommand'];
export type SalaryAdjustmentPreview = Schemas['SalaryAdjustmentPreview'];
export type SalaryAdjustmentResult = Schemas['SalaryAdjustmentResult'];
export type SalaryRequestView = Schemas['SalaryRequestView'];
export type SalaryRequestResponse = Schemas['SalaryRequestResponse'];
export type SalaryRequestApproval = Schemas['SalaryRequestApproval'];
export type SalaryRequestList = Schemas['SalaryRequestList'];
export type CompensationRecordView = Schemas['CompensationRecordView'];
export type DashboardSummaryResponse = Schemas['DashboardSummaryResponse'];
export type DashboardBreakdownResponse = Schemas['DashboardBreakdownResponse'];
export type DashboardRecentChangesResponse = Schemas['DashboardRecentChangesResponse'];
export type DashboardWithoutAdjustmentResponse = Schemas['DashboardWithoutAdjustmentResponse'];

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
export const isAssistantConversationListResponse = compile<AssistantConversationListResponse>('AssistantConversationListResponse');
export const isAssistantConversationResponse = compile<AssistantConversationResponse>('AssistantConversationResponse');
export const isAssistantConversationDetailResponse = compile<AssistantConversationDetailResponse>('AssistantConversationDetailResponse');
export const isAssistantTurnResponse = compile<AssistantTurnResponse>('AssistantTurnResponse');
export const isAdminTraceSummaryResponse = compile<AdminTraceSummaryResponse>('AdminTraceSummaryResponse');
export const isAdminTraceOptionsResponse = compile<AdminTraceOptionsResponse>('AdminTraceOptionsResponse');
export const isAdminTraceListResponse = compile<AdminTraceListResponse>('AdminTraceListResponse');
export const isAdminTraceDetailResponse = compile<AdminTraceDetailResponse>('AdminTraceDetailResponse');
export const isAdminTraceReviewResponse = compile<AdminTraceReviewResponse>('AdminTraceReviewResponse');
export const isAdminTraceDeleteResponse = compile<AdminTraceDeleteResponse>('AdminTraceDeleteResponse');
export const isAdminMcpListResponse = compile<AdminMcpListResponse>('AdminMcpListResponse');
export const isAdminMcpDetailResponse = compile<AdminMcpDetailResponse>('AdminMcpDetailResponse');
export const isSalaryAdjustmentPreview = compile<SalaryAdjustmentPreview>('SalaryAdjustmentPreview');
export const isSalaryAdjustmentResult = compile<SalaryAdjustmentResult>('SalaryAdjustmentResult');
export const isSalaryRequestResponse = compile<SalaryRequestResponse>('SalaryRequestResponse');
export const isSalaryRequestApproval = compile<SalaryRequestApproval>('SalaryRequestApproval');
export const isSalaryRequestList = compile<SalaryRequestList>('SalaryRequestList');
export const isDashboardSummaryResponse = compile<DashboardSummaryResponse>('DashboardSummaryResponse');
export const isDashboardBreakdownResponse = compile<DashboardBreakdownResponse>('DashboardBreakdownResponse');
export const isDashboardRecentChangesResponse = compile<DashboardRecentChangesResponse>('DashboardRecentChangesResponse');
export const isDashboardWithoutAdjustmentResponse = compile<DashboardWithoutAdjustmentResponse>('DashboardWithoutAdjustmentResponse');
