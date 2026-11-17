"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { countryName, roleLabel, scopeCrossProduct, statusLabel } from '@/lib/hr-access';
import type { HrAccessOperation, ConfirmOutcome, PreviewOutcome } from '@/server/actions/hr-access';
import { confirmHrAccess, previewHrAccess } from '@/server/actions/hr-access';
import type { HrAccessPreview, HrUserDetail, HrUserPasswordRegenerationPreview } from '@/server/api/contract';

type Props = { operation: HrAccessOperation; user?: HrUserDetail; self?: boolean };
type Draft = { displayName: string; email: string; role: 'ADMIN'|'SCOPED'; countries: string[]; departments: string[]; reason: string };
type Preview = HrAccessPreview | HrUserPasswordRegenerationPreview;
type PreviewRecord = NonNullable<HrAccessPreview['current']>;
type Credential = { value: string; notice: string; recovery: boolean; hrUser: HrUserDetail };
const countryOptions = [{ code: 'IN', name: 'India' }, { code: 'US', name: 'United States' }];
const departmentOptions = ['Tech', 'HR', 'Finance', 'Operations', 'Support'];
const labels: Record<HrAccessOperation,string> = { CREATE:'Create HR user', PROFILE:'Change display name', PROMOTE:'Promote to Admin HR', SCOPES:'Change scope', DEACTIVATE:'Deactivate access', REACTIVATE:'Reactivate access', REGENERATE_PASSWORD:'Regenerate temporary password' };
const reasons: Record<string,string> = { STALE_VERSION:'This HR user changed while you were working. Review the current state, then preview again.', DUPLICATE_OPERATION:'This action was already submitted with different details. Reload to see the current state.', LAST_ACTIVE_ADMIN:'You cannot deactivate the last active Admin HR user. Activate or create another Admin first.', EMAIL_TAKEN:'An HR user with this email already exists.', INVALID_SCOPE:'Review the country and department scopes.', SELF_PASSWORD_REGENERATION_FORBIDDEN:'Ask another active Admin HR user to regenerate your temporary password.', PREVIEW_EXPIRED:'This preview has expired. Preview again.', PREVIEW_INVALID:'This preview is no longer valid. Preview again.', PREVIEW_MISMATCH:'The submitted details do not match this preview. Preview again.', SERVICE_UNAVAILABLE:'The service is temporarily unavailable. Try again.', UNAVAILABLE:'The service did not respond. Try again.', TIMEOUT:'The request took too long. Check again before starting another operation.', UNAUTHENTICATED:'Your session ended. Sign in again.', FORBIDDEN:'HR Access is available to Admin HR only.', INVALID_INPUT:'Review the required fields and try again.', VALIDATION_ERROR:'Review the required fields and try again.' };

export function HrAccessWorkspace({ operation, user, self = false }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ displayName: user?.displayName ?? '', email: '', role: 'SCOPED', countries: [...(user?.countries ?? [])], departments: [...(user?.departments ?? [])], reason: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, setPreviewState] = useState<'ready'|'stale'|'expired'|null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HrUserDetail | null>(null);
  const [saved, setSaved] = useState<HrUserDetail | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [copied, setCopied] = useState<string>('');
  const [revealPassword, setRevealPassword] = useState(false);
  const isCreate = operation === 'CREATE';

  useEffect(() => {
    if (!preview || previewState !== 'ready') return;
    const expires = new Date(preview.previewExpiresAt).getTime();
    const timer = window.setTimeout(() => setPreviewState('expired'), Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview, previewState]);
  useEffect(() => {
    if (!credential) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const onBack = () => { setCredential(null); router.replace(`/hr-access/${credential.hrUser.hrUserId}`); };
    window.addEventListener('beforeunload', guard);
    window.addEventListener('popstate', onBack);
    return () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('popstate', onBack); };
  }, [credential, router]);

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((old) => ({ ...old, [field]: value }));
    if (preview) setPreviewState('stale');
    setError(null); setSaved(null);
  }
  function toggle(field: 'countries'|'departments', value: string) {
    const next = draft[field].includes(value) ? draft[field].filter((item) => item !== value) : [...draft[field], value];
    update(field, next);
  }
  function body(withToken = false): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    if (operation === 'CREATE') Object.assign(base, { displayName: draft.displayName.trim(), email: draft.email.trim(), role: draft.role, countries: draft.role === 'ADMIN' ? [] : draft.countries, departments: draft.role === 'ADMIN' ? [] : draft.departments });
    else {
      base.expectedVersion = current?.version ?? user?.version;
      if (operation === 'PROFILE') base.displayName = draft.displayName.trim();
      if (operation === 'SCOPES') Object.assign(base, { countries: draft.countries, departments: draft.departments });
      if (['DEACTIVATE','REACTIVATE','REGENERATE_PASSWORD'].includes(operation)) base.reason = draft.reason.trim();
    }
    if (withToken && preview) base.previewToken = preview.previewToken;
    return base;
  }
  async function runPreview() {
    setBusy(true); setError(null); setSaved(null); setCredential(null);
    const outcome: PreviewOutcome = await previewHrAccess(operation, user?.hrUserId ?? null, body());
    setBusy(false);
    if (!outcome.ok) { setPreview(null); setPreviewState(null); setError(reasons[outcome.kind] ?? 'The preview could not be created.'); return; }
    setPreview(outcome.preview); setPreviewState('ready'); setKey(crypto.randomUUID()); setCurrent(null);
    requestAnimationFrame(() => document.getElementById('preview-heading')?.focus());
  }
  async function confirm() {
    if (!preview || previewState !== 'ready' || !key) return;
    setBusy(true); setError(null);
    const outcome: ConfirmOutcome = await confirmHrAccess({ operation, targetId: user?.hrUserId ?? null, body: body(true), idempotencyKey: key });
    setBusy(false);
    if (!outcome.ok) {
      if (outcome.kind === 'STALE_VERSION') { setCurrent(outcome.current ?? null); setPreviewState('stale'); setError(reasons.STALE_VERSION); requestAnimationFrame(() => document.getElementById('action-alert')?.focus()); return; }
      if (['UNAVAILABLE','TIMEOUT','SERVICE_UNAVAILABLE'].includes(outcome.kind)) { setError('We could not confirm whether this was saved. Nothing is shown as changed. Check again reusing this key, or view the current record.'); return; }
      setPreviewState(['PREVIEW_EXPIRED','PREVIEW_INVALID','PREVIEW_MISMATCH'].includes(outcome.kind) ? 'expired' : null);
      setError(reasons[outcome.kind] ?? 'The change could not be confirmed.'); return;
    }
    const result = outcome.result;
    if ('credentialRecoveryRequired' in result) {
      setCredential({ value: result.temporaryPassword ?? '', notice: result.temporaryPasswordNotice, recovery: result.credentialRecoveryRequired, hrUser: result.hrUser });
      setSaved(result.hrUser); setPreview(null); setPreviewState(null);
      requestAnimationFrame(() => document.getElementById('credential-heading')?.focus());
    } else {
      setPreview(null); setPreviewState(null);
      if (result.changed) router.replace(`/hr-access/${result.hrUser.hrUserId}`);
      else { setSaved(result.hrUser); requestAnimationFrame(() => document.getElementById('saved-heading')?.focus()); }
    }
  }
  async function copyPassword() {
    if (!credential?.value) return;
    try { await navigator.clipboard.writeText(credential.value); setCopied('Temporary password copied.'); }
    catch { setCopied('Copy was unavailable. Select the password and copy it manually.'); }
  }
  function leaveCredential() {
    if (!credential) return;
    const id = credential.hrUser.hrUserId;
    setCredential(null); setCopied(''); router.replace(`/hr-access/${id}`);
  }
  const title = labels[operation];

  if (credential) return <section className="max-w-3xl rounded-md border border-line bg-surface p-5 sm:p-7" aria-labelledby="credential-heading">
    <h2 id="credential-heading" tabIndex={-1} className="text-lg font-semibold">{credential.recovery ? 'A temporary password is required' : 'Temporary password, shown once'}</h2>
    <p className="mt-2 text-sm">{credential.hrUser.displayName} · {credential.hrUser.email}</p>
    <p className="mt-4 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-3 text-sm">{credential.notice}</p>
    {credential.recovery ? <><p className="mt-4 text-sm">The account exists. Its earlier temporary password cannot be shown again.</p><Link href={`/hr-access/${credential.hrUser.hrUserId}/regenerate-password`} className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Regenerate temporary password</Link></> : <>
      <p className="mt-4 text-sm">Share this password through an approved channel outside this demo. No email was sent.</p>
      <output aria-label="Temporary password value" className="mt-3 block overflow-wrap-anywhere rounded-md border border-line bg-muted-fill p-4 font-mono text-base" translate="no" data-sensitive="true">{revealPassword ? credential.value : '••••••••••••••••••••'}</output>
      <button type="button" aria-pressed={revealPassword} className="mt-2 text-sm font-medium text-primary underline" onClick={() => setRevealPassword((value) => !value)}>{revealPassword ? 'Hide password' : 'Show password'}</button>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button type="button" variant="outline" onClick={copyPassword}><Copy aria-hidden="true" className="mr-2 size-4" />Copy password</Button><p role="status" aria-live="polite" className="text-sm">{copied}</p></div>
    </>}
    <Button type="button" variant={credential.recovery ? 'outline':'default'} className="mt-5" onClick={leaveCredential}>{credential.recovery ? 'View HR user' : 'Done, I have shared it'}</Button>
  </section>;

  if (saved) return <section className="max-w-3xl" aria-live="polite"><h2 id="saved-heading" tabIndex={-1} className="text-lg font-semibold">{saved.version === user?.version ? 'Nothing changed. No audit event was written.' : `${title} complete`}</h2><p className="mt-2 text-sm">{saved.displayName} · {roleLabel(saved.role)} · {statusLabel(saved.status)} · {saved.accessSummary.text} · {saved.accessibleEmployeeCount} employees · Version {saved.version}</p><Link href={`/hr-access/${saved.hrUserId}`} className="mt-4 inline-block text-sm font-medium text-primary underline">View HR user</Link></section>;

  const currentState = preview && 'current' in preview ? preview.current : null;
  const proposed = preview && 'proposed' in preview ? preview.proposed : null;
  const combinationText = proposed && operation === 'SCOPES' ? scopeCrossProduct(proposed.countries, proposed.departments) : [];
  const limitedScope = operation === 'CREATE' && draft.role === 'SCOPED';
  const selfDeactivation = operation === 'DEACTIVATE' && self;
  const reasonMax = operation === 'REACTIVATE' ? 500 : 2000;

  return <div className="max-w-6xl">
    <Link href={isCreate?'/hr-access':`/hr-access/${user?.hrUserId}`} className="text-sm font-medium text-primary underline underline-offset-4">← {isCreate?'HR Access':user?.displayName}</Link>
    <h1 className="mt-4 text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">{title}</h1>
    <p className="mt-1 text-sm text-muted-foreground">Review the exact access change before confirming.</p>
    {!isCreate && user ? <p className="mt-4 border-y border-line py-3 text-sm">Current record: {user.displayName} · {roleLabel(user.role)} · {statusLabel(user.status)} · {user.accessSummary.text} · {user.accessibleEmployeeCount} employees · Version {user.version}</p> : null}
    {selfDeactivation ? <p className="mt-4 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-3 text-sm">You will be signed out as soon as you confirm.</p> : null}
    {error ? <div id="action-alert" role="alert" tabIndex={-1} className="mt-5 max-w-3xl rounded-md border border-[#f0c3bf] bg-[#fcf1f0] p-4 text-sm">{error}{error.startsWith('We could not confirm') ? <div className="mt-3 flex gap-4"><button type="button" className="font-medium underline" onClick={confirm}>Check again</button>{user?<Link className="font-medium underline" href={`/hr-access/${user.hrUserId}`}>View current record</Link>:null}</div>:null}</div> : null}
    {previewState === 'stale' ? <section className="mt-5 max-w-4xl rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-4"><h2 className="font-semibold">This HR user changed while you were working</h2><div className="mt-3 grid gap-3 md:grid-cols-3"><p className="text-sm"><strong>When you started</strong><br />{currentState?.displayName} · {currentState?.accessSummary.text}</p><p className="text-sm"><strong>Now</strong><br />{current?.displayName} · {current?.accessSummary.text} · Version {current?.version}</p><p className="text-sm"><strong>Your unsaved choice</strong><br />{draft.displayName || draft.countries.map(countryName).join(', ') || title}</p></div><Button className="mt-4" onClick={runPreview}>Preview again</Button></section> : null}
    <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(20rem,1fr)]">
      <form onSubmit={(event)=>{event.preventDefault(); void runPreview();}} className="space-y-6">
        {operation === 'CREATE' ? <>
          <Field label="Display name" id="create-display-name"><Input id="create-display-name" required minLength={1} maxLength={100} value={draft.displayName} onChange={(event)=>update('displayName',event.target.value)} /></Field>
          <Field label="Email" id="create-email"><Input id="create-email" type="email" required maxLength={254} value={draft.email} onChange={(event)=>update('email',event.target.value)} /></Field>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Role</legend>{(['SCOPED','ADMIN'] as const).map(role=><label key={role} className="flex items-center gap-2 text-sm"><input type="radio" checked={draft.role===role} onChange={()=>update('role',role)} />{roleLabel(role)}</label>)}</fieldset>
          {draft.role==='ADMIN'?<p className="rounded-md bg-[#e6ecf8] p-3 text-sm">Admin HR can access all employees. No scope is stored.</p>:<ScopeFields draft={draft} toggle={toggle} update={update} />}
        </> : null}
        {operation === 'PROFILE' ? <Field label="Display name" id="profile-display-name"><Input id="profile-display-name" required minLength={1} maxLength={100} value={draft.displayName} onChange={(event)=>update('displayName',event.target.value)} /></Field> : null}
        {operation === 'SCOPES' ? <ScopeFields draft={draft} toggle={toggle} update={update} allowEmpty /> : null}
        {['DEACTIVATE','REACTIVATE','REGENERATE_PASSWORD'].includes(operation) ? <Field label="Reason" id="reason"><textarea id="reason" required minLength={1} maxLength={reasonMax} value={draft.reason} onChange={(event)=>update('reason',event.target.value)} className="min-h-28 w-full rounded-md border border-input bg-surface p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" /><span className="text-xs text-muted-foreground">{draft.reason.length}/{reasonMax}</span></Field> : null}
        {operation==='PROMOTE'?<p className="rounded-md bg-[#fbf4e4] p-3 text-sm">Promotion removes all country and department scopes. This cannot be undone in this version.</p>:null}
        {operation==='REACTIVATE'?<p className="rounded-md bg-[#e6ecf8] p-3 text-sm">Old sessions are not restored. {user?.displayName} must sign in again.</p>:null}
        {preview && previewState==='stale'?null:<div className="flex flex-wrap gap-3"><Button type="submit" variant="outline" disabled={busy || (limitedScope && (!draft.countries.length || !draft.departments.length))}>{busy?'Updating…':preview?'Preview again':'Preview change'}</Button>{preview && previewState==='ready' && (operation==='REGENERATE_PASSWORD' || (preview as HrAccessPreview).changed) && <Button type="button" variant={operation==='DEACTIVATE'?'destructive':'default'} disabled={busy} onClick={confirm}>{operation==='CREATE'?'Create HR user':operation==='PROFILE'?'Save display name':title}</Button>}</div>}
        {limitedScope && (!draft.countries.length || !draft.departments.length) ? <p className="text-sm text-destructive">A new Scoped HR user needs at least one country and one department.</p>:null}
        {previewState==='stale' && preview ? <Button type="button" onClick={runPreview}>Preview again</Button>:null}
      </form>
      <section aria-labelledby="preview-heading" className="min-w-0 border-y border-line py-4">
        <h2 id="preview-heading" tabIndex={-1} className="text-[0.9375rem] font-semibold">Preview: nothing has changed yet</h2>
        {!preview ? <p className="mt-3 text-sm text-muted-foreground">Create a preview to see the exact result. Previewing writes nothing.</p> : <div className="mt-4 space-y-4 text-sm">
          {'warning' in preview ? <p role="note" className="rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-3">{preview.warning}</p>:null}
          {currentState ? <Record label="Before" state={currentState} /> : 'target' in preview ? <p><strong>Target:</strong> {preview.target.displayName} · {preview.target.email} · {roleLabel(preview.target.role)} · {statusLabel(preview.target.status)}</p> : <p><strong>Before:</strong> New HR user</p>}
          {proposed ? <Record label="After" state={proposed} /> : null}
          {proposed ? <p><strong>Estimated employees in access:</strong> {currentState && currentState.accessibleEmployeeCount!==proposed.accessibleEmployeeCount?`${currentState.accessibleEmployeeCount} → `:''}{proposed.accessibleEmployeeCount}</p>:null}
          {proposed?.countries?.length || proposed?.departments?.length ? <div><p className="font-medium">Country + department access</p><ul className="mt-1 list-disc pl-5">{(combinationText.length?combinationText:proposed.accessSummary.combinations.map((combo)=>`${combo.countryName} + ${combo.department}`)).map((item)=><li key={item}>{item}</li>)}</ul></div>:null}
          {'sessionsToRevoke' in preview && ['PROMOTE','DEACTIVATE','REGENERATE_PASSWORD'].includes(operation) ? <p>{preview.sessionsToRevoke === 0 ? 'No active sessions will end.' : `${preview.sessionsToRevoke} active ${preview.sessionsToRevoke===1?'session will':'sessions will'} end${operation==='DEACTIVATE'?' immediately.':'.'}`}</p>:null}
          {preview.reason ? <p><strong>Reason:</strong> {preview.reason}</p>:null}
          <p>Based on version {'expectedVersion' in preview?preview.expectedVersion:'(new user)'}. Valid until {new Date(preview.previewExpiresAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC.</p>
          {operation !== 'REGENERATE_PASSWORD' && !(preview as HrAccessPreview).changed ? <p className="rounded-md bg-muted-fill p-3">This would change nothing. No confirmation is available.</p> : null}
          {previewState==='stale'||previewState==='expired'?<p role="status" className="rounded-md bg-[#fbf4e4] p-3">{previewState==='stale'?'Out of date: your inputs or the current record changed. Preview again.':'This preview has expired. Preview again.'}</p>:null}
        </div>}
      </section>
    </div>
    {operation==='CREATE' || operation==='REGENERATE_PASSWORD' ? <p className="mt-8 max-w-2xl text-xs text-muted-foreground">A temporary password is shown once after a successful response. It is not emailed; share it through an approved channel.</p>:null}
  </div>;
}

function Field({label,id,children}:{label:string;id:string;children:ReactNode}) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>; }
function ScopeFields({draft,toggle,update,allowEmpty=false}:{draft:Draft;toggle:(field:'countries'|'departments',value:string)=>void;update:<K extends keyof Draft>(field:K,value:Draft[K])=>void;allowEmpty?:boolean}) { const count=draft.countries.length*draft.departments.length; return <div className="space-y-5"><ScopeGroup legend="Countries" field="countries" options={countryOptions.map((c)=>({value:c.code,label:c.name}))} values={draft.countries} toggle={toggle} clear={()=>update('countries',[])} /><ScopeGroup legend="Departments" field="departments" options={departmentOptions.map((d)=>({value:d,label:d}))} values={draft.departments} toggle={toggle} clear={()=>update('departments',[])} /><p className="text-sm text-muted-foreground">{draft.countries.length} countries × {draft.departments.length} departments = {count} combinations</p>{allowEmpty && (!draft.countries.length||!draft.departments.length)?<p className="rounded-md bg-[#fbf4e4] p-3 text-sm">This scope grants access to no employees.</p>:null}</div>; }
function ScopeGroup({legend,field,options,values,toggle,clear}:{legend:string;field:'countries'|'departments';options:{value:string;label:string}[];values:string[];toggle:(field:'countries'|'departments',value:string)=>void;clear:()=>void}) { return <fieldset className="space-y-2"><legend className="text-sm font-medium">{legend}</legend><div className="space-y-1">{options.map((option)=><label key={option.value} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted-fill"><input type="checkbox" checked={values.includes(option.value)} onChange={()=>toggle(field,option.value)} className="size-4 accent-primary" />{option.label}</label>)}</div><button type="button" className="text-xs font-medium text-primary underline" onClick={clear}>Clear {legend.toLowerCase()}</button></fieldset>; }
function Record({label,state}:{label:string;state:PreviewRecord}) { return <div className="border-t border-line pt-3"><p className="font-semibold">{label}</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2"><div><dt className="text-xs text-muted-foreground">Name</dt><dd>{state.displayName}</dd></div><div><dt className="text-xs text-muted-foreground">Role</dt><dd>{roleLabel(state.role)}</dd></div><div><dt className="text-xs text-muted-foreground">Status</dt><dd>{statusLabel(state.status)}</dd></div><div><dt className="text-xs text-muted-foreground">Access</dt><dd>{state.accessSummary.text}</dd></div></dl></div>; }
