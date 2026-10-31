"use client";
import {Languages} from 'lucide-react';
export function FarmLanguageButtons({value,onChange}:{value:string;onChange:(value:'en'|'si'|'ta')=>void}){
 return <div className="farm-language-options" role="group" aria-label="Receipt language">{(['en','si','ta'] as const).map(language=><button type="button" key={language} lang={language} className={value===language?'selected':''} aria-pressed={value===language} onClick={()=>onChange(language)}><Languages size={17} aria-hidden="true"/><span>{language==='en'?'English':language==='si'?'සිංහල':'தமிழ்'}</span></button>)}</div>;
}
