"use client";

// Public account-deletion page. Google Play requires a web URL where users can
// delete their account without reinstalling the app. Submit this page's URL in
// Play Console → App content → Data safety → Account deletion.

import { useState } from "react";

export default function DeleteAccountPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "busy") return;
    setStatus("busy");
    setMessage("");
    try {
      const res = await fetch("/api/auth/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(
          data.error === "Incorrect email or password"
            ? "ელ. ფოსტა ან პაროლი არასწორია"
            : "წაშლა ვერ მოხერხდა — სცადეთ მოგვიანებით",
        );
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setMessage("ქსელის შეცდომა — სცადეთ მოგვიანებით");
    }
  }

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "0 auto",
        padding: "48px 20px",
        fontFamily: "system-ui, sans-serif",
        color: "#e8e8f0",
        background: "#02020a",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>ანგარიშის წაშლა — Mia</h1>
      <p style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
        ანგარიშის წაშლა საბოლოოა: წაიშლება თქვენი ელ. ფოსტა და პაროლი. Mia
        სერვერზე არ ინახავს თქვენს საუბრებს ან ხმოვან ჩანაწერებს — ისინი მხოლოდ
        თქვენს ტელეფონზეა.
      </p>
      {status === "done" ? (
        <p style={{ marginTop: 24, color: "#7ee29a", fontSize: 15 }}>
          ანგარიში წაშლილია. ნახვამდის!
        </p>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 24 }}>
          <input
            type="email"
            required
            placeholder="ელ. ფოსტა"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            required
            placeholder="პაროლი"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={status === "busy"}
            style={{
              width: "100%",
              padding: "12px 16px",
              marginTop: 16,
              borderRadius: 10,
              border: "1px solid rgba(255,90,110,0.5)",
              background: "rgba(255,90,110,0.15)",
              color: "#ff8a9b",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {status === "busy" ? "იშლება…" : "ანგარიშის სამუდამოდ წაშლა"}
          </button>
          {message ? (
            <p style={{ marginTop: 12, color: "#ff8a9b", fontSize: 13 }}>
              {message}
            </p>
          ) : null}
        </form>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  marginTop: 10,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "#e8e8f0",
  fontSize: 15,
  outline: "none",
};
