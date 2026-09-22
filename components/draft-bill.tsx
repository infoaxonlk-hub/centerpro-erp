"use client";
import {useState} from 'react';
import {createPortal} from 'react-dom';
import {Bill,type BillData} from './bill';
export function DraftBill({data,disabled=false}:{data:BillData;disabled?:boolean}){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="ghost bill-preview-button" disabled={disabled} onClick={()=>setOpen(true)}>Print bill · Before payment</button>{open&&createPortal(<div className="bill-preview-overlay" role="dialog" aria-modal="true" aria-label="Draft bill preview" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setOpen(false);if(e.key==='Tab'){const buttons=e.currentTarget.querySelectorAll<HTMLButtonElement>('button');const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><div className="bill-preview-content"><div className="bill-actions"><button autoFocus className="ghost" onClick={()=>setOpen(false)}>Back to payment</button><button className="primary" onClick={()=>window.print()}>Print bill</button></div><Bill data={{...data,draft:true}}/></div></div>,document.body)}</>;
}
