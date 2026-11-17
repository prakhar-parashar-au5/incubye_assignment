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
export type HrUserListResponse = Schemas['HrUserListResponse'];
export type HrUserDetailResponse = Schemas['HrUserDetailResponse'];
export type HrUserDetail = Schemas['HrUserDetail'];
export type HrUserView = Schemas['HrUserView'];
export type AccessAuditResponse = Schemas['AccessAuditResponse'];
export type HrAccessPreview = Schemas['HrAccessPreview'];
export type HrUserPasswordRegenerationPreview = Schemas['HrUserPasswordRegenerationPreview'];
export type HrUserCreateResult = Schemas['HrUserCreateResult'];
export type HrUserChangeResult = Schemas['HrUserChangeResult'];
export type HrUserPasswordRegenerationResult = Schemas['HrUserPasswordRegenerationResult'];
export type HrUserCreatePreviewRequest = Schemas['HrUserCreatePreviewRequest'];
export type HrUserCreateRequest = Schemas['HrUserCreateRequest'];
export type HrUserProfilePreviewRequest = Schemas['HrUserProfilePreviewRequest'];
export type HrUserProfileRequest = Schemas['HrUserProfileRequest'];
export type HrUserPromotePreviewRequest = Schemas['HrUserPromotePreviewRequest'];
export type HrUserPromoteRequest = Schemas['HrUserPromoteRequest'];
export type HrUserScopesPreviewRequest = Schemas['HrUserScopesPreviewRequest'];
export type HrUserScopesRequest = Schemas['HrUserScopesRequest'];
export type HrUserDeactivatePreviewRequest = Schemas['HrUserDeactivatePreviewRequest'];
export type HrUserDeactivateRequest = Schemas['HrUserDeactivateRequest'];
export type HrUserReactivatePreviewRequest = Schemas['HrUserReactivatePreviewRequest'];
export type HrUserReactivateRequest = Schemas['HrUserReactivateRequest'];
export type HrUserPasswordRegenerationPreviewRequest = Schemas['HrUserPasswordRegenerationPreviewRequest'];
export type HrUserPasswordRegenerationRequest = Schemas['HrUserPasswordRegenerationRequest'];

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
export const isSalaryAdjustmentPreview = compile<SalaryAdjustmentPreview>('SalaryAdjustmentPreview');
export const isSalaryAdjustmentResult = compile<SalaryAdjustmentResult>('SalaryAdjustmentResult');
export const isSalaryRequestResponse = compile<SalaryRequestResponse>('SalaryRequestResponse');
export const isSalaryRequestApproval = compile<SalaryRequestApproval>('SalaryRequestApproval');
export const isSalaryRequestList = compile<SalaryRequestList>('SalaryRequestList');
export const isDashboardSummaryResponse = compile<DashboardSummaryResponse>('DashboardSummaryResponse');
export const isDashboardBreakdownResponse = compile<DashboardBreakdownResponse>('DashboardBreakdownResponse');
export const isDashboardRecentChangesResponse = compile<DashboardRecentChangesResponse>('DashboardRecentChangesResponse');
export const isDashboardWithoutAdjustmentResponse = compile<DashboardWithoutAdjustmentResponse>('DashboardWithoutAdjustmentResponse');
export const isHrUserListResponse = compile<HrUserListResponse>('HrUserListResponse');
export const isHrUserDetailResponse = compile<HrUserDetailResponse>('HrUserDetailResponse');
export const isAccessAuditResponse = compile<AccessAuditResponse>('AccessAuditResponse');
export const isHrAccessPreview = compile<HrAccessPreview>('HrAccessPreview');
export const isHrUserPasswordRegenerationPreview = compile<HrUserPasswordRegenerationPreview>('HrUserPasswordRegenerationPreview');
export const isHrUserCreateResult = compile<HrUserCreateResult>('HrUserCreateResult');
export const isHrUserChangeResult = compile<HrUserChangeResult>('HrUserChangeResult');
export const isHrUserPasswordRegenerationResult = compile<HrUserPasswordRegenerationResult>('HrUserPasswordRegenerationResult');
export const isHrUserCreatePreviewRequest = compile<HrUserCreatePreviewRequest>('HrUserCreatePreviewRequest');
export const isHrUserCreateRequest = compile<HrUserCreateRequest>('HrUserCreateRequest');
export const isHrUserProfilePreviewRequest = compile<HrUserProfilePreviewRequest>('HrUserProfilePreviewRequest');
export const isHrUserProfileRequest = compile<HrUserProfileRequest>('HrUserProfileRequest');
export const isHrUserPromotePreviewRequest = compile<HrUserPromotePreviewRequest>('HrUserPromotePreviewRequest');
export const isHrUserPromoteRequest = compile<HrUserPromoteRequest>('HrUserPromoteRequest');
export const isHrUserScopesPreviewRequest = compile<HrUserScopesPreviewRequest>('HrUserScopesPreviewRequest');
export const isHrUserScopesRequest = compile<HrUserScopesRequest>('HrUserScopesRequest');
export const isHrUserDeactivatePreviewRequest = compile<HrUserDeactivatePreviewRequest>('HrUserDeactivatePreviewRequest');
export const isHrUserDeactivateRequest = compile<HrUserDeactivateRequest>('HrUserDeactivateRequest');
export const isHrUserReactivatePreviewRequest = compile<HrUserReactivatePreviewRequest>('HrUserReactivatePreviewRequest');
export const isHrUserReactivateRequest = compile<HrUserReactivateRequest>('HrUserReactivateRequest');
export const isHrUserPasswordRegenerationPreviewRequest = compile<HrUserPasswordRegenerationPreviewRequest>('HrUserPasswordRegenerationPreviewRequest');
export const isHrUserPasswordRegenerationRequest = compile<HrUserPasswordRegenerationRequest>('HrUserPasswordRegenerationRequest');
