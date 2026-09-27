// Public privacy policy for Mia. Required by Google Play because the app
// requests microphone access. Deploys with the web/ backend and is reachable
// at https://<your-domain>/privacy — submit that URL in Play Console →
// App content → Privacy policy, and again in the store listing.
//
// EDIT THESE TWO before publishing:
const CONTACT_EMAIL = 'hello@miavoice.online'; // support/privacy contact shown to users
const EFFECTIVE_DATE = '2026 წლის ივლისი'; // update when you change the policy

export const metadata = {
  title: 'Mia — კონფიდენციალურობის პოლიტიკა / Privacy Policy',
  description: 'Mia Georgian voice assistant — privacy policy',
};

export default function PrivacyPolicyPage() {
  return (
    <main style={page}>
      <div style={container}>
        {/* ─────────────────────────── ქართული ─────────────────────────── */}
        <h1 style={h1}>კონფიდენციალურობის პოლიტიკა</h1>
        <p style={muted}>ძალაშია: {EFFECTIVE_DATE}</p>

        <p style={p}>
          Mia არის ქართულენოვანი ხმოვანი ასისტენტი. ეს პოლიტიკა განმარტავს, თუ რა
          მონაცემებს ვამუშავებთ, რატომ და ვის გადავცემთ. მოკლედ: თქვენს საუბრებს
          სერვერზე არ ვინახავთ, ხმოვან ჩანაწერებს კი ვამუშავებთ მხოლოდ მაშინ,
          როცა თავად იყენებთ მიკროფონს.
        </p>

        <h2 style={h2}>რა მონაცემებს ვაგროვებთ</h2>
        <ul style={ul}>
          <li style={li}>
            <b>ხმოვანი ჩანაწერები.</b> როცა მიკროფონს იყენებთ, ჩანაწერი
            იგზავნება ჩვენს სერვერზე დაშიფრული კავშირით (HTTPS) და გადაეცემა
            მეტყველების ამომცნობ სერვისებს ტექსტად გადასაქცევად. ჩანაწერებს{' '}
            <b>ჩვენს სერვერზე არ ვინახავთ</b> — მუშავდება და იშლება.
          </li>
          <li style={li}>
            <b>ელ. ფოსტა და პაროლი.</b> ანგარიშისთვის. პაროლი ინახება მხოლოდ
            დაშიფრული (hash) სახით — ღია ტექსტად არასდროს.
          </li>
          <li style={li}>
            <b>მიახლოებითი მდებარეობა (არასავალდებულო).</b> თუ ნებართვას მისცემთ,
            ვიყენებთ მხოლოდ ამინდის საჩვენებლად. მდებარეობას არ ვინახავთ.
          </li>
          <li style={li}>
            <b>საუბრების ისტორია.</b> ინახება <b>მხოლოდ თქვენს მოწყობილობაზე</b>.
            ჩვენს სერვერზე არ იგზავნება.
          </li>
        </ul>

        <h2 style={h2}>„Mia“-ს გამოძახება (wake word)</h2>
        <p style={p}>
          თუ „Mia“-ს ხმით გამოძახებას ჩართავთ, ამოცნობა ხდება{' '}
          <b>მთლიანად თქვენს მოწყობილობაზე</b>. ხმა მოწყობილობას არ ტოვებს მანამ,
          სანამ საკვანძო სიტყვას არ ამოიცნობს.
        </p>

        <h2 style={h2}>ვის ვუზიარებთ მონაცემებს</h2>
        <p style={p}>
          ვიყენებთ გარე სერვისებს (ქვე-დამმუშავებლებს) მხოლოდ აპის ფუნქციონირებისთვის.
          მონაცემებს რეკლამისთვის არავის ვუზიარებთ და არ ვყიდით.
        </p>
        <ul style={ul}>
          <li style={li}>
            <b>Google Cloud</b> — მეტყველების ამოცნობა (ქართული ხმა → ტექსტი).
          </li>
          <li style={li}>
            <b>Google Gemini</b> — ასისტენტის პასუხები, თარგმანი, ამოცნობილი ტექსტის შესწორება.
          </li>
          <li style={li}>
            <b>ElevenLabs</b> — ტექსტის ხმად გადაქცევა (პასუხის წაკითხვა).
          </li>
          <li style={li}>
            <b>Open-Meteo</b> — ამინდის მონაცემები; გადაეცემა თქვენი ქალაქი ან
            მიახლოებითი კოორდინატები.
          </li>
          <li style={li}>
            <b>Sentry</b> (თუ ჩართულია) — მხოლოდ პროგრამის ხარვეზების დიაგნოსტიკა.
          </li>
        </ul>

        <h2 style={h2}>ანგარიშის და მონაცემების წაშლა</h2>
        <p style={p}>
          ანგარიშის წაშლა შეგიძლიათ ნებისმიერ დროს: აპში{' '}
          <b>პარამეტრები → ანგარიშის წაშლა</b>, ან ვებ-გვერდზე{' '}
          <a href="/delete-account" style={a}>/delete-account</a>. წაშლა საბოლოოა
          — იშლება ელ. ფოსტა და პაროლი. საუბრები მხოლოდ მოწყობილობაზეა, ამიტომ
          აპის წაშლა მათაც შლის.
        </p>

        <h2 style={h2}>უსაფრთხოება</h2>
        <p style={p}>
          ყველა კავშირი დაშიფრულია (HTTPS). პაროლები ინახება hash-ით. ხმოვან
          ჩანაწერებს არ ვინახავთ.
        </p>

        <h2 style={h2}>ბავშვები</h2>
        <p style={p}>
          Mia არ არის განკუთვნილი 13 წლამდე ბავშვებისთვის და შეგნებულად არ
          ვაგროვებთ მათ მონაცემებს.
        </p>

        <h2 style={h2}>ცვლილებები</h2>
        <p style={p}>
          პოლიტიკის განახლებისას შევცვლით ზემოთ მითითებულ თარიღს.
        </p>

        <h2 style={h2}>კონტაქტი</h2>
        <p style={p}>
          კითხვებისთვის:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>
        </p>

        <hr style={hr} />

        {/* ─────────────────────────── English ─────────────────────────── */}
        <h1 style={h1}>Privacy Policy</h1>
        <p style={muted}>Effective: July 2026</p>

        <p style={p}>
          Mia is a Georgian-language voice assistant. This policy explains what
          data we process, why, and who we share it with. In short: we do not
          store your conversations on our servers, and we process voice
          recordings only while you actively use the microphone.
        </p>

        <h2 style={h2}>Data we collect</h2>
        <ul style={ul}>
          <li style={li}>
            <b>Voice recordings.</b> When you use the microphone, the recording
            is sent to our server over an encrypted connection (HTTPS) and
            forwarded to speech-recognition services to convert it to text. We{' '}
            <b>do not store recordings</b> on our servers — they are processed
            and discarded.
          </li>
          <li style={li}>
            <b>Email and password.</b> For your account. The password is stored
            only in hashed form, never as plain text.
          </li>
          <li style={li}>
            <b>Approximate location (optional).</b> If you grant permission, used
            solely to show local weather. We do not store your location.
          </li>
          <li style={li}>
            <b>Conversation history and personal memory.</b> Stored <b>only on
            your device</b>. Personal memory is short facts you tell Mia (e.g.
            your name or city); you can review and delete them in Settings.
            Recent messages and these facts are sent with each request so Mia
            can reply in context, but our servers do not store them.
          </li>
          <li style={li}>
            <b>Contacts and SMS (optional).</b> When you ask Mia to text someone,
            your contacts are searched <b>on your device</b> to find the
            recipient; your contact list and phone numbers are never uploaded.
            The recipient&rsquo;s name and the message text are processed like
            any other request. Mia reads the message back and sends it from your
            SIM only after you confirm; normal carrier SMS charges apply.
          </li>
        </ul>

        <h2 style={h2}>&ldquo;Hey Mia&rdquo; wake word</h2>
        <p style={p}>
          If you enable voice activation, detection runs <b>entirely on your
          device</b>. Audio does not leave the device until the wake word is
          detected.
        </p>

        <h2 style={h2}>Who we share data with</h2>
        <p style={p}>
          We use third-party service providers (sub-processors) only to make the
          app work. We do not share your data for advertising and we do not sell
          it.
        </p>
        <ul style={ul}>
          <li style={li}><b>Google Cloud</b> — speech recognition (Georgian speech to text).</li>
          <li style={li}><b>Google Gemini</b> — assistant replies, translation, transcript correction.</li>
          <li style={li}><b>ElevenLabs</b> — text-to-speech (reading replies aloud).</li>
          <li style={li}><b>Open-Meteo</b> — weather data; receives your city or approximate coordinates.</li>
          <li style={li}><b>Sentry</b> (if enabled) — crash diagnostics only.</li>
        </ul>

        <h2 style={h2}>Account and data deletion</h2>
        <p style={p}>
          You can delete your account at any time: in the app via{' '}
          <b>Settings → Delete account</b>, or on the web at{' '}
          <a href="/delete-account" style={a}>/delete-account</a>. Deletion is
          permanent — your email and password are removed. Conversations live
          only on your device, so uninstalling the app deletes those too.
        </p>

        <h2 style={h2}>Security</h2>
        <p style={p}>
          All connections are encrypted (HTTPS). Passwords are stored hashed. We
          do not retain voice recordings.
        </p>

        <h2 style={h2}>Children</h2>
        <p style={p}>
          Mia is not directed to children under 13, and we do not knowingly
          collect their data.
        </p>

        <h2 style={h2}>Changes</h2>
        <p style={p}>When we update this policy, we will change the effective date above.</p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Questions:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </main>
  );
}

const page: React.CSSProperties = {
  background: '#02020a',
  color: '#e8e8f0',
  minHeight: '100vh',
  fontFamily: 'system-ui, sans-serif',
  padding: '48px 20px',
};
const container: React.CSSProperties = { maxWidth: 720, margin: '0 auto', lineHeight: 1.6 };
const h1: React.CSSProperties = { fontSize: 26, marginTop: 8, marginBottom: 4 };
const h2: React.CSSProperties = { fontSize: 18, marginTop: 28, marginBottom: 6, color: '#c9b8ff' };
const p: React.CSSProperties = { fontSize: 15, margin: '0 0 12px' };
const muted: React.CSSProperties = { fontSize: 13, opacity: 0.6, marginBottom: 20 };
const ul: React.CSSProperties = { paddingLeft: 20, margin: '0 0 12px' };
const li: React.CSSProperties = { fontSize: 15, marginBottom: 8 };
const a: React.CSSProperties = { color: '#ff8ab3' };
const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid rgba(255,255,255,0.12)',
  margin: '44px 0',
};
