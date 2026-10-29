"use client";
export default function ApplicationError({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <main style={{maxWidth:560,margin:"64px auto",padding:24}}><h1>Workspace could not be loaded</h1><p>Your session or business access could not be verified. Retry to reconnect.</p><button type="button" onClick={reset}>Try again</button><p><a href="/login?error=Please sign in again">Sign in again</a></p></main>;
}
