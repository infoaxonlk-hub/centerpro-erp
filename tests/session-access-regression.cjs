const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {NextRequest,NextResponse}=require('next/server');
function load(file,overrides={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require,process,Response,Headers,URL,console,setTimeout,clearTimeout,...overrides},{filename:file});return module.exports;}
const status=load('lib/auth-status.ts');
const valid={data:{user:{id:'user'}},error:null},missing={data:{user:null},error:null},outage={data:{user:null},error:{status:503,name:'AuthRetryableFetchError'}};
const business={operational:true,enabledModules:['dashboard','inventory'],businessName:'Bandarawatta Stores'};
let result=valid,profile={id:'user',is_active:true,organization_id:'business',role:'super_admin'},profileError=null,rpcResult={data:business,error:null};
const client={auth:{async getUser(){return result;}},from(){return{select(){return{eq(){return{async maybeSingle(){return{data:profile,error:profileError};}};}};}};},async rpc(){return rpcResult;}};
const access=load('lib/business-access.ts',{require(id){if(id==='@/lib/supabase/server')return{createClient:async()=>client};if(id==='@/lib/auth-status')return status;if(id==='@/lib/business-modules')return{moduleEnabled:()=>true};return require(id);}});
const api=load('app/api/business-access/route.ts',{require:id=>id==='@/lib/business-access'?access:require(id)});
let refreshed=[];
const proxyModule=load('proxy.ts',{require(id){if(id==='@supabase/ssr')return{createServerClient(_url,_key,options){return{auth:{async getUser(){if(refreshed.length)options.cookies.setAll(refreshed);return result;}}};}};if(id==='next/server')return{NextRequest,NextResponse};if(id==='@/lib/auth-status')return status;return require(id);}});
(async()=>{
 assert.equal(status.sessionFailureStatus({code:'session_expired',status:400}),401);
 assert.equal(status.sessionFailureStatus({status:429}),503);
 assert.ok(proxyModule.config.matcher.includes('/api/business-access'));
 assert.ok(proxyModule.config.matcher.includes('/api/admin/:path*'));
 refreshed=[{name:'sb-auth-token',value:'fresh-session',options:{path:'/',httpOnly:true,secure:true}}];
 let response=await proxyModule.proxy(new NextRequest('https://preview.test/login'));
 assert.equal(response.status,307);assert.equal(response.headers.get('location'),'https://preview.test/dashboard');assert.equal(response.cookies.get('sb-auth-token').value,'fresh-session');assert.equal(response.cookies.get('sb-auth-token').httpOnly,true);
 response=await proxyModule.proxy(new NextRequest('https://preview.test/api/business-access'));
 assert.equal(response.status,200);assert.equal(response.cookies.get('sb-auth-token').value,'fresh-session');assert.match(response.headers.get('x-middleware-request-cookie'),/fresh-session/);assert.equal(response.headers.get('cache-control'),'private, no-store');
 result=missing;refreshed=[{name:'sb-auth-token',value:'',options:{path:'/',maxAge:0}}];
 response=await proxyModule.proxy(new NextRequest('https://preview.test/dashboard'));
 assert.equal(response.status,307);assert.equal(response.cookies.get('sb-auth-token').maxAge,0);
 response=await api.GET();assert.equal(response.status,401);assert.equal((await response.json()).code,'SESSION_REQUIRED');
 result=outage;refreshed=[];response=await proxyModule.proxy(new NextRequest('https://preview.test/api/business-access'));
 assert.equal(response.status,503);assert.equal(response.headers.get('location'),null);
 response=await api.GET();assert.equal(response.status,503);
 result=valid;profileError={message:'Database timeout'};response=await api.GET();assert.equal(response.status,503);
 profileError=null;profile={...profile,is_active:false};response=await api.GET();assert.equal(response.status,403);
 profile={...profile,is_active:true};rpcResult={data:null,error:{message:'RPC unavailable'}};response=await api.GET();assert.equal(response.status,503);
 rpcResult={data:{},error:null};response=await api.GET();assert.equal(response.status,503);
 rpcResult={data:{...business,operational:false,reason:'subscription'},error:null};response=await api.GET();assert.equal(response.status,200);assert.equal((await response.json()).operational,false,'A subscription restriction must never be bypassed');

 // Exercise the live monitor's callbacks: transient outages preserve the page,
 // a single rotating-session 401 recovers, genuine missing sessions hard-navigate.
 const React=require('react');let effect,warning='',routes=[],hardRoutes=[],reply={status:503,ok:false},timer,delayed;
 const window={setInterval:fn=>(timer=fn,1),clearInterval(){},addEventListener(){},removeEventListener(){},location:{replace:url=>hardRoutes.push(url)}};
 const {BusinessAccessMonitor}=load('components/business-access-monitor.tsx',{navigator:{onLine:true},window,fetch:async()=>reply,setTimeout:fn=>(delayed=fn,2),clearTimeout(){},require(id){if(id==='react')return{...React,useRef:value=>({current:value}),useState:()=>[warning,value=>{warning=value}],useEffect:fn=>{effect=fn;}};if(id==='next/navigation')return{useRouter:()=>({replace:url=>routes.push(url),refresh(){}}),usePathname:()=>'/dashboard'};if(id==='@/lib/business-modules')return{moduleForPath:()=> 'dashboard',moduleEnabled:()=>true};return require(id);}});
 BusinessAccessMonitor({initial:business,isSuperAdmin:true});const cleanup=effect();
 await timer();await new Promise(setImmediate);assert.ok(warning.includes('Reconnecting'));assert.equal(hardRoutes.length,0);
 reply={status:401,ok:false};await timer();await new Promise(setImmediate);assert.ok(delayed);assert.equal(hardRoutes.length,0);
 reply={status:200,ok:true,json:async()=>business};await delayed();await new Promise(setImmediate);assert.equal(warning,'');assert.equal(hardRoutes.length,0);
 reply={status:401,ok:false};await timer();await new Promise(setImmediate);await delayed();await new Promise(setImmediate);assert.equal(hardRoutes.length,1);assert.ok(hardRoutes[0].startsWith('/login?error='));cleanup();
 routes=[];hardRoutes=[];reply={status:200,ok:true,json:async()=>({...business,operational:false,reason:'subscription'})};
 BusinessAccessMonitor({initial:business,isSuperAdmin:true});effect();await timer();await new Promise(setImmediate);assert.deepEqual(routes,['/dashboard/account']);
 console.log('PASS refreshed/cleared redirect cookies, API proxy coverage, auth outage vs expired session, inactive profiles, malformed/unavailable access RPC, monitor recovery and preserved subscription restrictions');
})().catch(error=>{console.error(error);process.exitCode=1});
