import { useEffect, useRef } from "react";
import { auth } from "../../providers";

export function YouTubeCallbackPage({ onComplete, onError }) {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (oauthError) {
      onError?.(new Error(`Google authorization failed: ${oauthError.replaceAll("_", " ")}.`));
      return;
    }
    if (!code || !state) {
      onError?.(new Error("YouTube authentication failed. No authorization code was returned."));
      return;
    }
    auth.handleCallback("youtube", { code, state })
      .then((result) => onComplete?.(result))
      .catch((error) => onError?.(error));
  }, [onComplete, onError]);

  return (
    <main className="oauth-callback">
      <div>
        <h2>Connecting to YouTube...</h2>
        <p>Completing authorization and loading your account.</p>
      </div>
    </main>
  );
}
