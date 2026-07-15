// Root of the Mia backend. This is NOT a web app — Mia is an Android app and
// this server only proxies its chat/STT/TTS/auth requests (keeping the API
// keys server-side). This page exists so the bare domain returns a clean 200
// (health check / "is it up?") instead of a 404. The real endpoints live under
// /api, and the two required pages are /privacy and /delete-account.

export const metadata = {
  title: 'Mia API',
  description: 'Backend for the Mia voice assistant',
};

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        background: '#02020a',
        color: '#e8e8f0',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 22, margin: 0 }}>Mia</h1>
      <p style={{ opacity: 0.7, fontSize: 14, margin: 0 }}>
        Backend is running. Mia is an Android app.
      </p>
      <p style={{ opacity: 0.5, fontSize: 13, margin: 0 }}>
        <a href="/privacy" style={{ color: '#ff8ab3' }}>Privacy Policy</a>
        {' · '}
        <a href="/delete-account" style={{ color: '#ff8ab3' }}>Delete Account</a>
      </p>
    </main>
  );
}
