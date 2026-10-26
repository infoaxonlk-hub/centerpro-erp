import {moduleEnabled} from "@/lib/business-modules";
import {requirePermission} from "@/lib/access";
import {readAll} from "@/lib/read-all";
import {ProductCatalog,type CatalogProduct} from "./product-catalog";
import "@/app/navigation-restoration.css";
export async function ProductCatalogScreen({module}:{module:"purchases"|"sales"}){
 const {supabase:s,profile,business}=await requirePermission(module);
 const products=await readAll<CatalogProduct&{image_path:string|null}>(s,"products","id,code,name,category,unit_of_measure,is_active,image_path,product_qualities(id,name,default_price,is_active)",profile.organization_id);
 const paths=products.flatMap(p=>p.image_path?[p.image_path]:[]);
 const urls=new Map<string,string>();
 for(let i=0;i<paths.length;i+=100){const {data,error}=await s.storage.from("product-images").createSignedUrls(paths.slice(i,i+100),3600);if(error)throw new Error("Product photos could not be loaded.");for(const x of data??[])if(x.path&&x.signedUrl)urls.set(x.path,x.signedUrl);}
 return <ProductCatalog products={products.map(p=>({...p,imageUrl:p.image_path?urls.get(p.image_path):undefined}))} canEdit={moduleEnabled("masters",business.enabledModules)&&profile.permissions.includes("masters")&&profile.permissions.includes("product_edit")}/>;
}
