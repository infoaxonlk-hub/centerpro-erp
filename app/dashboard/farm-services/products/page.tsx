import {farmOptions} from '../data';
import {FarmManagement} from '../management';
export default async function Page(){const{services,profile}=await farmOptions();return <FarmManagement kind="services" services={services} canManage={['admin','super_admin'].includes(profile.role)||(profile.permissions??[]).includes('farm_services_manage')}/>;}
