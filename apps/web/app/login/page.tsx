"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

export default function Login() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <section className="card" style={{ maxWidth: 380, margin: "15vh auto" }}>
      <h1>Rave Run</h1>
      <form action={action}>
        <label htmlFor="pw">Password</label>
        <input id="pw" name="password" type="password" autoComplete="current-password" autoFocus required />
        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
        <button type="submit" disabled={pending} style={{ marginTop: 12 }}>{pending ? "…" : "Sign in"}</button>
      </form>
    </section>
  );
}
