import {SalesScreen} from "./screen";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function SalesPage({searchParams}:{searchParams:SearchParams}){
 const params=await searchParams;
 const view=Array.isArray(params.view)?params.view[0]:params.view;
 return <SalesScreen start={view==="customers"?"customers":"history"}/>;
}
