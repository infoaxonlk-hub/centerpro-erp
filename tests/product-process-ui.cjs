const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
function harness(){const values=[];let cursor=0;return{react:{...React,useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]},useRef(v){const i=cursor++;return values[i]??(values[i]={current:v})},useMemo:fn=>fn(),useEffect(){},useLayoutEffect(){}},render(Component,props){cursor=0;return Component(props)}};}
function elements(node,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(n=>elements(n,result));return result;}if(node.props){result.push(node);elements(node.props.children,result);}return result;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
function load(file,hooks,overrides={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,console,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,require(id){if(id==='react')return hooks.react;if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};if(id==='@/lib/product-price-defaults')return load('lib/product-price-defaults.ts',hooks);if(id==='@/lib/purchase-lots')return load('lib/purchase-lots.ts',hooks);if(id.startsWith('@/')||id==='next/link')return new Proxy({},{get:()=>()=>null});return require(id)}},{filename:file});return module.exports;}
const center={id:'c',code:'C',name:'Center',allow_multiple_locations:false,locations:[{id:'l',code:'MAIN',name:'Main',is_default:true,is_active:true}]};
const products=Array.from({length:8},(_,mask)=>({id:'p'+mask,code:'P'+mask,name:'Product'+mask,category:null,unit_of_measure:'KG',is_active:true,can_be_sold:!!(mask&1),can_be_purchased:!!(mask&2),can_be_manufactured:!!(mask&4),tracks_purchase_lots:true,product_qualities:[{id:'q'+mask,name:'Standard',default_price:10,is_active:true,is_base:true}]}));
(async()=>{
 for(const product of products){
  const hooks=harness(),calls=[];
  const{MastersManager}=load('app/dashboard/masters/masters-manager.tsx',hooks,{'./product-import':{ProductImport:()=>null},'@/lib/supabase/client':{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{}},from:()=>({select:()=>({order:async()=>({data:[product]})})})})}});
  const props={organizationId:'org',canManage:true,canCreateProduct:true,canEditProduct:true,initialProducts:[product],initialCategories:[],initialSuppliers:[],centers:[],initialPrices:[]};
  const render=()=>elements(hooks.render(MastersManager,props));
  render().find(e=>e.type==='button'&&text(e)==='Add product').props.onClick();
  let form=render().find(e=>e.type==='form');
  for(const name of ['can_be_sold','can_be_purchased','can_be_manufactured'])assert.equal(elements(form).find(e=>e.props.name===name).props.defaultChecked,true);
  const fd={has:name=>product[name]===true,get:name=>({code:product.code,name:product.name,unit:'KG',price:'10',sales_price:'20',costing_method:'AVCO'})[name]??'10'};
  await form.props.action(fd);
  for(const name of ['can_be_sold','can_be_purchased','can_be_manufactured'])assert.equal(calls[0].args['product_'+name],product[name]);
  render().find(e=>e.type==='button'&&text(e)==='Edit').props.onClick();form=render().find(e=>e.type==='form');
  for(const name of ['can_be_sold','can_be_purchased','can_be_manufactured'])assert.equal(elements(form).find(e=>e.props.name===name).props.defaultChecked,product[name]);
  await form.props.action(fd);assert.equal(calls[1].args.p_sold,product.can_be_sold);assert.equal(calls[1].args.p_purchased,product.can_be_purchased);assert.equal(calls[1].args.p_manufactured,product.can_be_manufactured);
 }
 const detailedMarker=()=>null,lotMarker=()=>null,hooks=harness(),notifications=[];
 const {PurchaseForm}=load('app/dashboard/purchases/new/purchase-form.tsx',hooks,{'./detailed-purchase-entry':{DetailedPurchaseEntry:detailedMarker},'./purchase-lot-fields':{PurchaseLotFields:lotMarker},'@/components/feedback':{notify:(...args)=>notifications.push(args)},'@/lib/use-purchase-price-defaults':{usePurchasePriceDefaults:()=>[]}});
 const props={centers:[center],suppliers:[],organizationId:'org',scopeId:'user',products,prices:[],latestPrices:[],bankAccounts:[],laborSessions:[],organizationName:'Test',userName:'Admin'};
 const render=()=>elements(hooks.render(PurchaseForm,props));
 const cards=render().filter(e=>e.type==='button'&&e.props.className?.startsWith('pos-product '));
 assert.equal(cards.length,4);for(const card of cards)assert.ok(![0,1,4,5].some(mask=>text(card).includes('Product'+mask)));
 cards[0].props.onClick();cards[0].props.onClick(); // Batched stale events cannot create duplicates.
 render().find(e=>e.type==='button'&&e.props.className?.startsWith('pos-product ')).props.onClick();
 assert.equal(render().filter(e=>e.type===lotMarker).length,1);assert.ok(notifications.some(n=>n[0].includes('single lot/weighing')));
 // Detailed view provides no add-weighing or split callback, even for restored rows.
 render().find(e=>e.type==='select'&&e.props['aria-label']==='Purchase view').props.onChange({target:{value:'detailed'}});
 const detail=render().find(e=>e.type===detailedMarker);assert.equal(detail.props.onAddWeightRow,undefined);assert.equal(detail.props.onSplitLot,undefined);
 const dh=harness(),{DetailedPurchaseEntry}=load('app/dashboard/purchases/new/detailed-purchase-entry.tsx',dh,{'./purchase-lot-fields':{PurchaseLotFields:lotMarker}});
 const dprops={...detail.props,visibleLines:[]};let de=elements(dh.render(DetailedPurchaseEntry,dprops));
 assert.equal(de.filter(e=>e.props.className==='detail-product-choice').length,4);
 const lotHooks=harness(),{PurchaseLotFields}=load('app/dashboard/purchases/new/purchase-lot-fields.tsx',lotHooks);
 assert.ok(!text(lotHooks.render(PurchaseLotFields,{organizationId:'org',productId:'p',qualityId:'q',onChange(){}})).includes('Split'));
 const sh=harness(),{SalesPOS}=load('app/dashboard/sales/sales-pos.tsx',sh,{'./types':load('app/dashboard/sales/types.ts',sh),'./detailed-sales-entry':{DetailedSalesEntry:()=>null}});
 const sales=elements(sh.render(SalesPOS,{...props,customers:[],banks:[]}));
 assert.equal(sales.filter(e=>e.type==='button'&&e.props.className==='pos-product').length,4);
 const dsh=harness(),{DetailedSalesEntry}=load('app/dashboard/sales/detailed-sales-entry.tsx',dsh,{'./types':load('app/dashboard/sales/types.ts',dsh)});
 const ds=elements(dsh.render(DetailedSalesEntry,{center,customers:[],customerId:'',products,lines:[],total:0,unitTotals:'',canCheckout:false,stockReady:true,stockError:'',isOnline:true,error:'',available:()=>10,used:()=>0,savedPrice:()=>20,invalidLine:()=>false}));
 assert.equal(ds.filter(e=>e.type==='button'&&e.props.className?.includes('detail-product-choice')).length,4);
 const mh=harness(),{ManufacturingOrderForm}=load('app/dashboard/manufacturing/manufacturing-order-form.tsx',mh,{'next/navigation':{useRouter:()=>({push(){},refresh(){}})}});
 const lots=products.map(p=>({center_id:'c',location_id:'l',product_id:p.id,quality_id:p.product_qualities[0].id,lot_id:'lot'+p.id,lot_number:'LOT',available_quantity:p.id==='p7'?0:10}));
 const mf=elements(mh.render(ManufacturingOrderForm,{initialProcess:'milling',centers:[center],products,lots,recipes:[],suppliers:[]}));
 const choices=mf.filter(e=>e.type==='select'&&elements(e).some(x=>x.type==='option'&&text(x)==='Select product'));
 assert.equal(choices.length,2);
 assert.deepEqual(elements(choices[0]).filter(e=>e.type==='option'&&e.props.value).map(e=>e.props.value),['p2','p3','p4','p5','p6']);
 assert.deepEqual(elements(choices[1]).filter(e=>e.type==='option'&&e.props.value).map(e=>e.props.value),['p4','p5','p6','p7']);
 console.log('PASS all process checkbox combinations create/edit, sales/purchase selectors, duplicate product prevention, no weighing/split actions, manufacturing inputs with stock and outputs without stock.');
})().catch(e=>{console.error(e);process.exitCode=1});
