import {requirePermission} from '@/lib/access';
import './farm-services.css';
export default async function FarmLayout({children}:{children:React.ReactNode}){
 await requirePermission('farm_services');
 return <div className="farm-module">{children}</div>;
}
