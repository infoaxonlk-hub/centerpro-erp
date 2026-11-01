const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require:id=>Object.hasOwn(overrides,id)?overrides[id]:require(id),console},{filename:file});return module.exports;}
const messages=load('lib/legal-messages.ts');
for(const lang of ['en','si','ta'])for(const key of Object.keys(messages.legalCatalogs.en))assert.ok(messages.legalText(lang,key)?.length,`${lang}:${key}`);
const siName=messages.legalCatalogs.si.name;delete messages.legalCatalogs.si.name;assert.equal(messages.legalText('si','name'),messages.legalCatalogs.en.name);messages.legalCatalogs.si.name=siName;
assert.equal(messages.legalError('ta','legal.vat_overlap'),messages.legalText('ta','overlap'));
const {LegalMasterManager}=load('components/legal-master-manager.tsx',{'@/lib/supabase/client':{createClient(){throw Error('render must not make a request');}},'@/lib/legal-messages':messages,'@/app/legal-masters.css':{}});
const master={id:'one',legal_revision:1,name:'Existing',registered_name:'Legal name',trading_name:null,legal_email:'email@example.test',business_registration_number:null,tin:'123456789',payment_terms_days:30,payment_terms_note:null,addresses:[{kind:'billing',is_default:true,line1:'Street',country_code:'LK'}],vat_registrations:[{status:'registered',registration_number:'VAT-NUMBER',valid_from:'2026-01-01',valid_to:'2026-07-01'}],can_edit:true};
const html=renderToStaticMarkup(React.createElement(LegalMasterManager,{kind:'customer',initialRows:[],centers:[],canCreate:true,initialMaster:master}));
for(const value of ['Legal name','Street','VAT-NUMBER','2026-01-01','valid until','TIN','Save'])assert.ok(html.toLowerCase().includes(value.toLowerCase()),value);
const readonly=renderToStaticMarkup(React.createElement(LegalMasterManager,{kind:'business',initialRows:[],centers:[],canCreate:false,initialMaster:{...master,can_edit:false}}));assert.ok(readonly.includes('<fieldset disabled=""'));assert.ok(!readonly.includes('class="primary legal-save"'));
(async()=>{
 const {buildLegalSnapshot}=load('lib/legal-masters.ts');const data={schema_version:1,party:{registered_name:'Original'},addresses:{},vat:{status:'unknown'}};
 const snapshot=await buildLegalSnapshot({rpc:async(name,args)=>{assert.equal(name,'build_legal_snapshot');assert.equal(args.p_date,'2026-01-01');return{data,error:null};}},'customer','one','2026-01-01');data.party.registered_name='Edited';assert.equal(snapshot.party.registered_name,'Original');
 await assert.rejects(()=>buildLegalSnapshot({rpc:async()=>({data:{schema_version:2},error:null})},'customer','one','2026-01-01'),/invalid_snapshot/);
 console.log('PASS EN/SI/TA catalogs and fallback, legal edit/read-only rendering, distinct TIN/VAT fields and owned versioned snapshot values.');
})().catch(e=>{console.error(e);process.exitCode=1});
