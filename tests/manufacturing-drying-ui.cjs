const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
function harness(){const values=[];let cursor=0;return{react:{...React,useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]},useMemo:fn=>fn(),useEffect(){},useRef:v=>({current:v})},render(C,p){cursor=0;return C(p)}};}
function load(file,hooks,overrides={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,console,crypto:require('node:crypto').webcrypto,window:{confirm:()=>true},...overrides,require(id){if(id==='react')return hooks.react;if(id in overrides)return overrides[id];if(id==='@/lib/manufacturing-bom')return load('lib/manufacturing-bom.ts',hooks);if(id.startsWith('@/')||id==='next/link')return new Proxy({},{get:()=>()=>null});return require(id)}},{filename:file});return m.exports;}
function elements(n,out=[]){if(!n||typeof n!=='object')return out;if(Array.isArray(n)){n.forEach(x=>elements(x,out));return out;}if(n.props){out.push(n);elements(n.props.children,out);}return out;}
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';

(async()=>{
 const hooks=harness(),calls=[],routes=[];
 const products=[
  {id:'raw',code:'RAW/PADDY',name:'Red Naadu Paddy',unit_of_measure:'KG',tracks_purchase_lots:true,can_be_manufactured:true,product_qualities:[{id:'q-raw',name:'Standard',is_active:true}]},
  {id:'dry',code:'DRY/PADDY',name:'Dry Red Naadu',unit_of_measure:'KG',tracks_purchase_lots:false,can_be_manufactured:true,product_qualities:[{id:'q-dry',name:'Standard',is_active:true}]}
 ];
 const centers=[{id:'c',name:'Main Center',locations:[{id:'raw-loc',name:'Raw Paddy',is_default:true,is_active:true},{id:'dry-loc',name:'Dry Paddy',is_default:false,is_active:true}]}];
 const lots=[{center_id:'c',location_id:'raw-loc',product_id:'raw',quality_id:'q-raw',lot_id:'dry-lot',lot_number:'DRY-RAW-001',available_quantity:200,inventory_value:2200}];
 const bom={id:'dry-bom',recipe_code:'DRY-RED-001',name:'Red Naadu Drying',process_type:'drying',rice_variety:'',revision:1,is_active:true,finished_product_id:'dry',finished_quality_id:'q-dry',finished_quantity:88,finished_unit:'KG',finished_cost_share:100,production_center_id:'c',source_location_id:'raw-loc',destination_center_id:'c',destination_location_id:'dry-loc',package_size_kg:null,external_mill_fee_per_kg:0,
  manufacturing_bom_components:[{id:'dry-component',product_id:'raw',quality_id:'q-raw',quantity:100,unit:'KG',input_kind:'raw_material',sequence:1}],
  manufacturing_bom_byproducts:[],
  manufacturing_bom_operations:[{id:'dry-operation',name:'Drying Labor',planned_quantity:100,cost_basis:'per_kg',cost_rate:1,sequence:1}]
 };
 const overrides={
  'next/navigation':{useRouter:()=>({push:p=>routes.push(p),replace:p=>routes.push(p),refresh(){}})},
  '@/components/feedback':{notify(){}},
  '@/lib/supabase/client':{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});return name==='save_bom_manufacturing_order'?{data:[{order_id:args.p_order_id,order_number:'MO-DRY'}]}:{data:null};}})},
  '@/lib/production-cost-preview':{
   productionMaterialPreview:()=>1100,
   productionAllocationPreview:inputs=>inputs.map(i=>({available:200,required:Number(i.quantity),remaining:200-Number(i.quantity),shortage:Math.max(0,Number(i.quantity)-200),allocations:[]} ))
  }
 };
 const {BomManufacturingOrderForm:C}=load('app/dashboard/manufacturing/bom-order-form.tsx',hooks,overrides);
 const props={initialProcess:'drying',boms:[bom],centers,products,lots,suppliers:[],expenses:[]};
 const render=()=>elements(hooks.render(C,props));
 const field=(label)=>{const e=render().find(x=>x.type==='label'&&text(x).startsWith(label));assert.ok(e,'Missing field '+label);return elements(e).find(x=>x.type==='input'||x.type==='select');};
 field('Finished product').props.onChange({target:{value:'dry'}});
 field('Raw paddy / input quantity').props.onChange({target:{value:'100'}});
 assert.equal(field('Quantity to produce').props.value,'88','100 KG raw paddy must calculate to 88 KG dried paddy');
 assert.ok(render().some(e=>e.type==='option'&&e.props.value==='drying'),'Drying is an available process');
 render().find(e=>e.type==='button'&&text(e).includes('Load / replace BoM plan')).props.onClick();
 assert.equal(render().find(e=>e.props['aria-label']==='Actual consumption dry-component').props.value,100);
 render().find(e=>e.props['aria-label']==='Source lot dry-component').props.onChange({target:{value:'dry-lot'}});
 render().find(e=>e.props['aria-label']==='Actual output finished').props.onChange({target:{value:'86'}});
 assert.ok(render().some(e=>e.type==='p'&&text(e).includes('Drying loss: 14 kg')),'The form should calculate actual drying loss');
 await render().find(e=>e.type==='button'&&text(e)==='Save draft').props.onClick();
 const saved=calls.find(x=>x.name==='save_bom_manufacturing_order').args.p_data;
 assert.equal(saved.process_type,undefined,'The process is derived from the selected BoM snapshot');
 assert.equal(saved.method,'own','Drying orders must use the in-house processing method');
 assert.equal(saved.supplier_id,null,'Drying orders must not be assigned an external mill supplier');
 assert.equal(saved.production_quantity,88);
 assert.equal(saved.inputs[0].lot_id,'dry-lot','Raw paddy purchase lot is recorded');
 assert.equal(saved.outputs[0].quantity,86);
 assert.equal(saved.operations[0].actual_quantity,100,'Per-KG drying labor uses actual input weight');
 assert.ok(routes.some(x=>x.includes('/dashboard/manufacturing/orders/')));
 console.log('PASS Drying order UI: 100 KG → 88 KG BoM scaling, raw paddy lot selection, 86 KG actual output, 14 KG loss, in-house method and per-KG labor payload.');
})().catch(e=>{console.error(e);process.exitCode=1});
