const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
function harness(){const values=[],effects=[];let cursor=0;return{react:{...React,useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]},useRef(v){const i=cursor++;return values[i]??(values[i]={current:v})},useEffect(fn){effects.push(fn)}},render(C,p){cursor=0;return C(p)},start(){effects.splice(0).forEach(fn=>fn())}};}
function elements(n,out=[]){if(!n||typeof n!=='object')return out;if(Array.isArray(n)){n.forEach(x=>elements(x,out));return out;}if(n.props){out.push(n);elements(n.props.children,out)}return out;}
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
const Checklist=()=>null,AdminAccess=()=>null,h=harness(),calls=[];let modules=['dashboard'],failure=false;
const record=()=>({id:'org',name:'Own store',business_status:'active',created_at:'2026-10-30',profiles:[{id:'admin',full_name:'Owner',email:'owner@test',role:'admin',is_active:true,permissions:['dashboard']},{id:'super',full_name:'Super',role:'super_admin',is_active:true,permissions:['dashboard']}],business_module_entitlements:modules.map(module_key=>({module_key,enabled:true})),business_subscriptions:{plan:'Custom',status:'active',starts_on:'2026-10-30',expires_on:null,trial_ends_on:null,admin_notes:''},access_summary:{operational:true}});
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/dashboard/businesses/business-manager.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,console,window:{confirm:()=>true},document:{activeElement:null},fetch:async(url,options={})=>{calls.push({url,options});if(options.method==='PATCH'){modules=JSON.parse(options.body).modules;return{ok:true,json:async()=>({ok:true,business:record()})};}if(options.method==='POST')return{ok:!failure,json:async()=>failure?{error:'Grant failed (database code PGRST202)'}:{permissions:['dashboard','sales']}};return{ok:true,json:async()=>url.endsWith('/org')?{business:record(),history:[]}:[record()]};},require(id){if(id==='react')return h.react;if(id==='@/components/module-access-checklist')return{ModuleAccessChecklist:Checklist};if(id==='@/components/business-admin-access')return{BusinessAdminAccess:AdminAccess};if(id.startsWith('@/')||id==='next/link')return{};return require(id)}});
const C=m.exports.BusinessManager,render=()=>elements(h.render(C,{actorId:'super',ownOrganizationId:'org'})),tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{render();h.start();await tick();assert.ok(render().some(e=>text(e).includes('Your ERP workspace: Own store')));
 // Detail GET is fresher than the original list: it must refresh the saved baseline.
 modules=['dashboard','sales'];render().find(e=>e.type==='button'&&text(e)==='Manage modules').props.onClick();await tick();
 assert.equal(render().find(e=>e.type===AdminAccess).props.disabled,false,'Fresh GET must not look like unsaved edits');
 render().find(e=>e.type===Checklist).props.onChange(['dashboard','sales','farm_services']);
 assert.equal(render().find(e=>e.type===AdminAccess).props.disabled,true);
 await render().find(e=>e.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(render().find(e=>e.type===AdminAccess).props.disabled,false,'Verified module save immediately enables administrator grant');
 assert.ok(render().find(e=>e.type===AdminAccess).props.admins.some(a=>a.id==='super'));
 failure=true;render().find(e=>e.type===AdminAccess).props.onGrant({id:'admin',full_name:'Owner'});await tick();
 assert.ok(render().some(e=>e.props.role==='alert'&&text(e).includes('PGRST202')),'Grant failure is visible inside the editor');
 assert.equal(JSON.parse(calls.find(c=>c.options.method==='PATCH').options.body).modules.includes('farm_services'),true);
 console.log('PASS platform editor: stale list vs fresh detail, unsaved-module guard, saved readback, immediate grant readiness, own Super Admin workspace and inline grant failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
