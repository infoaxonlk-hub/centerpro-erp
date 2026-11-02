import {PartyDirectoryScreen} from '@/components/party-directory-screen';
import {partyRecordId,type PartySearch} from '@/lib/party-routes';
export default async function Page({searchParams}:{searchParams:Promise<PartySearch>}){return <PartyDirectoryScreen kind="customer" services initialId={partyRecordId(await searchParams)}/>;}
