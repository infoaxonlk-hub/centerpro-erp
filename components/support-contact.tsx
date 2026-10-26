import Link from "next/link";
export function SupportContact() {
  const value = process.env.INFOAXON_SUPPORT_URL?.trim();
  const safe = value && /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
  return safe ? <a className="primary" href={safe} target="_blank" rel="noopener noreferrer">Contact InfoAxon Support</a>
    : <div><p>Contact InfoAxon Support using the contact details supplied with your subscription.</p><Link className="ghost" href="/dashboard/account">Contact InfoAxon Support — account details</Link></div>;
}
