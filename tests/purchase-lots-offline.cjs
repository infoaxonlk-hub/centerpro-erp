const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {splitPurchaseLotRow,purchaseRowsTotal}=load('lib/purchase-lots.ts');
function load(file,globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require,console,setTimeout,clearTimeout,...globals},{filename:file});return module.exports;}
for(const quantity of [0.003,1,1.333,100.125]){
 const row={key:'original',quantity,sack_count:4,actual_price:10,lot_selection:{mode:'number',number:'ORIGINAL'}};
 const {remaining,split}=splitPurchaseLotRow(row,.001,1,true);
 assert.equal(Math.round((remaining.quantity+split.quantity)*1000),Math.round(quantity*1000));assert.equal(remaining.sack_count+split.sack_count,4);assert.equal(split.actual_price,10);assert.equal(remaining.lot_selection.number,'ORIGINAL');assert.equal(split.lot_selection.mode,'auto');
}
for(const [qty,sacks]of[[0,1],[10,1],[.0001,1],[1,0],[1,4],[1,1.5]])assert.throws(()=>splitPurchaseLotRow({quantity:10,sack_count:4},qty,sacks,true));
assert.equal(purchaseRowsTotal([{quantity:.666,actual_price:.01},{quantity:.667,actual_price:.01}]),.02);
const {mapLotReceipt}=load('lib/purchase-lot-receipts.ts');
assert.equal(mapLotReceipt({id:'r',received_quantity:2,unit_purchase_price:10,unit_of_measure:'KG',received_at:'2026-10-28',purchase_id:'p',purchase_lots:{lot_number:'LOT'},products:{name:'Product',code:'P',unit_of_measure:'UNIT'},product_qualities:null,purchase_orders:null,centers:null,locations:null}).unit,'KG');
const stores=new Map();
const db={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore(name,options){stores.set(name,{key:options.keyPath,rows:new Map()});},close(){},transaction(name){const tx={objectStore(){const store=stores.get(name);const request=run=>{const req={};setTimeout(()=>{req.result=run();req.onsuccess?.();tx.oncomplete?.()},0);return req;};return{put:value=>request(()=>{store.rows.set(value[store.key],structuredClone(value));return value[store.key]}),get:key=>request(()=>structuredClone(store.rows.get(key))),delete:key=>request(()=>store.rows.delete(key)),getAll:()=>request(()=>structuredClone([...store.rows.values()]))}}};return tx;}};
const indexedDB={open(){const req={result:db};setTimeout(()=>{req.onupgradeneeded?.();req.onsuccess?.()},0);return req;}};
const pos=load('lib/offline-pos.ts',{indexedDB,navigator:{onLine:true}});
(async()=>{
 const callsToPage=[];
 const query={select(_columns,options){assert.equal(options.count,'exact');return this},eq(key,value){callsToPage.push(['eq',key,value]);return this},ilike(key,value){callsToPage.push(['ilike',key,value]);return this},order(){return this},async range(a,b){callsToPage.push(['range',a,b]);return{data:[],error:null,count:49}}};
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const Page=load('app/dashboard/purchases/lots/page.tsx',{require(id){
  if(id==='@/lib/access')return{requirePermission:async permission=>{assert.equal(permission,'purchases');return{profile:{organization_id:'business'},supabase:{from:table=>{assert.equal(table,'purchase_lot_receipts');return query}}}}};
  if(id==='@/lib/purchase-lot-receipts')return load('lib/purchase-lot-receipts.ts');
  if(id==='@/components/purchase-lot-receipts')return{PurchaseLotReceipts:()=>null};
  if(id==='next/link')return{__esModule:true,default:({href,children,...props})=>React.createElement('a',{href,...props},children)};
  return require(id);
 }}).default;
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({search:'A_%',page:'2'})}));
 assert.ok(html.includes('Page 2 of 3'));assert.ok(html.includes('Previous'));assert.ok(html.includes('Next'));assert.deepEqual(callsToPage,[['eq','organization_id','business'],['ilike','purchase_lots.lot_number','%A\\_\\%%'],['range',24,47]]);
 const choices=[{mode:'auto'},{mode:'number',number:'MANUAL'},{mode:'existing',lot_id:'existing-id',number:'EXISTING'}];
 const lines=choices.map((lot_selection,index)=>({product_id:'p',quality_id:'q',location_id:'l',quantity:index+1,actual_price:[7.55,14,19][index],lot_selection}));
 const draft={lines,entryMode:'detailed'};await pos.savePosDraft('purchase:user:held',draft);
 assert.deepEqual(JSON.parse(JSON.stringify(await pos.loadPosDraft('purchase:user:held'))),draft);
 assert.deepEqual(JSON.parse(JSON.stringify((await pos.listPosDrafts('purchase:user'))[0].value)),draft);
 const task={requestId:'same-request',scopeId:'user',kind:'purchase',createdAt:new Date().toISOString(),payload:{centerId:'c',supplierId:'s',lines,payments:[{method:'credit',amount:92.55}],purchaseMode:'detailed',sackCounts:[{sack_count:1},{sack_count:2},{sack_count:3}],laborSessionId:'labor',laborLoadCount:2}};
 await pos.enqueuePosTask(task);let calls=[];
 const client={async rpc(name,args){calls.push(JSON.parse(JSON.stringify({name,args})));return calls.length===1?{error:{message:'Failed to fetch'}}:{data:[{purchase_id:'same-purchase'}],error:null}}};
 assert.equal((await pos.syncPosTasks(client,'user')).length,0);assert.equal((await pos.listPosTasks('user')).length,1);
 const completed=await pos.syncPosTasks(client,'user');assert.equal(completed[0].id,'same-purchase');assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].name,'confirm_queued_purchase_with_lots');assert.deepEqual(calls[0].args.purchase_lines,lines);assert.deepEqual(calls[0].args.purchase_sack_counts,task.payload.sackCounts);assert.equal(calls[0].args.p_request,'same-request');assert.equal(calls[0].args.p_labor_session,'labor');assert.equal((await pos.listPosTasks('user')).length,0);
 console.log('PASS receipt search/pagination, exact quantity/sack splits, existing per-line totals, held lot choices, offline serialization, lost-response retry and unchanged sack/labor payloads.');
})().catch(error=>{console.error(error);process.exitCode=1});
