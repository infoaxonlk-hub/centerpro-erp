const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,overrides){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,require:id=>id in overrides?overrides[id]:id.endsWith('.css')?{}:require(id),console});return m.exports;}
const redirect=url=>{throw Error('REDIRECT '+url)};let path,role='super_admin',operational=false,authFailure=null;
const query={data:[],select(){return this},eq(){return this},order(){return this},limit(){return this},async single(){return{data:{name:'Store'}}}};
const context=async()=>{if(authFailure)throw authFailure;return{supabase:{from:()=>query},profile:{id:'user',organization_id:'org',full_name:'Admin',role,permissions:['dashboard']}}};class AccessError extends Error{constructor(status){super('access');this.status=status}}
const business=()=>({operational,enabledModules:operational?['dashboard']:[]});
const accessMock={requireAuthenticatedProfile:context,readBusinessAccess:async()=>business(),AccessError};
const Layout=load('app/dashboard/layout.tsx',{'next/navigation':{redirect},'next/headers':{headers:async()=>({get:()=>path})},'@/lib/access':{allPermissions:['dashboard']},'@/lib/business-access':accessMock,'@/components/app-shell':{AppShell:()=>null},'@/components/business-access-monitor':{BusinessAccessMonitor:()=>null},'@/components/feedback':{FeedbackHost:()=>null}}).default;
(async()=>{
 for(role of ['super_admin','admin'])for(path of [undefined,'/dashboard','/dashboard/account','/dashboard/businesses']){const result=await Layout({children:'ACCOUNT CONTENT'});assert.equal(result.props.children[1].props.children,'ACCOUNT CONTENT','Safe account child renders with missing/stale path and expired business');}
 authFailure=new AccessError(503);await assert.rejects(Layout({children:null}),e=>e.status===503,'Outages stay errors');authFailure=new AccessError(403);await assert.rejects(Layout({children:null}),/REDIRECT \/login/);authFailure=null;
 const modules=load('lib/business-modules.ts',{}),guard=load('lib/access.ts',{'next/navigation':{redirect},'next/headers':{headers:async()=>({get:()=>'/dashboard/sales'})},'@/lib/business-access':accessMock,'@/lib/business-modules':modules}).requirePermission;
 await assert.rejects(guard('sales'),/REDIRECT \/dashboard\/account/,'Business pages remain blocked when subscription is inactive');
 operational=true;role='super_admin';await assert.rejects(guard('sales'),/REDIRECT \/dashboard\/restricted/,'Super admin operational module access is still checked');
 let profile={role:'super_admin',is_active:true},failure=null,revalidations=0;const client={auth:{signInWithPassword:async()=>({data:{user:{id:'signed-user'}},error:failure})},from:()=>({select:()=>({eq:(_key,id)=>{assert.equal(id,'signed-user');return{maybeSingle:async()=>({data:profile,error:null})}}})})};
 const login=load('app/login/actions.ts',{'next/navigation':{redirect},'next/cache':{revalidatePath:()=>revalidations++},'@/lib/supabase/server':{createClient:async()=>client}}).login,form={get:key=>key==='email'?'admin@example.test':'test-password'};
 await assert.rejects(login(form),/REDIRECT \/dashboard\/businesses/);profile={role:'admin',is_active:true};await assert.rejects(login(form),/REDIRECT \/dashboard$/);profile.is_active=false;await assert.rejects(login(form),/inactive/);failure={message:'Wrong password'};await assert.rejects(login(form),/Wrong%20password/);assert.equal(revalidations,2);
 const reason=load('lib/business-access-reason.ts',{'./business-modules':modules}).businessAccessMessage;
 const snapshot={organizationId:'org',businessName:'Store',businessStatus:'active',enabledModules:['dashboard'],operational:false,reason:'subscription',subscription:{status:'active',plan:'Custom',starts_on:'2026-01-01',expires_on:null,trial_ends_on:null}};
 const now=new Date('2026-10-31T06:00:00Z');
 assert.match(reason({...snapshot,subscription:{...snapshot.subscription,expires_on:'2026-10-30'}},now),/expired on 2026-10-30/);
 assert.match(reason({...snapshot,subscription:{...snapshot.subscription,starts_on:'2026-11-01'}},now),/starts on/);
 assert.match(reason({...snapshot,subscription:{...snapshot.subscription,status:'trialing',trial_ends_on:'2026-10-30'}},now),/trial ended/);
 assert.match(reason({...snapshot,subscription:{...snapshot.subscription,status:'trialing'}},now),/no end date/);
 assert.match(reason(snapshot,now),/server has blocked/,'Diagnostics never override database denial for valid-looking dates');
 assert.match(reason({...snapshot,operational:true},now),/account is active/);
 let reads=0;const Entry=load('app/dashboard/businesses/own-workspace/page.tsx',{'next/navigation':{redirect},'@/lib/business-access':{...accessMock,requireSuperAdmin:async()=>{if(role!=='super_admin')throw new AccessError(403);return context()},readBusinessAccess:async()=>{reads++;return business()}}}).default;
 role='super_admin';operational=false;await assert.rejects(Entry(),/REDIRECT \/dashboard\/account/);operational=true;await assert.rejects(Entry(),/REDIRECT \/dashboard$/);assert.equal(reads,2,'Fresh server access check on every workspace entry');role='admin';await assert.rejects(Entry(),/Access denied/);assert.equal(reads,2);
 console.log('PASS fresh own-workspace entry and subscription date diagnostics; missing/stale layout path cannot self-redirect account; expired subscription/module guards remain enforced; super admin login opens Businesses; regular and inactive login behavior');
})().catch(e=>{console.error(e);process.exitCode=1});
