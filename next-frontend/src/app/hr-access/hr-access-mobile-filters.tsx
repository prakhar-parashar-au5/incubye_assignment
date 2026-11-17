"use client";

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { defaultHrDirection, hrAccessSearch, type HrAccessQuery } from '@/lib/hr-access';

type Props = { query: HrAccessQuery };
type Draft = Pick<HrAccessQuery,'role'|'status'|'country'|'department'|'sort'|'direction'>;
export function HrAccessMobileFilters({query}:Props){
  const router=useRouter();const [open,setOpen]=useState(false);const [draft,setDraft]=useState<Draft>({});
  const active=[query.role,query.country,query.department,query.status&&query.status!=='ACTIVE'?query.status:undefined].filter(Boolean).length;
  function onOpenChange(next:boolean){if(next)setDraft({role:query.role,status:query.status,country:query.country,department:query.department,sort:query.sort,direction:query.direction});setOpen(next);}
  function apply(){router.push(`/hr-access${hrAccessSearch({...query,...draft,page:1})}`);setOpen(false);}
  function clear(){router.push(`/hr-access${hrAccessSearch({q:query.q,sort:query.sort,direction:query.direction,pageSize:query.pageSize})}`);setOpen(false);}
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetTrigger render={<Button type="button" variant="outline" className="lg:hidden"/>}><SlidersHorizontal aria-hidden="true" className="mr-2 size-4" />Filters{active?` (${active} active)`:''}</SheetTrigger>
    <SheetContent side="right" className="w-full max-w-sm overflow-y-auto">
      <SheetHeader className="border-b border-line px-5 py-4"><SheetTitle>HR user filters</SheetTitle><SheetDescription>Choose which HR accounts to show.</SheetDescription></SheetHeader>
      <div className="flex flex-col gap-4 px-5">
        <Select id="hr-mobile-role" label="Role" value={draft.role??''} onChange={(value)=>setDraft((old)=>({...old,role:(value||undefined) as Draft['role']}))}><option value="">All roles</option><option value="ADMIN">Admin HR</option><option value="SCOPED">Scoped HR</option></Select>
        <Select id="hr-mobile-status" label="Status" value={draft.status??'ACTIVE'} onChange={(value)=>setDraft((old)=>({...old,status:value as Draft['status']}))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">Active and inactive</option></Select>
        <Select id="hr-mobile-country" label="Country scope" value={draft.country??''} onChange={(value)=>setDraft((old)=>({...old,country:(value||undefined) as Draft['country']}))}><option value="">All countries</option><option value="IN">India</option><option value="US">United States</option></Select>
        <Select id="hr-mobile-department" label="Department scope" value={draft.department??''} onChange={(value)=>setDraft((old)=>({...old,department:(value||undefined) as Draft['department']}))}><option value="">All departments</option>{['Tech','HR','Finance','Operations','Support'].map((name)=><option key={name}>{name}</option>)}</Select>
        <Select id="hr-mobile-sort" label="Sort by" value={draft.sort??'updatedAt'} onChange={(value)=>setDraft((old)=>({...old,sort:value as Draft['sort'],direction:defaultHrDirection(value as Draft['sort'])}))}><option value="updatedAt">Last updated</option><option value="name">Name</option><option value="email">Email</option></Select>
        <Select id="hr-mobile-direction" label="Order" value={draft.direction??defaultHrDirection(draft.sort)} onChange={(value)=>setDraft((old)=>({...old,direction:value as Draft['direction']}))}><option value="asc">Ascending</option><option value="desc">Descending</option></Select>
      </div>
      <SheetFooter className="border-t border-line px-5 py-4"><Button type="button" onClick={apply}>Apply</Button><Button type="button" variant="outline" onClick={clear}>Clear filters</Button><SheetClose render={<Button type="button" variant="ghost"/>}>Cancel</SheetClose></SheetFooter>
    </SheetContent>
  </Sheet>;
}
function Select({id,label,value,onChange,children}:{id:string;label:string;value:string;onChange:(value:string)=>void;children:React.ReactNode}){return <div className="flex flex-col gap-1.5"><Label htmlFor={id}>{label}</Label><NativeSelect id={id} value={value} onChange={(event)=>onChange(event.target.value)}>{children}</NativeSelect></div>;}
