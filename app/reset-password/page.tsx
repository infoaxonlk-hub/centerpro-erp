"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    async function prepare() {
      const code = new URL(window.location.href).searchParams.get("code");
      if (code) await supabase.auth.exchangeCodeForSession(code);
      const { data } = await supabase.auth.getSession();
      setReady(Boolean(data.session));
      if (!data.session)
        setError(
          "This recovery link is invalid or expired. Request a new recovery email.",
        );
    }
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" || session) {
          setReady(true);
          setError("");
        }
      },
    );
    void prepare();
    return () => listener.subscription.unsubscribe();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({
      password,
    });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-panel login-brand">
        <span className="eyebrow">INFOAXON SOFTWARE SOLUTIONS</span>
        <h1>CenterPro</h1>
        <p>Create a secure new password for your business account.</p>
      </section>
      <section className="login-panel login-form-panel">
        <form className="login-form" onSubmit={submit}>
          <div>
            <span className="eyebrow dark">SECURE RECOVERY</span>
            <h2>New password</h2>
            <p>Use at least 8 characters.</p>
          </div>
          {error && <div className="alert error">{error}</div>}
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!ready}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!ready}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <button className="primary" type="submit" disabled={!ready || busy}>
            {busy
              ? "Updating…"
              : ready
                ? "Update password"
                : "Checking recovery link…"}
          </button>
        </form>
      </section>
    </main>
  );
}
