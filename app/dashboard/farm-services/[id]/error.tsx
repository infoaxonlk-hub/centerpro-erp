"use client";
import Link from 'next/link';
export default function ReceiptError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <section className="panel"><h2>Receipt could not be loaded</h2><p>If bill confirmation succeeded, the bill remains saved. Find it in Service Orders; opening or retrying its receipt does not create another bill.</p>{error.digest&&<p>Support reference: {error.digest}</p>}<div className="farm-receipt-actions"><button type="button" className="farm-save" onClick={reset}>Retry receipt</button><Link className="ghost" href="/dashboard/farm-services">Service Orders</Link></div></section>;
}
