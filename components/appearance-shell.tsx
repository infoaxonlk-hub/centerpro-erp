"use client";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import Link from "next/link";
import {Grid3X3,ArrowLeft,Search} from "lucide-react";
import {sections} from "./sidebar-navigation";
import {OfflinePosLink} from "./offline-pos-link";
type Theme="light"|"dark"|"system";
type Mode="cards"|"list";
export function AppearanceShell({children,permissions,isAdmin}:{children:React.ReactNode;permissions:string[];isAdmin:boolean}) {
 const pathname=usePathname();
 const [theme,setTheme]=useState<Theme>("system"),[mode,setMode]=useState<Mode>("cards"),[group,setGroup]=useState<string|null>(null),[search,setSearch]=useState("");
 useEffect(()=>{try{const t=localStorage.getItem("centerpro-theme"),m=localStorage.getItem("centerpro-navigation");if(t==="light"||t==="dark"||t==="system")setTheme(t);if(m==="cards"||m==="list")setMode(m);}catch{}},[]);
 useEffect(()=>{const media=matchMedia("(prefers-color-scheme: dark)");const apply=()=>{document.documentElement.dataset.theme=theme==="system"?(media.matches?"dark":"light"):theme;};apply();media.addEventListener("change",apply);return()=>media.removeEventListener("change",apply);},[theme]);
 useEffect(()=>{setGroup(null);setSearch("");},[pathname]);
 const items=sections.flatMap(s=>s.items).filter(i=>(!i.adminOnly||isAdmin)&&(i.centerUserOrStock?(!isAdmin||permissions.includes("stock")):!i.permission||permissions.includes(i.permission)));
 const selected=items.find(i=>i.href===group);
 const active=items.filter(i=>i.href!=="/dashboard"&&(pathname===i.href||pathname.startsWith(i.href+"/"))).sort((a,b)=>b.href.length-a.href.length)[0];
 const link=(href:string,label:string,key:string)=>href.endsWith("/new")?<OfflinePosLink className="launcher-tile" href={href} key={key}><span className="launcher-icon"><Grid3X3/></span><b>{label}</b></OfflinePosLink>:<Link className="launcher-tile" href={href} key={key}><span className="launcher-icon"><Grid3X3/></span><b>{label}</b></Link>;
 return <div className={`app-shell appearance-${mode}`}>
 <div className="appearance-controls"><Link href="/dashboard" className="ghost" onClick={()=>setGroup(null)}><Grid3X3 size={17}/> Apps</Link><label>Theme<select value={theme} onChange={e=>{const v=e.target.value as Theme;setTheme(v);try{localStorage.setItem("centerpro-theme",v);}catch{}}}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label><label>Navigation<select value={mode} onChange={e=>{const v=e.target.value as Mode;setMode(v);try{localStorage.setItem("centerpro-navigation",v);}catch{}}}><option value="cards">Cards</option><option value="list">List</option></select></label></div>
 {mode==="cards"&&pathname==="/dashboard"&&<section className="app-launcher"><header>{selected?<button className="ghost" onClick={()=>setGroup(null)}><ArrowLeft size={18}/> All apps</button>:<div><span className="eyebrow dark">CENTERPRO</span><h1>Your workspace</h1><p>Choose an app to get started.</p></div>}<label className="launcher-search"><Search size={18}/><input placeholder="Search apps" value={search} onChange={e=>setSearch(e.target.value)}/></label></header><h2>{selected?.label}</h2><div className="launcher-grid">{selected?<>{link(selected.href,selected.label,"overview")}{selected.children?.filter(c=>!c.permission||permissions.includes(c.permission)).map(c=>link(c.href,c.label,c.href))}{selected.permission==="sales"&&link("/dashboard/sales/new","New sale · POS","pos")}</>:items.filter(i=>i.label.toLowerCase().includes(search.toLowerCase())).map((i,index)=>{const Icon=i.icon;return <button className="launcher-tile" style={{"--tile-color":["#7c3aed","#059669","#2563eb","#ea580c","#db2777"][index%5]} as React.CSSProperties} key={i.href} onClick={()=>{setGroup(i.href);setSearch("");}}><span className="launcher-icon"><Icon size={36}/></span><b>{i.label}</b></button>})}</div>{!selected&&permissions.includes("purchases")&&!permissions.includes("payment_reports")&&<div className="launcher-grid">{link("/dashboard/payment-reports/payables","Supplier Payables","payables")}</div>}</section>}
 {mode==="cards"&&pathname!=="/dashboard"&&active&&<nav className="module-cards" aria-label="Module navigation"><Link href="/dashboard">All apps</Link><Link href={active.href}>{active.label}</Link>{active.children?.filter(c=>!c.permission||permissions.includes(c.permission)).map(c=><OfflinePosLink className={pathname===c.href?"selected":""} key={c.href} href={c.href}>{c.label}</OfflinePosLink>)}</nav>}
 <div className={mode==="cards"&&pathname==="/dashboard"?"shell-content launcher-home":"shell-content"}>{children}</div>
 </div>;
}
