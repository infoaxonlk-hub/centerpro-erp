import Link from "next/link";
import {ArrowRight,Check,LockKeyhole,Mail} from "lucide-react";
import {ActionSubmit} from "@/components/action-submit";
import {CenterProLogo} from "@/components/centerpro-logo";
import {LoginPasswordInput} from "@/components/login-password-input";
import "@/app/appearance.css";
import "./login.css";
import {login} from "./actions";

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}){
 const{error}=await searchParams;
 return <main className="login-page centerpro-sign-in">
  <section className="login-panel login-brand" aria-label="CenterPro">
   <div className="login-brand-logo"><CenterProLogo sizes="190px" priority/></div>
   <div className="login-brand-copy"><span className="login-eyebrow">BUILT FOR YOUR BUSINESS</span><h1>One workspace.<br/>Your entire<br/><span>business.</span></h1><p>Keep your operations connected.<br/>Work with clarity, every day.</p><div className="login-brand-pills"><span><Check size={13} aria-hidden="true"/>Sales &amp; purchases</span><span><Check size={13} aria-hidden="true"/>Stock &amp; finance</span></div></div>
   <p className="login-brand-provider">CENTERPRO / BIY NFOAXON</p><div className="login-orb login-orb-one" aria-hidden="true"/><div className="login-orb login-orb-two" aria-hidden="true"/>
  </section>
  <section className="login-panel login-form-panel">
   <header className="mobile-login-brand"><div className="mobile-login-logo"><CenterProLogo sizes="170px" priority/></div><span>YOUR BUSINESS, CONNECTED.</span></header>
   <div className="login-form-content"><form action={login} className="login-form">
    <div className="login-form-heading"><span className="login-eyebrow"><LockKeyhole size={13} aria-hidden="true"/>SECURE ACCESS</span><h2>Good to see you again.</h2><p>Sign in and pick up where you left off.</p></div>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="login-field"><label htmlFor="login-email">Email address</label><div className="login-input-wrap"><Mail size={18} aria-hidden="true"/><input id="login-email" name="email" type="email" inputMode="email" placeholder="you@company.com" autoCapitalize="none" spellCheck={false} autoComplete="email" required/></div></div>
    <div className="login-field"><div className="login-password-label"><label htmlFor="login-password">Password</label><Link href="/forgot-password">Forgot password?</Link></div><LoginPasswordInput/></div>
    <div className="login-submit"><ActionSubmit label="Sign in" pendingLabel="Signing in..."/><ArrowRight size={18} aria-hidden="true"/></div>
    <p className="login-account-note">Use your assigned business account.</p>
   </form><p className="login-provider">Powered by InfoAxon Software Solutions</p></div>
  </section>
 </main>;
}
