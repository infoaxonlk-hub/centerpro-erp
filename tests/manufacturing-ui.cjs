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
const hooks=harness(),calls=[],paths=[];let completionAttempts=0;
const {ManufacturingOrderForm}=load('app/dashboard/manufacturing/manufacturing-order-form.tsx',{require(id){
 if(id==='react')return hooks.react;
 if(id==='@/lib/production-cost-preview')return load('lib/production-cost-preview.ts');
 if(id==='next/navigation')return{useRouter:()=>({push:path=>paths.push(path),refresh(){}})};
 if(id==='@/components/feedback')return{notify(){}};
 if(id==='@/lib/supabase/client')return{createClient:()=>({async rpc(name,args){calls.push({name,args:structuredClone(args)});if(name==='save_manufacturing_order')return{data:[{order_id:args.p_order_id,order_number:'MO-TEST'}],error:null};completionAttempts++;return completionAttempts===1?{error:{message:'Failed to fetch'}}:{error:null};}})};
 if(id==='next/link')return{__esModule:true,default:()=>null};
 return require(id);
}});
const draft={id:'saved-draft',order_number:'MO-TEST',process_type:'milling',method:'own',center_id:'c',location_id:'l',order_date:'2026-10-29',rice_variety:'Standard',recipe_id:null,supplier_id:null,operation_expense_id:'labor-expense',operation_cost_basis:'per_kg',operation_cost_rate:2,operation_hours:0,external_mill_fee_per_kg:0,notes:'Keep this note',manufacturing_order_inputs:[{id:'i',input_kind:'raw_material',product_id:'p',quality_id:'q',lot_id:'lot',quantity:20,sack_count:2}],manufacturing_order_outputs:[{id:'o',output_kind:'main',product_id:'out',quality_id:'outq',quantity:15,sack_count:0,cost_share_percent:100}]};
const props={initialOrder:draft,initialProcess:'milling',centers:[center],products:[{...product,tracks_sacks:true},{...product,id:'out',product_qualities:[{...product.product_qualities[0],id:'outq'}]}],lots:[{center_id:'c',location_id:'l',product_id:'p',quality_id:'q',lot_id:'lot',lot_number:'LOT',available_quantity:100,inventory_value:1000}],recipes:[],suppliers:[],expenses:[{id:'labor-expense',center_id:'c',payee:'Labor',amount:30,expense_date:'2026-10-29',reference:null}]};
const render=()=>elements(hooks.render(ManufacturingOrderForm,props));
function text(node){return typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';}
const button=label=>render().find(e=>e.type==='button'&&text(e).toLowerCase().includes(label));
(async()=>{
 assert.ok(render().some(e=>e.type==='input'&&e.props.value==='Keep this note')||render().some(e=>e.type==='textarea'&&e.props.value==='Keep this note'));
 assert.ok(render().some(e=>e.type==='label'&&text(e).includes('Sack count (0 for loose stock)')));
 assert.ok(render().some(e=>e.type==='strong'&&text(e)==='LKR 230.00'));
 await button('save draft').props.onClick();
 assert.equal(calls[0].args.p_order_id,'saved-draft');assert.equal(calls[0].args.p_data.inputs[0].quantity,20);assert.equal(calls[0].args.p_data.inputs[0].sack_count,2);assert.equal(calls[0].args.p_data.inputs[0].lot_id,'lot');
 assert.equal(calls[0].args.p_data.operation_expense_id,'labor-expense');assert.equal(calls[0].args.p_data.outputs[0].cost_share_percent,100);
 await button('complete').props.onClick();await button('complete').props.onClick();
 assert.deepEqual(calls.filter(c=>c.name==='save_manufacturing_order').map(c=>c.args.p_order_id),['saved-draft','saved-draft','saved-draft']);
 assert.equal(calls.filter(c=>c.name==='complete_manufacturing_order').length,2);assert.equal(paths.at(-1),'/dashboard/manufacturing');
 const {ManufacturingWorkspace}=load('app/dashboard/manufacturing/workspace.tsx',{require(id){if(id==='react')return harness().react;if(id==='next/link')return{__esModule:true,default:()=>null};return require(id);}});
 const list=elements(ManufacturingWorkspace({orders:[{id:'saved-draft',order_number:'MO',process_type:'milling',method:'own',status:'draft',rice_variety:'Standard',created_at:'2026-10-29',total_cost:0,manufacturing_order_inputs:[{quantity:20,input_kind:'raw_material'}]}]}));
 assert.ok(list.some(e=>e.props.href==='/dashboard/manufacturing/orders/saved-draft'));
 console.log('PASS restored manufacturing drafts, sack/lot payloads, stable retry IDs, completion retries and order detail navigation');
})().catch(error=>{console.error(error);process.exitCode=1});
