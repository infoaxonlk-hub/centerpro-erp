import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { businessModules } from "@/lib/business-modules";
import { SupportContact } from "@/components/support-contact";
export default async function RestrictedPage({searchParams}:{searchParams:Promise<{module?:string}>}) {
  const { module } = await searchParams;
  const definition = businessModules.find(item => item.key===module);
  return <section className="panel access-status"><LockKeyhole size={40}/><h1>Module Access Restricted</h1>
    {definition && <h2>{definition.name}</h2>}
    <p>This module is not available for your business. Please contact InfoAxon to enable access.</p>
    <SupportContact/><p><Link className="ghost" href="/dashboard">Back to apps</Link></p>
  </section>;
}
