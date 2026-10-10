import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const spotifyCallbackOrigin = new URL(
  import.meta.env.VITE_SPOTIFY_REDIRECT_URI || "http://127.0.0.1:5173/auth/spotify/callback"
).origin;

if (import.meta.env.DEV && window.location.origin !== spotifyCallbackOrigin) {
  window.location.replace(
    `${spotifyCallbackOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`
  );
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}