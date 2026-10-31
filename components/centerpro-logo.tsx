import Image from "next/image";
import logo from "@/public/centerpro-logo.png";

export function CenterProLogo({sizes,priority=false}:{sizes:string;priority?:boolean}) {
  return <Image className="centerpro-brand-image" src={logo} alt="CenterPro ERP Software" sizes={sizes} priority={priority}/>;
}
