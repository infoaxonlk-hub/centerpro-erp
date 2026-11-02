import {redirect} from 'next/navigation';
import {partyRedirect,type PartySearch} from '@/lib/party-routes';
export default async function Page({searchParams}:{searchParams:Promise<PartySearch>}){redirect(partyRedirect('/dashboard/masters?tab=suppliers',await searchParams));}
