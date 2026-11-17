// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn(), replace: vi.fn() }));
vi.mock('@/server/actions/hr-access', () => ({ previewHrAccess: mocked.preview, confirmHrAccess: mocked.confirm }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocked.replace }) }));
const { HrAccessWorkspace } = await import('@/app/hr-access/hr-access-workspace');
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const preview = {
  operation: 'CREATE', hrUserId: null, email: 'qa.hr@example.com', expectedVersion: null, changed: true,
  changedFields: ['displayName','role','status','countries','departments'], current: null,
  proposed: { displayName: 'QA HR', role: 'SCOPED', status: 'ACTIVE', countries: ['IN'], departments: ['Tech'], accessSummary: { kind:'SCOPED', text:'India + Tech', combinations:[{country:'IN',countryName:'India',department:'Tech'}] }, accessibleEmployeeCount: 12 },
  sessionsToRevoke: 0, reason: null, previewToken:'opaque-preview-token', previewExpiresAt:new Date(Date.now()+60_000).toISOString(),
};
const hrUser = { hrUserId:22, displayName:'QA HR', email:'qa.hr@example.com', role:'SCOPED', status:'ACTIVE', countries:['IN'], departments:['Tech'], accessSummary:preview.proposed.accessSummary, version:1, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), accessibleEmployeeCount:12, noAccessMessage:null };

it('marks an exact preview out of date after any form edit and requires another preview', async () => {
  mocked.preview.mockResolvedValue({ ok:true, preview });
  const user=userEvent.setup(); render(<HrAccessWorkspace operation="CREATE" />);
  await user.type(screen.getByLabelText('Display name'),'QA HR');
  await user.type(screen.getByLabelText('Email'),'qa.hr@example.com');
  await user.click(screen.getByLabelText('India'));
  await user.click(screen.getByLabelText('Tech'));
  await user.click(screen.getByRole('button',{name:'Preview change'}));
  expect((await screen.findAllByText('India + Tech')).length).toBeGreaterThan(0);
  expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('Estimated employees in access: 12') === true)).toBeVisible();
  expect(screen.getByRole('button',{name:'Create HR user'})).toBeEnabled();
  await user.type(screen.getByLabelText('Display name'),' updated');
  expect(screen.getByText('Out of date: your inputs or the current record changed. Preview again.')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Create HR user'})).not.toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Preview again'}).length).toBeGreaterThan(0);
});

it('shows a temporary password only in the one-time panel and removes it after Done', async () => {
  const userEventSetup=userEvent.setup();
  mocked.preview.mockResolvedValue({ ok:true, preview });
  mocked.confirm.mockResolvedValue({ ok:true, result:{ hrUser, temporaryPassword:'one-time-secret', credentialRecoveryRequired:false, temporaryPasswordNotice:'Share this temporary password through an approved channel. It is shown only once and no email was sent.', auditEvent:{} } });
  render(<HrAccessWorkspace operation="CREATE" />);
  await userEventSetup.type(screen.getByLabelText('Display name'),'QA HR');
  await userEventSetup.type(screen.getByLabelText('Email'),'qa.hr@example.com');
  await userEventSetup.click(screen.getByLabelText('India'));
  await userEventSetup.click(screen.getByLabelText('Tech'));
  await userEventSetup.click(screen.getByRole('button',{name:'Preview change'}));
  await userEventSetup.click(await screen.findByRole('button',{name:'Create HR user'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Temporary password, shown once'})).toBeVisible());
  expect(screen.getByLabelText('Temporary password value')).not.toHaveTextContent('one-time-secret');
  await userEventSetup.click(screen.getByRole('button',{name:'Show password'}));
  expect(screen.getByLabelText('Temporary password value')).toHaveTextContent('one-time-secret');
  await userEventSetup.click(screen.getByRole('button',{name:'Done, I have shared it'}));
  expect(mocked.replace).toHaveBeenCalledWith('/hr-access/22');
  expect(screen.queryByText('one-time-secret')).not.toBeInTheDocument();
});

it('keeps the unsaved draft after a stale confirmation and previews against the fresh version', async () => {
  const scopedPreview = { ...preview, operation: 'SCOPES', hrUserId: 22, expectedVersion: 1, current: preview.proposed, proposed: { ...preview.proposed, countries: ['IN','US'], accessSummary: { ...preview.proposed.accessSummary, text: 'India + Tech, United States + Tech' } } };
  mocked.preview.mockResolvedValue({ ok:true, preview:scopedPreview });
  mocked.confirm.mockResolvedValue({ ok:false, kind:'STALE_VERSION', current:{ ...hrUser, version:2, countries:['US'], accessSummary:{ ...hrUser.accessSummary, text:'United States + Tech' } } });
  const user=userEvent.setup();
  render(<HrAccessWorkspace operation="SCOPES" user={hrUser as never} />);
  await user.click(screen.getByRole('button',{name:'Preview change'}));
  await user.click(await screen.findByRole('button',{name:'Change scope'}));
  expect(await screen.findByText('This HR user changed while you were working')).toBeVisible();
  expect(screen.getByText(/When you started/)).toBeVisible();
  expect(screen.getByText(/United States \+ Tech · Version 2/)).toBeVisible();
  expect(screen.getByLabelText('India')).toBeChecked();
  await user.click(screen.getAllByRole('button',{name:'Preview again'}).at(-1)!);
  await waitFor(()=>expect(mocked.preview).toHaveBeenCalledTimes(2));
  expect(mocked.preview.mock.calls[1][2]).toMatchObject({ expectedVersion:2, countries:['IN'], departments:['Tech'] });
});

it('offers password regeneration after a create replay without rendering a missing password', async () => {
  mocked.preview.mockResolvedValue({ ok:true, preview });
  mocked.confirm.mockResolvedValue({ ok:true, result:{ hrUser, temporaryPassword:null, credentialRecoveryRequired:true, temporaryPasswordNotice:'This HR user already exists. The password cannot be shown again.', auditEvent:{} } });
  const user=userEvent.setup(); render(<HrAccessWorkspace operation="CREATE" />);
  await user.type(screen.getByLabelText('Display name'),'QA HR');
  await user.type(screen.getByLabelText('Email'),'qa.hr@example.com');
  await user.click(screen.getByLabelText('India'));
  await user.click(screen.getByLabelText('Tech'));
  await user.click(screen.getByRole('button',{name:'Preview change'}));
  await user.click(await screen.findByRole('button',{name:'Create HR user'}));
  expect(await screen.findByRole('heading',{name:'A temporary password is required'})).toBeVisible();
  expect(screen.getByRole('link',{name:'Regenerate temporary password'})).toHaveAttribute('href','/hr-access/22/regenerate-password');
  expect(screen.queryByLabelText('Temporary password value')).not.toBeInTheDocument();
});

// QA run 03, D4: with cacheComponents a visited route is hidden by React Activity, not unmounted.
it('starts blank after the route is hidden and shown again, and drops a late result', async () => {
  const { Activity } = await import('react');
  const Harness = ({ mode }: { mode: 'visible' | 'hidden' }) => <Activity mode={mode}><HrAccessWorkspace operation="CREATE" /></Activity>;
  mocked.preview.mockResolvedValue({ ok:true, preview });
  mocked.confirm.mockResolvedValue({ ok:true, result:{ hrUser, temporaryPassword:'one-time-secret', credentialRecoveryRequired:false, temporaryPasswordNotice:'Shown once.', auditEvent:{} } });
  const user=userEvent.setup();
  const view = render(<Harness mode="visible" />);
  await user.type(screen.getByLabelText('Display name'),'QA HR');
  await user.type(screen.getByLabelText('Email'),'qa.hr@example.com');
  await user.click(screen.getByLabelText('India'));
  await user.click(screen.getByLabelText('Tech'));
  await user.click(screen.getByRole('button',{name:'Preview change'}));
  await user.click(await screen.findByRole('button',{name:'Create HR user'}));
  await screen.findByRole('heading',{name:'Temporary password, shown once'});
  view.rerender(<Harness mode="hidden" />);
  view.rerender(<Harness mode="visible" />);
  await waitFor(()=>expect(screen.getByLabelText('Display name')).toHaveValue(''));
  expect(screen.queryByRole('heading',{name:'Temporary password, shown once'})).not.toBeInTheDocument();
  expect(screen.queryByText('one-time-secret')).not.toBeInTheDocument();
  expect(screen.queryByText(/complete$/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toHaveValue('');
  expect(screen.getByLabelText('India')).not.toBeChecked();

  // A preview that answers after the route was hidden is not shown on the next visit.
  let resolveLate: (value: unknown) => void = () => {};
  mocked.preview.mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)));
  await user.type(screen.getByLabelText('Display name'),'Late');
  await user.type(screen.getByLabelText('Email'),'late@example.com');
  await user.click(screen.getByLabelText('India'));
  await user.click(screen.getByLabelText('Tech'));
  await user.click(screen.getByRole('button',{name:'Preview change'}));
  view.rerender(<Harness mode="hidden" />);
  resolveLate({ ok:true, preview });
  view.rerender(<Harness mode="visible" />);
  await waitFor(()=>expect(screen.getByLabelText('Display name')).toHaveValue(''));
  expect(screen.getByText('Create a preview to see the exact result. Previewing writes nothing.')).toBeVisible();
  expect(screen.getByRole('button',{name:'Preview change'})).toBeInTheDocument();
});

it('resets a regenerate form to a blank reason on the next visit', async () => {
  const { Activity } = await import('react');
  const Harness = ({ mode }: { mode: 'visible' | 'hidden' }) => <Activity mode={mode}><HrAccessWorkspace operation="REGENERATE_PASSWORD" user={hrUser as never} /></Activity>;
  const user=userEvent.setup();
  const view = render(<Harness mode="visible" />);
  await user.type(screen.getByLabelText('Reason'),'Lost password');
  view.rerender(<Harness mode="hidden" />);
  view.rerender(<Harness mode="visible" />);
  await waitFor(()=>expect(screen.getByLabelText('Reason')).toHaveValue(''));
});
