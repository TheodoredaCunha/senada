export function getLocalRedirectUri(configuredUri, callbackPath) {
  const fallback = `http://127.0.0.1:5173${callbackPath}`;
  const redirectUri = new URL(configuredUri || fallback);

  if (
    import.meta.env.DEV &&
    redirectUri.port === "5173" &&
    (redirectUri.hostname === "localhost" || redirectUri.hostname === "127.0.0.1")
  ) {
    redirectUri.hostname = "127.0.0.1";
  }

  return redirectUri.toString();
}
