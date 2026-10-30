import {farmOptions} from '../data';
import {FarmManagement} from '../management';
export default async function Page(){const{seasons}=await farmOptions();return <FarmManagement kind="seasons" seasons={seasons}/>;}
