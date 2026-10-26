import Link from "next/link";
import { ActionSubmit } from "@/components/action-submit";
import "@/app/appearance.css";
import "./login.css";
import { login } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login-page centerpro-sign-in">
      <section className="login-panel login-brand">
        <span className="eyebrow">INFOAXON SOFTWARE SOLUTIONS</span>
        <h1>CenterPro</h1>
        <p>Spice collection center purchasing, quality pricing, location-wise inventory and cash control in one secure ERP.</p>
        <div className="brand-grid">
          <span>Center operations</span><span>Location stock</span>
          <span>Quality pricing</span><span>Audit ready</span>
        </div>
      </section>
      <section className="login-panel login-form-panel">
        <header className="mobile-login-brand">
          <span className="mobile-login-mark" aria-hidden="true">CP</span>
          <div><strong>CenterPro</strong><span>by InfoAxon</span></div>
        </header>
        <p className="mobile-login-tagline">Your business workspace,<br/>wherever you are.</p>
        <form action={login} className="login-form">
          <div><span className="eyebrow dark">SECURE ACCESS</span><h2>Sign in</h2><p>Use your assigned business account.</p></div>
          {error && <div className="alert error" role="alert">{error}</div>}
          <label>Email address<input name="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <Link className="mobile-login-recovery" href="/forgot-password">Forgot password?</Link>
          <ActionSubmit label="Sign in" pendingLabel="Signing in..." />
        </form>
        <p className="mobile-login-footer">Powered by InfoAxon Software Solutions</p>
      </section>
    </main>
  );
}
