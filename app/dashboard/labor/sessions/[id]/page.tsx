import {LaborScreen} from "../../screen";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LaborScreen view="sessions" sessionId={id}/>;}
