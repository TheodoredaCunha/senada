import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);
const firebaseAuth = firebaseConfigured ? getAuth(initializeApp(config)) : null;

// Firebase proves who the user is; the backend swaps the ID token for its own session cookie.
export async function signInWithGoogle() {
  if (!firebaseAuth) throw new Error("Firebase is not configured. Add the VITE_FIREBASE_* settings to .env.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const { user } = await signInWithPopup(firebaseAuth, provider);
  const idToken = await user.getIdToken();
  const response = await fetch("/api/auth/firebase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    await signOut(firebaseAuth);
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Sign-in failed.");
  }
}

export async function signOutOfFirebase() {
  if (firebaseAuth) await signOut(firebaseAuth).catch(() => {});
}
