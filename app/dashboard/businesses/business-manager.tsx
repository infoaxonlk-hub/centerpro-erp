"use client";
import { useEffect, useState } from "react";

type Business = { id: string; name: string; created_at: string; profiles: { id: string; full_name: string; email: string; role: string; is_active: boolean }[] };
export function BusinessManager() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const response = await fetch("/api/admin/businesses", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBusinesses(data);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load businesses"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    fetch("/api/admin/businesses", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data as Business[];
      })
      .then(data => { if (active) setBusinesses(data); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Unable to load businesses"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/businesses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(values)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      form.reset();
      setSuccess(`${data.name} created. The business admin can sign in at /login using ${data.adminEmail} and the password you supplied.`);
      setLoading(true);
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Business creation failed"); }
    finally { setBusy(false); }
  }
  return <div>
    <div className="page-heading"><div><h1>Businesses</h1><p>Create a separate business workspace and its administrator.</p></div></div>
    {error && <p className="alert error" role="alert">{error}</p>}
    {success && <p className="alert success" role="status">{success}</p>}
    <section className="panel"><h2>Create business</h2>
      <form onSubmit={submit}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
          <div className="company-profile-grid">
            <label>Business name<input name="name" required minLength={2} maxLength={120}/></label>
            <label>Admin name<input name="adminName" required minLength={2} maxLength={120}/></label>
            <label>Admin email<input name="email" type="email" autoComplete="off" required/></label>
            <label>Admin password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72}/></label>
          </div>
          <p>The administrator can create centers, users and business records after signing in.</p>
          <button className="primary" type="submit">{busy ? "Creating business..." : "Create business & admin"}</button>
        </fieldset>
      </form>
    </section>
    <section className="panel"><h2>Businesses ({businesses.length})</h2>
      {loading ? <p>Loading businesses...</p> : <div className="business-table-wrap"><table className="business-table"><thead><tr><th>Business</th><th>Administrators</th><th>Created</th></tr></thead>
        <tbody>{businesses.map(business => <tr key={business.id}>
          <td className="business-name">{business.name}</td><td>{business.profiles.filter(p => p.role === "admin").map(p => <div className="business-admin" key={p.id}><strong>{p.full_name}</strong><span>{p.email}</span>{!p.is_active && <small className="status inactive">Inactive</small>}</div>)}</td>
          <td className="business-created">{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo" }).format(new Date(business.created_at))}</td>
        </tr>)}</tbody></table>{!businesses.length && <p>No businesses yet.</p>}</div>}
    </section>
  </div>;
}
