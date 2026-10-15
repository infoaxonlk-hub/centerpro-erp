import Link from "next/link";
import {requirePermission} from "@/lib/access";
import "../bank.css";

type Params={account?:string|string[];center?:string|string[];from?:string|string[];to?:string|string[];page?:string|string[]};
type Account={id:string;account_number:string;account_name:string|null;payment_banks:{name:string}|{name:string}[]|null};
type Center={id:string;code:string;name:string};
type BookRow={entry_id:string;posted_at:string;center_name:string;description:string;reference:string|null;debit:number|string;credit:number|string;running_balance:number|string};
const first=(v:string|string[]|undefined)=>typeof v==="string"?v:"";
const cleanDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(`${s}T00:00:00Z`))?s:"";
const money=(x:number)=>new Intl.NumberFormat("en-LK",{minimumFractionDigits:2,maximumFractionDigits:2}).format(x);
const dateText=(x:string)=>new Intl.DateTimeFormat("en-LK",{timeZone:"Asia/Colombo",year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(x));
const one=<T,>(v:T|T[]|null):T|null=>Array.isArray(v)?v[0]??null:v;
const PAGE_SIZE=50;
export default async function BankStatementPage({searchParams}:{searchParams:Promise<Params>}){
 const {supabase,profile}=await requirePermission("cash");
 if(!["admin","super_admin"].includes(profile.role))return <section className="panel bank-empty">Bank statements are restricted to administrators.</section>;
 const p=await searchParams;const accountParam=first(p.account);const centerParam=first(p.center);
 const from=cleanDate(first(p.from));const to=cleanDate(first(p.to));
 const pg=Number(first(p.page));const page=Number.isSafeInteger(pg)&&pg>0?Math.min(pg,20000):1;
 const [{data:accounts,error:accountError},{data:centers,error:centerError}]=await Promise.all([
  supabase.from("bank_accounts").select("id,account_number,account_name,payment_banks(name)").eq("organization_id",profile.organization_id).order("created_at"),
  supabase.from("centers").select("id,code,name").eq("organization_id",profile.organization_id).order("code")
 ]);
 if(accountError||centerError)throw new Error(accountError?.message??centerError?.message);
 const allAccounts=(accounts??[]) as Account[];const allCenters=(centers??[]) as Center[];
 const selected=accountParam?allAccounts.find(x=>x.id===accountParam):allAccounts[0];
 const selectedCenter=centerParam?allCenters.find(x=>x.id===centerParam):null;
 const invalidAccount=Boolean(accountParam)&&!selected;const invalidCenter=Boolean(centerParam)&&!selectedCenter;
 const invalidDate=Boolean(from&&to&&from>to);
 let rows:BookRow[]=[];let balance:number|null=null;let fetchError="";
 if(selected&&!invalidAccount&&!invalidCenter&&!invalidDate){
  const [{data:statement,error:rowError},{data:b,error:balError}]=await Promise.all([
   supabase.rpc("company_bank_statement",{p_bank_account:selected.id,p_center:selectedCenter?.id??null,p_from:from||null,p_to:to||null,p_limit:PAGE_SIZE+1,p_offset:(page-1)*PAGE_SIZE}),
   supabase.rpc("bank_book_balance",{p_bank_account:selected.id})
  ]);
  if(rowError||balError)fetchError=`Bank Statement requires migration 043: ${rowError?.message??balError?.message}`;
  else{rows=(statement??[]) as BookRow[];balance=Number(b??0)}
 }
 const hasNext=rows.length>PAGE_SIZE;const visible=rows.slice(0,PAGE_SIZE);
 const opening=visible.length?Number(visible[0].running_balance)-Number(visible[0].debit)+Number(visible[0].credit):null;
 const closing=visible.length?Number(visible.at(-1)?.running_balance):null;
 function urlFor(targetPage:number){const u=new URLSearchParams();if(selected)u.set("account",selected.id);if(selectedCenter)u.set("center",selectedCenter.id);if(from)u.set("from",from);if(to)u.set("to",to);if(targetPage>1)u.set("page",String(targetPage));return `/dashboard/bank/statement?${u.toString()}`}
 return <section className="bank-management bank-statement">
  <div className="page-heading"><div><span className="eyebrow dark">BANK MANAGEMENT</span><h1>Bank Statement</h1><p>Company Bank Book · Center-wise bank transactions · Debit / Credit / Running Balance</p></div></div>
  <form className="panel bank-statement-filters" action="/dashboard/bank/statement" method="get">
   <label>Bank account<select name="account" defaultValue={selected?.id??""} disabled={!allAccounts.length}>{!allAccounts.length&&<option value="">No company bank accounts</option>}{allAccounts.map(a=><option key={a.id} value={a.id}>{one(a.payment_banks)?.name} · {a.account_number}</option>)}</select></label>
   <button type="submit" className="primary" disabled={!allAccounts.length}>View statement</button>
   <details className="cp-filter-details cp-ledger-extra" open={Boolean(selectedCenter || from || to)}>
    <summary>More filters{Number(Boolean(selectedCenter))+Number(Boolean(from))+Number(Boolean(to))>0&&<span className="cp-filter-count">{Number(Boolean(selectedCenter))+Number(Boolean(from))+Number(Boolean(to))}</span>}</summary>
    <div className="cp-filter-fields">
     <label>Center<select name="center" defaultValue={selectedCenter?.id??""}><option value="">All Centers + Admin</option>{allCenters.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
     <label>From<input type="date" name="from" defaultValue={from}/></label>
     <label>To<input type="date" name="to" defaultValue={to}/></label>
     <div className="cp-filter-actions"><button type="submit" className="primary" disabled={!allAccounts.length}>Apply filters</button><Link href="/dashboard/bank/statement" className="soft">Clear</Link></div>
    </div>
   </details>
  </form>
  {invalidAccount&&<div className="alert error">Bank account is not available to this company.</div>}
  {invalidCenter&&<div className="alert error">Center is not available to this company.</div>}
  {invalidDate&&<div className="alert error">From date must be before To date.</div>}
  {fetchError&&<div className="alert error">{fetchError}</div>}
  {!allAccounts.length&&<p className="panel bank-empty">First create a bank account under <Link href="/dashboard/bank/accounts">Bank Accounts</Link>.</p>}
  {selected&&!invalidAccount&&!invalidCenter&&!invalidDate&&!fetchError&&<>
   <div className="bank-statement-summary">
    <article className="panel"><span>Company bank account</span><strong>{one(selected.payment_banks)?.name} · {selected.account_number}</strong></article>
    <article className="panel"><span>Current full-account balance</span><strong>LKR {money(balance??0)}</strong></article>
    <article className="panel"><span>Opening before displayed entries</span><strong>{opening===null?"—":`LKR ${money(opening)}`}</strong></article>
   </div>
   <p className="bank-note">Running balance always includes ALL centers and Admin deposits, even when filtered to one center. Center filter only changes which transactions are shown.</p>
   <div className="panel bank-statement-table"><div className="bank-statement-heading"><h2>Bank Book — Debit / Credit</h2><span>Page {page}</span></div>
    <div className="bank-scroll"><table><thead><tr><th>Date & Time</th><th>Center</th><th>Description</th><th>Reference</th><th className="number">Debit (LKR)</th><th className="number">Credit (LKR)</th><th className="number">Balance (LKR)</th></tr></thead><tbody>
     {visible.length>0&&<tr className="bank-opening"><td colSpan={6}>Opening balance before displayed entries</td><td className="number">{money(opening??0)}</td></tr>}
     {visible.map(r=><tr key={r.entry_id}><td className="bank-nowrap">{dateText(r.posted_at)}</td><td>{r.center_name}</td><td><strong>{r.description}</strong></td><td>{r.reference||"—"}</td><td className="number bank-debit">{Number(r.debit)?money(Number(r.debit)):"—"}</td><td className="number bank-credit">{Number(r.credit)?money(Number(r.credit)):"—"}</td><td className="number"><strong>{money(Number(r.running_balance))}</strong></td></tr>)}
     {!visible.length&&<tr><td colSpan={7} className="bank-empty">No bank transactions match these filters.</td></tr>}
    </tbody>{closing!==null&&<tfoot><tr><td colSpan={6}>Closing balance after displayed entries</td><td className="number">{money(closing)}</td></tr></tfoot>}</table></div></div>
   <nav className="bank-pages">{page>1?<Link href={urlFor(page-1)}>← Previous</Link>:<span/>}{hasNext?<Link href={urlFor(page+1)}>Next →</Link>:<span/>}</nav>
  </>}
 </section>;
}
