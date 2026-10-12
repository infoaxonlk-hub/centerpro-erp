/* Run: node tests/navigation-regression.cjs. No database or network calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let navPath='/dashboard',mode='cards',selectedGroup=null,partySelected=null,partyView='profile';
const original=Module._load;
Module._load=function(id,parent,...rest){
 if(id.endsWith('.css'))return {};
 if(id==='next/navigation')return {usePathname:()=>navPath,useRouter:()=>({})};
 if(id==='next/link')return {__esModule:true,default:({children,href,...p})=>React.createElement('a',{href,...p},children)};
 if(id.includes('offline-pos-link'))return {OfflinePosLink:({children,href,...p})=>React.createElement('a',{href,...p},children)};
 if(id.includes('product-image-actions'))return {saveProductImage:()=>{throw Error('Unexpected mutation')}};
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
for(const m of ['cards','apps','list']){mode=m;const html=appearance();assert.ok(html.includes('appearance-'+m));if(m==='cards')assert.ok(html.includes('launcher-sections'));if(m==='apps')assert.ok(!html.includes('launcher-sections'));}
mode='cards';selectedGroup='/dashboard/purchases';let html=appearance();for(const name of ['New purchase','Purchase orders','Products','Suppliers'])assert.ok(html.includes(name));
selectedGroup='/dashboard';assert.ok(appearance().includes('launcher-dashboard-open'));selectedGroup=null;
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
