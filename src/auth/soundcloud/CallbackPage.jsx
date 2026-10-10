import { useEffect, useRef } from "react";
import { auth } from "../../providers";

export function SoundCloudCallbackPage({ onComplete, onError }) {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      const error = new Error(
        "SoundCloud authentication failed. No authorization code was returned."
      );
      onError?.(error);
      onComplete?.(error);
      return;
    }

    const run = async () => {
      try {
        const result = await auth.handleCallback("soundcloud", { code, state });
        onComplete?.(result);
      } catch (error) {
        onError?.(error);
        onComplete?.(error);
      }
    };

    run();
  }, [onComplete, onError]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        color: "#f4f4f5",
        background: "#101114",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h2>Connecting to SoundCloud…</h2>
        <p>Completing OAuth and loading your account.</p>
      </div>
    </div>
  );
}
