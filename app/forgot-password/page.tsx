"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (resetError) { setError(resetError.message); return; }
    setMessage("Password recovery email sent. Open the newest email to continue.");
  }

  return <main className="login-page"><section className="login-panel login-brand"><span className="eyebrow">INFOAXON SOFTWARE SOLUTIONS</span><h1>CollectPro</h1><p>Secure account recovery for authorized business users.</p></section><section className="login-panel login-form-panel"><form className="login-form" onSubmit={submit}><div><span className="eyebrow dark">ACCOUNT RECOVERY</span><h2>Forgot password</h2><p>Enter your assigned email address.</p></div>{error&&<div className="alert error">{error}</div>}{message&&<div className="alert success">{message}</div>}<label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="primary" type="submit" disabled={busy}>{busy?"Sending…":"Send recovery email"}</button><Link className="auth-link" href="/login">Back to sign in</Link></form></section></main>;
}
