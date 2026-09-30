"use client";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
export function ActionSubmit({label,pendingLabel,className="primary"}:{label:string;pendingLabel:string;className?:string}) {
  const {pending}=useFormStatus();
  return <><button type="submit" className={className} disabled={pending} aria-busy={pending}>{pending&&<LoaderCircle className="action-spinner" size={18}/>} {pending?pendingLabel:label}</button><span className="action-status" role="status" aria-live="polite">{pending?pendingLabel:""}</span></>;
}
