import { useCallback, useEffect, useState } from "react";
import App from "../App";
import { auth } from "../providers";
import { signInWithGoogle, signOutOfFirebase } from "./firebase";
import "./account.css";

const PROVIDERS = [
  { key: "youtube", name: "YouTube", icon: "▶" },
  { key: "spotify", name: "Spotify", icon: "●" },
  { key: "soundcloud", name: "SoundCloud", icon: "☁" },
];

const FIREBASE_CANCELLED = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];

const isProviderCallback = () => /^\/auth\/(soundcloud|spotify|youtube)\/callback$/.test(window.location.pathname);

// The existing provider classes read a per-provider "connected" flag; the server is the source of truth.
function syncProviderFlags(providers) {
  for (const { key } of PROVIDERS) {
    const flag = `universal-music:${key}:connected`;
    if (providers[key]) localStorage.setItem(flag, "true");
    else localStorage.removeItem(flag);
  }
}

function LoginScreen({ onSignedIn }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle();
      await onSignedIn();
    } catch (caught) {
      setError(FIREBASE_CANCELLED.includes(caught.code) ? "Google sign-in was cancelled." : caught.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand">SENADA</div>
        <div className="brand-sub">MUSIC</div>
        <h1>One library for all your music</h1>
        <p>Sign in once, then link YouTube, Spotify, and SoundCloud to your account.</p>
        {error && <div className="message" role="alert">{error}</div>}
        <button className="google-button" onClick={signIn} disabled={busy}>{busy ? "Signing in…" : "Continue with Google"}</button>
      </section>
    </main>
  );
}

function ConnectMusicScreen({ me, onContinue }) {
  const [message, setMessage] = useState("");
  const allConnected = PROVIDERS.every(({ key }) => me.providers[key]);

  const connect = async (key) => {
    setMessage("");
    try {
      await auth.login(key);
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="eyebrow">{allConnected ? "ALL SET" : "SET UP"}</div>
        <h1>{allConnected ? "Your music is connected" : "Connect your music"}</h1>
        <p>
          Signed in as {me.user.displayName}. Each service needs its own one-time permission;
          Google sign-in does not grant access to them.
        </p>
        {message && <div className="message" role="alert">{message}</div>}
        <ul className="connect-list">
          {PROVIDERS.map(({ key, name, icon }) => {
            const status = me.providerStatus[key];
            return (
              <li className="connect-row" key={key}>
                <span className="connect-name"><span aria-hidden="true">{icon}</span> {name}</span>
                {status === "connected"
                  ? <span className="connect-ok">✓ Connected</span>
                  : <button onClick={() => connect(key)}>{status === "needs_reconnect" ? "⚠ Reconnect" : `Connect ${name}`}</button>}
              </li>
            );
          })}
        </ul>
        <button className="primary-action" onClick={onContinue}>
          {allConnected ? "Open Universal Music" : "Continue"}
        </button>
      </section>
    </main>
  );
}

export default function AccountGate() {
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState("loading");
  const [forceSetup, setForceSetup] = useState(false);
  const [, setDismissTick] = useState(0);

  const loadMe = useCallback(async () => {
    try {
      const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
      if (response.status === 401) {
        setMe(null);
        setStatus("signedOut");
        return;
      }
      if (!response.ok) throw new Error("Unable to load your account.");
      const payload = await response.json();
      syncProviderFlags(payload.providers);
      setMe(payload);
      setStatus("ready");
    } catch {
      setStatus((previous) => (previous === "ready" ? previous : "error"));
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await signOutOfFirebase();
    } finally {
      for (const { key } of PROVIDERS) localStorage.removeItem(`universal-music:${key}:connected`);
      // A full reload also tears down the Spotify/YouTube players.
      window.location.assign("/");
    }
  };

  if (status === "loading") return <main className="auth-screen"><p>Loading…</p></main>;
  if (status === "error") {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>Can't reach the server</h1>
          <p>Make sure the backend is running, then try again.</p>
          <button className="primary-action" onClick={() => { setStatus("loading"); loadMe(); }}>Retry</button>
        </section>
      </main>
    );
  }
  if (status === "signedOut") return <LoginScreen onSignedIn={loadMe} />;

  const setupKey = `universal-music:setup-done:${me.user.id}`;
  const allConnected = PROVIDERS.every(({ key }) => me.providers[key]);
  const setupDone = localStorage.getItem(setupKey) === "1";
  const showSetup = !isProviderCallback() && (forceSetup || (!allConnected && !setupDone));

  if (showSetup) {
    return (
      <ConnectMusicScreen
        me={me}
        onContinue={() => {
          localStorage.setItem(setupKey, "1");
          setForceSetup(false);
          setDismissTick((tick) => tick + 1);
        }}
      />
    );
  }

  return (
    <App
      key={me.user.id}
      account={me}
      onAccountChange={loadMe}
      onOpenSetup={() => setForceSetup(true)}
      onSignOut={signOut}
    />
  );
}
