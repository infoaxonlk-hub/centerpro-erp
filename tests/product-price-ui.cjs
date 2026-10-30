const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
function load(file,overrides={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,console,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,...overrides,require:overrides.require??require},{filename:file});return module.exports;}
const defaults=load('lib/product-price-defaults.ts');
const latest=[{product_id:'p',quality_id:'q',price:14,confirmed_at:'2026-10-29',purchase_id:'po',line_id:'pol'}];
assert.equal(defaults.purchasePriceDefault('q',9,latest),14);
assert.equal(defaults.purchasePriceDefault('missing',9,latest),9);
assert.equal(defaults.purchasePriceDefault('q',9,[{...latest[0],price:0}]),0);
assert.equal(defaults.salesPriceDefault(25,17),25);
assert.equal(defaults.salesPriceDefault(null,17),17);
assert.equal(defaults.salesPriceDefault(undefined,undefined),0);

function harness(){let values=[],cursor=0;return{react:{...React,useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value}]},useRef(initial){const index=cursor++;return values[index]??(values[index]={current:initial})},useMemo:fn=>fn(),useEffect(){},useLayoutEffect(){}},render(Component,props){cursor=0;return Component(props)}};}
function elements(node,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(n=>elements(n,result));return result;}if(node.props){result.push(node);elements(node.props.children,result);}return result;}
const Detailed=()=>null,Lot=()=>null;
const center={id:'c',code:'C',name:'Center',allow_multiple_locations:false,locations:[{id:'l',code:'MAIN',name:'Main',is_default:true,is_active:true}]};
const product={id:'p',code:'P',name:'Product',category:null,unit_of_measure:'KG',tracks_purchase_lots:true,product_qualities:[{id:'q',name:'Standard',default_price:9,is_base:true,is_active:true}]};
function purchaseCase(sacks){
 const hooks=harness();let remembered=latest;
 const {PurchaseForm}=load('app/dashboard/purchases/new/purchase-form.tsx',{require(id){
  if(id==='react')return hooks.react;
  if(id==='@/lib/product-price-defaults')return defaults;
  if(id==='@/lib/use-purchase-price-defaults')return{usePurchasePriceDefaults:()=>remembered};
  if(id==='@/lib/purchase-lots')return load('lib/purchase-lots.ts');
  if(id==='@/lib/purchase-quantity-summary')return load('lib/purchase-quantity-summary.ts');
  if(id==='./detailed-purchase-entry')return{DetailedPurchaseEntry:Detailed};
  if(id==='./purchase-lot-fields')return{PurchaseLotFields:Lot};
  if(id.startsWith('@/')||id==='next/link')return new Proxy({},{get:()=>()=>null});
  return require(id);
 }});
 const props={centers:[center],suppliers:[],organizationId:'org',scopeId:'user',products:[{...product,tracks_sacks:sacks}],prices:[{center_id:'c',quality_id:'q',price:999}],latestPrices:latest,bankAccounts:[],organizationName:'Test',userName:'Admin',laborSessions:[]};
 const render=()=>elements(hooks.render(PurchaseForm,props));
 render().find(e=>e.type==='button'&&e.props.className?.startsWith('pos-product ')).props.onClick();
 if(sacks){
  let view=render().find(e=>e.type===Detailed);assert.equal(view.props.visibleLines[0].actual_price,14);
  const key=view.props.visibleLines[0].key;view.props.onUpdateLine(key,{actual_price:7.55});
  remembered=[{...latest[0],price:88}];view=render().find(e=>e.type===Detailed);assert.equal(view.props.visibleLines[0].actual_price,7.55);
  view.props.onUpdateLine(key,{lot_selection:{mode:'existing',lot_id:'old-lot'}});
  view=render().find(e=>e.type===Detailed);assert.equal(view.props.visibleLines[0].actual_price,7.55);
  assert.equal(view.props.onSplitLot,undefined);view.props.onAddWeightRow(view.props.visibleLines[0]);
  view=render().find(e=>e.type===Detailed);assert.equal(view.props.visibleLines[1].actual_price,7.55);assert.equal(view.props.visibleLines[1].lot_selection.lot_id,'old-lot');
 }else{
  assert.equal(render().find(e=>e.props['data-price']===0).props.value,14);
  render().find(e=>e.props['data-price']===0).props.onChange({target:{value:'7.55'}});
  remembered=[{...latest[0],price:88}];assert.equal(render().find(e=>e.props['data-price']===0).props.value,7.55);
  render().find(e=>e.type===Lot).props.onChange({mode:'existing',lot_id:'old-lot'});
  assert.equal(render().find(e=>e.props['data-price']===0).props.value,7.55);
 }
}
purchaseCase(false);purchaseCase(true);

// Exercise the real cache/refresh hook without a server or browser. A later
// confirmed-price refresh changes the next default only, never draft rows.
(async()=>{
 const masterHooks=harness(),rpcCalls=[];
 const existing={...product,is_active:true,default_sales_price:25,costing_method:'FIFO'};
 const {MastersManager}=load('app/dashboard/masters/masters-manager.tsx',{require(id){
  if(id==='react')return masterHooks.react;
  if(id==='@/lib/supabase/client')return{createClient:()=>({async rpc(name,args){rpcCalls.push({name,args});return{error:null};},from(){return{select(){return{async order(){return{data:[existing]};}};}};}})};
  if(id.endsWith('.css'))return{};
  if(id.startsWith('@/')||id==='./product-import')return new Proxy({},{get:()=>()=>null});
  return require(id);
 }});
 const masterProps={organizationId:'org',canManage:true,canCreateProduct:true,canEditProduct:true,initialProducts:[existing],initialCategories:[],initialSuppliers:[],centers:[],initialPrices:[]};
 const renderMaster=()=>elements(masterHooks.render(MastersManager,masterProps));
 const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
 renderMaster().find(e=>e.type==='button'&&text(e)==='Add product').props.onClick();
 let form=renderMaster().find(e=>e.type==='form');
 for(const name of ['price','sales_price','costing_method','tracks_purchase_lots'])assert.ok(elements(form).some(e=>e.props.name===name));
 const fd={has:()=>true,get:name=>({code:'P',name:'Product',unit:'KG',price:'9',sales_price:'25',costing_method:'FIFO',tracks_purchase_lots:'yes',tracks_sacks:'no'})[name]??null};
 await form.props.action(fd);assert.equal(rpcCalls[0].args.global_price,9);assert.equal(rpcCalls[0].args.product_default_sales_price,25);assert.equal(rpcCalls[0].args.product_costing_method,'FIFO');
 renderMaster().find(e=>e.type==='button'&&text(e)==='Edit').props.onClick();form=renderMaster().find(e=>e.type==='form');
 for(const name of ['purchase_q','sales_price','costing_method','tracks_purchase_lots'])assert.ok(elements(form).some(e=>e.props.name===name));
 assert.equal(elements(form).find(e=>e.props.name==='sales_price').props.defaultValue,25);
 await form.props.action({has:()=>true,get:name=>name==='purchase_q'?'11':fd.get(name)});
 assert.equal(rpcCalls[1].name,'edit_product_defaults');assert.equal(rpcCalls[1].args.p_prices[0].price,11);assert.equal(rpcCalls[1].args.p_sales,25);

 const salesHooks=harness();const {SalesPOS}=load('app/dashboard/sales/sales-pos.tsx',{require(id){
  if(id==='react')return salesHooks.react;
  if(id==='@/lib/product-price-defaults')return defaults;
  if(id==='./types')return load('app/dashboard/sales/types.ts');
  if(id.endsWith('.css'))return{};
  if(id.startsWith('@/')||id==='next/link'||id==='./detailed-sales-entry')return new Proxy({},{get:()=>()=>null});
  return require(id);
 }});
 const salesProps={organizationId:'org',scopeId:'user',centers:[center],customers:[],products:[{...product,default_sales_price:25}],prices:[{center_id:'c',quality_id:'q',price:17}],banks:[],laborSessions:[]};
 let salesElements=elements(salesHooks.render(SalesPOS,salesProps));assert.ok(salesElements.some(e=>e.type==='b'&&text(e).includes('25.00')));
 salesProps.products=[{...product,default_sales_price:null}];salesElements=elements(salesHooks.render(SalesPOS,salesProps));assert.ok(salesElements.some(e=>e.type==='b'&&text(e).includes('17.00')));

 const stockHooks=harness();const {StockView}=load('app/dashboard/stock/stock-view.tsx',{require(id){
  if(id==='react')return stockHooks.react;
  if(id==='@/lib/stock-summary')return load('lib/stock-summary.ts');
  if(id==='@/lib/stock-view-preference')return{useStockViewPreference:()=>['cards',()=>{}],stockViewOptions:[]};
  if(id.endsWith('.css'))return{};
  if(id==='next/link')return{__esModule:true,default:()=>null};
  if(id.startsWith('@/'))return{};
  return require(id);
 }});
 const balance={key:'c:l:p:q',centerId:'c',locationId:'l',productId:'p',qualityId:'q',center:'Center',location:'Main',product:'Product',productCode:'P',category:'Other',quality:'Standard',unit:'KG',qty:7,value:70};
 const lotBalances=[{...balance,lotId:null,lotNumber:'Unassigned / Legacy',quantity:5},{...balance,lotId:'a',lotNumber:'LOT-A',quantity:2}];
 const stockProps={initialStock:[balance],lotBalances,fsnMovements:[],isAdmin:true,canAdjust:true,asOf:new Date().toISOString()};
 const renderStock=()=>elements(stockHooks.render(StockView,stockProps));
 const labelControl=(nodes,label)=>elements(nodes.find(e=>e.type==='label'&&text(e).startsWith(label))).find(e=>e.type==='input'||e.type==='select');
 labelControl(renderStock(),'Search Lot / Batch').props.onChange({target:{value:'LOT-A'}});
 let lotSection=renderStock().find(e=>e.props['aria-label']==='Current lot stock');assert.ok(text(lotSection).includes('LOT-A'));assert.ok(!text(lotSection).includes('Unassigned / Legacy'));assert.ok(text(lotSection).includes('Current available quantity2KG'));
 labelControl(renderStock(),'Search Lot / Batch').props.onChange({target:{value:''}});
 labelControl(renderStock(),'Lot / Batch view').props.onChange({target:{value:'unassigned'}});
 lotSection=renderStock().find(e=>e.props['aria-label']==='Current lot stock');assert.ok(text(lotSection).includes('Unassigned / Legacy'));assert.ok(!text(lotSection).includes('LOT-A'));
 labelControl(renderStock(),'Location').props.onChange({target:{value:'Different'}});lotSection=renderStock().find(e=>e.props['aria-label']==='Current lot stock');assert.ok(text(lotSection).includes('No available lot stock'));

 let effect,state;const storage=new Map(),listeners=new Map();const navigator={onLine:true};let price=14,calls=0,fail=false;
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const {usePurchasePriceDefaults}=load('lib/use-purchase-price-defaults.ts',{navigator,window,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},require(id){
  if(id==='react')return{useState(initial){state=initial;return[state,value=>{state=value}]},useEffect(fn){effect=fn}};
  if(id==='@/lib/supabase/client')return{createClient:()=>({rpc(name){
   assert.equal(name,'latest_purchase_prices');
   return{async range(){calls++;return fail?{error:{message:'Network error'}}:{data:[{...latest[0],price}],error:null};}};
  }})};
  return require(id);
 }});
 usePurchasePriceDefaults('org','user',[]);const cleanup=effect();
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));await tick();assert.equal(state[0].price,14);
 const draft={actual_price:7.55,lot_selection:{mode:'existing',lot_id:'old'}};
 price=19;await listeners.get('centerpro-purchase-confirmed')();assert.equal(state[0].price,19);assert.equal(draft.actual_price,7.55);
 fail=true;await listeners.get('focus')();assert.equal(state[0].price,19);
 navigator.onLine=false;state=[];const before=calls;await listeners.get('focus')();assert.equal(calls,before);assert.equal(state[0].price,19);
 assert.ok(storage.has('centerpro:purchase-prices:org:user'));cleanup();assert.equal(listeners.size,0);
 console.log('PASS purchase POS and detailed latest-price initialization, center override exclusion, manual/lot price preservation, future-default refresh, scoped offline cache, sales configured/legacy defaults.');
})().catch(error=>{console.error(error);process.exitCode=1});
