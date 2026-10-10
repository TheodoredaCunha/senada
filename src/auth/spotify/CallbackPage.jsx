import { useEffect, useRef } from "react";
import { auth } from "../../providers";

export function SpotifyCallbackPage({ onComplete, onError }) {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      auth.providers.spotify.cancelPendingLogin().finally(() => {
        onError?.(new Error(`Spotify authorization failed: ${oauthError.replaceAll("_", " ")}.`));
      });
      return;
    }
    if (!code || !state) {
      auth.providers.spotify.cancelPendingLogin().finally(() => {
        onError?.(new Error("Spotify authentication did not return the expected code and state."));
      });
      return;
    }

    auth.handleCallback("spotify", { code, state })
      .then((result) => onComplete?.(result))
      .catch((error) => onError?.(error));
  }, [onComplete, onError]);

  return (
    <main className="oauth-callback">
      <div>
        <h2>Connecting to Spotify...</h2>
        <p>Completing authorization and loading your account.</p>
      </div>
    </main>
  );
}
