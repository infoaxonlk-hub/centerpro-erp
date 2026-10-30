import Link from 'next/link';
import {requirePermission} from '@/lib/access';
import './farm-services.css';
export default async function FarmLayout({children}:{children:React.ReactNode}){
 await requirePermission('farm_services');
 return <div className="farm-module"><header className="farm-heading"><span className="eyebrow">FARM SERVICES</span><h1>Farm Services</h1><p>Simple service billing. One shared customer account.</p></header><nav className="farm-nav bill-actions" aria-label="Farm Services">{[['new','New Bill'],['','Service Orders'],['products','Service Products'],['seasons','Seasons'],['accounts','Customer Accounts']].map(([path,label])=><Link key={path} href={'/dashboard/farm-services'+(path?'/'+path:'')}>{label}</Link>)}</nav>{children}</div>;
}
