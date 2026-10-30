const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
function harness(){const values=[];let cursor=0;return{react:{...React,useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]},useMemo:fn=>fn(),useEffect(){},useRef:v=>({current:v})},render(C,p){cursor=0;return C(p)}};}
function load(file,hooks,overrides={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,console,crypto:require('node:crypto').webcrypto,window:{confirm:()=>true},...overrides,require(id){if(id==='react')return hooks.react;if(id in overrides)return overrides[id];if(id==='@/lib/manufacturing-bom')return load('lib/manufacturing-bom.ts',hooks);if(id==='@/lib/production-cost-preview')return load('lib/production-cost-preview.ts',hooks);if(id==='../bom-fields')return load('app/dashboard/manufacturing/bom-fields.tsx',hooks);if(id.startsWith('@/')||id==='next/link')return new Proxy({},{get:()=>()=>null});return require(id)}},{filename:file});return m.exports;}
function elements(n,out=[]){if(!n||typeof n!=='object')return out;if(Array.isArray(n)){n.forEach(x=>elements(x,out));return out;}if(n.props){out.push(n);elements(n.props.children,out)}return out;}
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
const products=['raw','rice','bran','bag','packed'].map(id=>({id,code:id.toUpperCase(),name:id,unit_of_measure:id==='packed'||id==='bag'?'UNIT':'KG',can_be_sold:true,can_be_purchased:true,can_be_manufactured:true,tracks_purchase_lots:true,product_qualities:[{id:'q-'+id,name:'Standard',is_active:true,default_price:999}]}));
const centers=[{id:'c',code:'C',name:'Source',locations:[{id:'l',code:'MAIN',name:'Raw stock',is_default:true,is_active:true},{id:'l2',code:'FG',name:'Finished shelf',is_default:false,is_active:true},{id:'inactive',name:'Inactive shelf',is_active:false}]},{id:'d',name:'Destination',locations:[{id:'dl',code:'OUT',name:'By-product store',is_active:true,is_default:true}]}];
const bom={id:'bom',recipe_code:'BOM',name:'Rice BoM',revision:1,is_active:true,process_type:'milling',rice_variety:'',finished_product_id:'rice',finished_quality_id:'q-rice',finished_quantity:6,finished_unit:'KG',finished_cost_share:75,production_center_id:'c',source_location_id:'l',destination_center_id:'c',destination_location_id:'l2',package_size_kg:null,operation_name:'Mill',operation_cost_basis:'per_hour',operation_cost_rate:5,external_mill_fee_per_kg:0,
 manufacturing_bom_components:[{id:'component',product_id:'raw',quality_id:'q-raw',quantity:10,unit:'KG',input_kind:'raw_material',sequence:1}],manufacturing_bom_byproducts:[{id:'byproduct',product_id:'bran',quality_id:'q-bran',quantity:2,unit:'KG',destination_center_id:'d',destination_location_id:'dl',cost_share_percent:25,sequence:1}],manufacturing_bom_operations:[{id:'hours',name:'Mill hours',planned_quantity:1,cost_basis:'per_hour',cost_rate:5,sequence:1},{id:'kg',name:'Handling',planned_quantity:10,cost_basis:'per_kg',cost_rate:1,sequence:2}]};
const lots=[{center_id:'c',location_id:'l',product_id:'raw',quality_id:'q-raw',lot_id:'actual',lot_number:'ACTUAL',available_quantity:100,inventory_value:1000},{center_id:'d',location_id:'dl',product_id:'raw',quality_id:'q-raw',lot_id:'wrong-center',lot_number:'FOREIGN SOURCE',available_quantity:50,inventory_value:500}];
(async()=>{
 const hooks=harness(),calls=[],paths=[];let completions=0;
 const {BomManufacturingOrderForm:C}=load('app/dashboard/manufacturing/bom-order-form.tsx',hooks,{'next/navigation':{useRouter:()=>({push:p=>paths.push(p),replace:p=>paths.push(p),refresh(){}})},'@/lib/supabase/client':{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});if(name==='save_bom_manufacturing_order')return{data:[{order_id:args.p_order_id,order_number:'MO'}]};return ++completions===1?{error:{message:'Failed to fetch'}}:{error:null}}})}});
 const props={initialProcess:'milling',products,centers,lots,boms:[bom,{...bom,id:'inactive',is_active:false},{...bom,id:'other',finished_product_id:'bran'}],suppliers:[],expenses:[]};
 const render=()=>elements(hooks.render(C,props));
 const field=(label)=>{const e=render().find(e=>e.type==='label'&&text(e).startsWith(label));assert.ok(e,label);return elements(e).find(x=>x.type==='input'||x.type==='select')};
 field('Finished product').props.onChange({target:{value:'rice'}});field('Quantity to produce').props.onChange({target:{value:'12'}});
 assert.equal(elements(field('Matching active BoM')).filter(e=>e.type==='option'&&e.props.value).length,1);
 render().find(e=>e.type==='button'&&text(e).includes('Load / replace')).props.onClick();
 assert.equal(render().find(e=>e.props['aria-label']==='Actual consumption component').props.value,20);
 render().find(e=>e.props['aria-label']==='Actual consumption component').props.onChange({target:{value:'22'}});
 const selector=render().find(e=>e.props['aria-label']==='Source lot component');assert.ok(!text(selector).includes('FOREIGN SOURCE'));selector.props.onChange({target:{value:'actual'}});
 render().find(e=>e.props['aria-label']==='Actual operation hours').props.onChange({target:{value:'3'}});
 render().find(e=>e.props['aria-label']==='Actual output byproduct').props.onChange({target:{value:'3.5'}});
 assert.ok(render().some(e=>e.type==='strong'&&text(e).includes('257.00')));
 assert.ok(render().some(e=>text(e).includes('Destination')&&text(e).includes('By-product store')));
 // Rerenders / a changed target must not silently replace actual values.
 field('Quantity to produce').props.onChange({target:{value:'18'}});await render().find(e=>e.type==='button'&&text(e)==='Save draft').props.onClick();assert.equal(calls.length,0);
 assert.equal(render().find(e=>e.props['aria-label']==='Actual consumption component').props.value,22);field('Quantity to produce').props.onChange({target:{value:'12'}});
 await render().find(e=>e.type==='button'&&text(e)==='Save draft').props.onClick();
 const sent=calls[0].args.p_data;assert.equal(sent.bom_revision,1);assert.equal(sent.production_quantity,12);assert.equal(sent.inputs[0].quantity,22);assert.equal(sent.inputs[0].lot_id,'actual');assert.equal(sent.operations[0].actual_quantity,3);assert.equal(sent.operations[1].actual_quantity,22);assert.equal(sent.outputs[1].quantity,3.5);assert.equal(sent.outputs[0].destination_location_id,undefined);assert.equal(sent.operations[0].cost_rate,undefined);
 await render().find(e=>e.type==='button'&&text(e)==='Complete production').props.onClick();
 assert.ok(render().some(e=>e.props.role==='alert'&&text(e).includes('Failed to fetch')),'Completion error must remain visible beside the action buttons');
 await render().find(e=>e.type==='button'&&text(e)==='Complete production').props.onClick();
 assert.equal(new Set(calls.filter(c=>c.name==='save_bom_manufacturing_order').map(c=>c.args.p_order_id)).size,1);assert.equal(completions,2);assert.ok(paths.at(-1).startsWith('/dashboard/manufacturing/orders/'));
 // The editor has planned components/operations/destinations, never source lots.
 const eh=harness(),editorCalls=[];
 const{ManufacturingBomManager:E}=load('app/dashboard/manufacturing/recipes/bom-editor.tsx',eh,{'next/navigation':{useRouter:()=>({refresh(){}})},'@/lib/supabase/client':{createClient:()=>({rpc:async(name,args)=>{editorCalls.push({name,args});return{data:bom}}})}});
 const er=()=>elements(eh.render(E,{initialRecipes:[],products,centers}));
 er().find(e=>e.type==='button'&&text(e)==='Add BoM').props.onClick();
 er().find(e=>e.type?.name==='BomProductFields'&&e.props.output).props.onChange('rice','q-rice');
 er().find(e=>e.type?.name==='BomProductFields'&&!e.props.output).props.onChange('raw','q-raw');
 const nameField=er().find(e=>e.type==='label'&&text(e).startsWith('BoM name'));elements(nameField).find(e=>e.type==='input').props.onChange({target:{value:'Rice BoM'}});
 assert.ok(!er().some(e=>e.props.name==='lot_id'||e.props['aria-label']?.startsWith('Source lot')));
 er().find(e=>e.type==='button'&&text(e)==='Add operation').props.onClick();assert.ok(er().some(e=>text(e)==='Remove operation'));
 await er().find(e=>e.type==='form').props.onSubmit({preventDefault(){}});assert.equal(editorCalls[0].name,'save_manufacturing_bom');assert.equal(editorCalls[0].args.p_data.components[0].product_id,'raw');assert.equal(editorCalls[0].args.p_data.components[0].lot_id,undefined);assert.equal(editorCalls[0].args.p_data.finished_product_id,'rice');
 const{BomDestinationFields}=load('app/dashboard/manufacturing/bom-fields.tsx',eh);const locationElements=elements(BomDestinationFields({centers,centerId:'c',locationId:'l',onChange(){}}));assert.ok(!locationElements.some(e=>e.type==='option'&&e.props.value==='inactive'));assert.ok(!locationElements.some(e=>e.type==='option'&&e.props.value==='dl'));
 console.log('PASS BoM editor / matching product selection, scaled plans, preserved actuals, source scoping, actual labor/cost payload, configured destinations, no BoM lots, stable completion retry IDs.');
})().catch(e=>{console.error(e);process.exitCode=1});
