import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import vm from "node:vm";
const require=createRequire(import.meta.url);
const ts=require("typescript");
const permissions=["dashboard","users","sales","purchases"];
const source=await readFile(new URL("../app/api/admin/businesses/route.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let state;
function reset(overrides={}) {
 state={user:{id:"platform-user"},profile:{role:"super_admin",is_active:true},calls:[],failure:null,...overrides};
}
function query(table) {
 let op;
 const q={
  select(){return q;},order(){return q;},eq(){return q;},
  insert(value){op="insert";state.calls.push({table,op,value});return q;},
  delete(){op="delete";state.calls.push({table,op});return q;},
  single:async()=>({data:{id:"business-id"},error:state.failure==="organization"?{message:"Business write failed"}:null}),
  then(resolve,reject) {
   return Promise.resolve({data:[],error:state.failure===table?{message:"Write failed"}:null}).then(resolve,reject);
  }
 };
 return q;
}
const service={
 from:query,
 auth:{admin:{
  createUser:async value=>{
   state.calls.push({op:"createAuth",value});
   return state.failure==="auth"?{data:{user:null},error:{message:"Email already registered"}}:{data:{user:{id:"new-admin"}},error:null};
  },
  deleteUser:async id=>{state.calls.push({op:"deleteAuth",id});return{error:null};}
 }}
};
const routeModule={exports:{}};
vm.runInNewContext(compiled,{
 module:routeModule,exports:routeModule.exports,console,Request,
 require(name){
  if(name==="next/server")return{NextResponse:{json:(data,options)=>Response.json(data,options)}};
  if(name==="zod")return require("zod");
  if(name==="@/lib/access")return{allPermissions:permissions};
  if(name==="@/lib/supabase/admin")return{createAdminClient:()=>{state.calls.push({op:"serviceClient"});return service;}};
  if(name==="@/lib/supabase/server")return{createClient:async()=>({
   auth:{getUser:async()=>({data:{user:state.user}})},
   from:()=>({select:()=>({eq:()=>({single:async()=>({data:state.profile,error:null})})})})
  })};
  throw new Error(name);
 }
});
const {GET,POST}=routeModule.exports;
const input={name:"Business A",adminName:"Admin A",email:"admin@example.test",password:"valid-password"};
const request=(body=input)=>new Request("http://localhost/api/admin/businesses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
for(const auth of [{user:null},{profile:{role:"admin",is_active:true}},{profile:{role:"super_admin",is_active:false}}]){
 reset(auth);
 assert.equal((await GET()).status,auth.user===null?401:403);
 assert.equal((await POST(request())).status,auth.user===null?401:403);
 assert.equal(state.calls.length,0);
}
console.log("PASS anonymous, business-admin and inactive callers cannot access business management");
reset();
assert.equal((await POST(request({...input,password:"short"}))).status,400);
assert.equal(state.calls.length,0);
reset();
const result=await POST(request());
assert.equal(result.status,201);
const body=await result.json();
assert.equal(body.id,"business-id");
assert.ok(!JSON.stringify(body).includes(input.password));
const profile=state.calls.find(c=>c.table==="profiles").value;
assert.equal(profile.organization_id,"business-id");
assert.equal(profile.role,"admin");
assert.deepEqual([...profile.permissions],permissions);
assert.equal(state.calls.find(c=>c.table==="audit_logs").value.actor_id,"platform-user");
console.log("PASS provisioning creates a business, scoped admin with permissions and audit without returning password");
for(const failure of ["organization","profiles","audit_logs"]){
 reset({failure});
 assert.equal((await POST(request())).status,400);
 assert.ok(state.calls.some(c=>c.op==="deleteAuth"));
 assert.equal(state.calls.some(c=>c.table==="organizations"&&c.op==="delete"),failure!=="organization");
}
reset({failure:"auth"});
assert.equal((await POST(request())).status,400);
assert.ok(!state.calls.some(c=>c.table==="organizations"));
reset();
assert.equal((await GET()).status,200);
console.log("PASS duplicate-email failures, compensating cleanup and authorized listing");
