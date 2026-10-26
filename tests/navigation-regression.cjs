/* Run: node tests/navigation-regression.cjs. No database or network calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let laborFilter='all';
let navPath='/dashboard',mode='cards',selectedGroup=null,partySelected=null,partyView='profile';
const original=Module._load;
Module._load=function(id,parent,...rest){
 if(id==='@/lib/supabase/client')return {createClient:()=>{throw Error('Unexpected database call')}};
 if(id==='@/components/feedback')return {notify:()=>{}};
 if(id.endsWith('.css'))return {};
 if(id==='next/navigation')return {usePathname:()=>navPath,useRouter:()=>({})};
 if(id==='next/link')return {__esModule:true,default:({children,href,...p})=>React.createElement('a',{href,...p},children)};
 if(id.includes('offline-pos-link'))return {OfflinePosLink:({children,href,...p})=>React.createElement('a',{href,...p},children)};
 if(id.includes('product-image-actions'))return {saveProductImage:()=>{throw Error('Unexpected mutation')}};
 if(id==='react'&&parent?.filename.endsWith('labor-manager.tsx')){let n=0;return {...React,useState:(v)=>{const i=n++;return React.useState(i===1?laborFilter:v)}};}
 if(id==='react'&&parent?.filename.endsWith('appearance-shell.tsx')){let n=0;return {...React,useState:(v)=>{const i=n++;return React.useState(i===5?mode:i===6?selectedGroup:v)}};}
 if(id==='react'&&parent?.filename.endsWith('party-directory.tsx')){let n=0;return {...React,useState:(v)=>{const i=n++;return React.useState(i===4?partySelected:i===5?partyView:v)}};}
 if(id.startsWith('@/'))id=path.join(root,id.slice(2));
 return original.call(this,id,parent,...rest);
};
for(const ext of ['.tsx','.ts'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const {sections,canSeeNavigation,activeNavigation}=require('../components/sidebar-navigation.tsx');
const all=sections.flatMap(s=>s.items),permissions=['dashboard','purchases','sales','stock','stock_adjustment','labor','cash','payment_reports','masters','centers','users','audit'];
for(const item of all)for(const target of [item,...item.children??[]])assert.ok(fs.existsSync(path.join(root,'app',target.href.split('?')[0],'page.tsx')),`Missing route: ${target.href}`);
assert.deepEqual(all.find(x=>x.label==='Purchases').children.map(x=>x.label),['New purchase','Purchase orders','Products','Suppliers']);
assert.deepEqual(all.find(x=>x.label==='Sales').children.map(x=>x.label),['New sale','Sales orders','Sales summary','Products','Customers']);
assert.ok(all.find(x=>x.label==='Inventory').children.some(x=>x.href.endsWith('/scrap')));
assert.equal(activeNavigation('/dashboard/sales/receivables',all).label,'Customer receivables');
assert.equal(activeNavigation('/dashboard/payment-reports/cheques',all).label,'Cheque management');
assert.equal(activeNavigation('/dashboard/payment-reports/bank',all).label,'Payments');
assert.equal(activeNavigation('/dashboard/purchases/products',all).label,'Purchases');
assert.equal(canSeeNavigation(all.find(x=>x.label==='Supplier payables'),['purchases'],false),true);
assert.equal(canSeeNavigation(all.find(x=>x.label==='Supplier payables'),['payment_reports'],false),true);
assert.equal(canSeeNavigation(all.find(x=>x.label==='Users & Access'),['users'],false),false);
assert.equal(canSeeNavigation(all.find(x=>x.label==='Sales'),['purchases'],false),false);
function appearance(){delete require.cache[require.resolve('../components/appearance-shell.tsx')];const {AppearanceShell}=require('../components/appearance-shell.tsx');return renderToStaticMarkup(React.createElement(AppearanceShell,{permissions,isAdmin:true,companyName:'Test',children:React.createElement('p',null,'Dashboard content')}));}
for(const m of ['cards','apps','list']){mode=m;const html=appearance();assert.ok(html.includes('appearance-'+m));assert.ok(!html.includes('dashboard-summary-slot'));assert.ok(!html.includes('launcher-dashboard-open'));if(m==='cards')assert.ok(html.includes('launcher-sections'));if(m==='apps')assert.ok(!html.includes('launcher-sections'));}
mode='cards';selectedGroup='/dashboard/purchases';let html=appearance();for(const name of ['New purchase','Purchase orders','Products','Suppliers'])assert.ok(html.includes(name));
for(const m of ['cards','apps']){mode=m;selectedGroup='/dashboard';assert.ok(appearance().includes('launcher-dashboard-open'));}selectedGroup=null;
const appearanceSource=fs.readFileSync(path.join(root,'components/appearance-shell.tsx'),'utf8');for(const s of ['Purchase POS','Detailed purchase order','centerpro-purchase-view-change','Grouped cards','App view','Upload background image'])assert.ok(appearanceSource.includes(s),`Lost existing setting: ${s}`);
const {PartyDirectory}=require('../components/party-directory.tsx');const parties=[{id:'s1',name:'Supplier One',phone:'0711234567',address:'Center Road'}],orders=[{id:'o1',partyId:'s1',number:'PO1',date:'2026-10-12',center:'Main',total:1000,due:250,status:'confirmed'},{id:'o2',partyId:'s1',number:'PO2',date:'2026-10-12',center:'Main',total:500,due:500,status:'cancelled'}];
html=renderToStaticMarkup(React.createElement(PartyDirectory,{kind:'supplier',parties,orders,createHref:'/dashboard/masters'}));assert.ok(html.includes('250.00'));assert.ok(!html.includes('750.00'));
const {SalesManager}=require('../app/dashboard/sales/sales-manager.tsx');
const sale={id:'o1',center_id:'c1',customer_id:null,customer_name:'Cash',sale_number:'SO1',status:'confirmed',total_amount:1000,paid_amount:750,credit_balance:250,payment_status:'partially_paid',confirmed_at:'2026-10-12',sales_order_lines:[],sales_payments:[]};
for(const start of ['history','summary']){html=renderToStaticMarkup(React.createElement(SalesManager,{start,centers:[],customers:[],sales:[sale]}));assert.equal(html.includes('Payment method summary'),start==='summary');assert.equal(html.includes('Sale / invoice'),start==='history');assert.ok(!html.includes('New sale'));}
console.log('PASS: navigation routes, permissions, 3 modes, purchase settings, dashboard, balances, sales separation.');
(async()=>{
 const {readAll}=require('../lib/read-all.ts');let ranges=0;
 const client={from(table){assert.equal(table,'supplier_payables');return {select(){return this},eq(k,v){assert.equal(k,'organization_id');assert.equal(v,'org-test');return this},order(){return this},async range(a,b){ranges++;return {data:Array.from({length:Math.max(0,Math.min(1201-a,b-a+1))},(_,i)=>({id:a+i})),error:null}}}}};
 const rows=await readAll(client,'supplier_payables','id','org-test');assert.equal(rows.length,1201);assert.equal(ranges,3);
 console.log('PASS: all 1,201 rows read across pages with organization filtering.');
})().catch(e=>{console.error(e);process.exitCode=1});

const {CashManager}=require('../app/dashboard/cash/cash-manager.tsx');
const cashLabels=['Available cash by center','Cash handover history','Accepted cash ledger','Center cash top-ups','Company bank accounts'];
assert.deepEqual(all.find(x=>x.label==='Cash Manage').children.map(x=>x.label),['Cash Management','Cash Ledger']);
assert.deepEqual(all.find(x=>x.label==='Bank Management').children.map(x=>x.label),['Bank Accounts','Bank Statement']);
for(const [i,view] of ['available','handovers','ledger'].entries()){
 const markup=renderToStaticMarkup(React.createElement(CashManager,{view,initialLedger:[],initialHandovers:[],centers:[],initialBalances:[],canIssue:true}));
 assert.ok(markup.includes(cashLabels[i]));
 for(const [j,label] of cashLabels.slice(0,3).entries())if(j!==i)assert.ok(!markup.includes(label));
 assert.equal(markup.includes('Issue cash'),view!=='ledger');
}
console.log('PASS: current Cash Manage / Bank Management menus and isolated legacy cash sections.');

const {LaborManager}=require('../app/dashboard/labor/labor-manager.tsx');
assert.deepEqual(all.find(x=>x.label==='Labor & Sessions').children.map(x=>x.label),['Laborers','Sessions']);
const laborProps={organizationId:'org',centers:[],laborers:[{id:'w',full_name:'Worker One',phone:'071',rate_basis:'per_kg',rate:2,is_active:true}],sessions:[{id:'s',title:'Morning team',center_id:'c',session_date:'2026-10-12',operation:'purchase',status:'open',notes:null,centers:{code:'C1',name:'Main'},labor_session_workers:[{laborer_id:'w',rate_basis:'per_kg',rate:2,laborers:{full_name:'Worker One'}}]}],orders:[{id:'o',labor_session_id:'s',labor_load_count:1,kind:'purchase',purchase_order_lines:[{quantity:100,sack_count:2}]}],payments:[],canManage:true};
let laborMarkup=renderToStaticMarkup(React.createElement(LaborManager,{...laborProps,view:'laborers'}));
assert.ok(laborMarkup.includes('New laborer'));assert.ok(!laborMarkup.includes('Morning team'));

for(const [paid,status] of [[0,'Unpaid'],[100,'Partially paid'],[200,'Paid']]){
 delete require.cache[require.resolve('../app/dashboard/labor/labor-manager.tsx')];
 const FreshLaborManager=require('../app/dashboard/labor/labor-manager.tsx').LaborManager;
 laborMarkup=renderToStaticMarkup(React.createElement(FreshLaborManager,{...laborProps,view:'sessions',sessionId:'s',payments:[{session_id:'s',laborer_id:'w',amount:paid}]}));
 assert.ok(laborMarkup.includes(status));assert.ok(laborMarkup.includes('Worker One'));assert.ok(laborMarkup.includes('200.00'));assert.equal(laborMarkup.includes('Pay wages'),paid<200);
}
console.log('PASS: labor menus, worker list, session wages and payment statuses.');

for(const [filter,visible] of [['Paid',false],['Unpaid',true],['due',true],['Partially paid',false]]){
 laborFilter=filter;delete require.cache[require.resolve('../app/dashboard/labor/labor-manager.tsx')];
 const M=require('../app/dashboard/labor/labor-manager.tsx').LaborManager;
 const markup=renderToStaticMarkup(React.createElement(M,{...laborProps,view:'sessions',sessionId:'s'}));
 assert.equal(markup.includes('labor-wage-row'),visible);
}
console.log('PASS: dedicated session details and worker payment filters.');
