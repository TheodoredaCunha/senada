# Universal Music

A React + Vite music client with a provider-agnostic library and playback layer.

## Current status

### SoundCloud
- PKCE OAuth authorization code flow with server-side confidential token exchange
- Server-side access/refresh token storage and refresh-token rotation
- Authenticated profile, liked tracks, and playlists
- Playback through the official SoundCloud Widget API

### YouTube
- Google OAuth 2.0 authorization code flow with PKCE
- Server-side Google client secret and token storage/refresh
- YouTube Data API v3 account, liked videos, and playlists
- Playback through the official YouTube IFrame Player API

### Spotify
- PKCE OAuth authorization-code flow with server-side access/refresh token storage
- Paginated saved tracks from Spotify Web API
- Official Spotify Web Playback SDK and Connect device transfer
- Spotify playback requires an eligible Spotify Premium account

## Setup

Use `.env.example` as a reference and add its missing keys to your existing root `.env`; preserve credentials already configured there. The server loads the root `.env` file even though its source is in `server/`.

```bash
npm install express dotenv
```

Run the backend and frontend in separate terminals from the project root:

```bash
node server/index.js
```

```bash
npm run dev
```

The backend listens on port `3001`; Vite listens on port `5173` and forwards `/api` requests to Express. Open the app at `http://127.0.0.1:5173` for every provider so browser storage and HTTP-only session cookies use one origin. In development, an entry through `localhost` is redirected to this canonical host before React starts.

For Spotify, open `http://127.0.0.1:5173`; Spotify login also redirects there automatically if started from `localhost`.

## Environment variables

```bash
VITE_SOUNDCLOUD_CLIENT_ID=
VITE_SOUNDCLOUD_REDIRECT_URI=http://127.0.0.1:5173/auth/soundcloud/callback
VITE_YOUTUBE_CLIENT_ID=
VITE_YOUTUBE_REDIRECT_URI=http://127.0.0.1:5173/auth/youtube/callback
VITE_SPOTIFY_CLIENT_ID=
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/auth/spotify/callback

SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=
SOUNDCLOUD_REDIRECT_URI=http://127.0.0.1:5173/auth/soundcloud/callback
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://127.0.0.1:5173/auth/youtube/callback
SPOTIFY_CLIENT_ID=
PORT=3001
```

`VITE_*_CLIENT_ID` values are public OAuth client IDs. `SPOTIFY_CLIENT_ID` and `VITE_SPOTIFY_CLIENT_ID` must match. Spotify uses PKCE and does not need a client secret. Keep SoundCloud and Google client secrets server-side. Spotify access and refresh tokens stay in the backend session; its short-lived access token is returned with `Cache-Control: no-store` only when the official Web Playback SDK requests it.

## Google Cloud configuration

1. Create or select a Google Cloud project and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen for the app and add the Google accounts that may test it while in Testing status.
3. Create an OAuth client ID of type **Web application**.
4. Add `http://127.0.0.1:5173/auth/youtube/callback` as an authorized redirect URI.
5. Put the client ID in both `VITE_YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_ID`; put the client secret only in `YOUTUBE_CLIENT_SECRET`.

The app requests only `https://www.googleapis.com/auth/youtube.readonly`. Google may require OAuth app verification for broader production use, depending on consent-screen configuration and user audience.

## SoundCloud configuration

Create an application in the SoundCloud developer console, configure `http://127.0.0.1:5173/auth/soundcloud/callback`, and set its client ID and secret in the matching variables above. The frontend performs PKCE and state validation; Express exchanges the authorization code at SoundCloud's secure token endpoint and retains/rotates tokens server-side.

## Spotify configuration

Create an app in the Spotify Developer Dashboard and register this exact redirect URI:

```text
http://127.0.0.1:5173/auth/spotify/callback
```

Set the app's client ID in both `SPOTIFY_CLIENT_ID` and `VITE_SPOTIFY_CLIENT_ID`. The required Spotify scopes are `streaming`, `user-library-read`, `user-read-private`, `user-read-playback-state`, `user-read-currently-playing`, and `user-modify-playback-state`. The app fetches saved tracks a page at a time. The official Web Playback SDK requires an eligible Spotify Premium account; playback also depends on Spotify app availability and account/device restrictions.

Run the frontend at `http://127.0.0.1:5173` when connecting Spotify so the callback origin matches the registered URI. Keep the backend on port `3001`.

## OAuth and API behavior

SoundCloud, YouTube, and Spotify use HTTP-only server session cookies. Spotify uses PKCE; access and refresh tokens remain in the backend session. A short-lived Spotify access token is returned without caching only when the official Web Playback SDK requests it. The backend refreshes tokens and returns normalized profile/library metadata.

YouTube library data comes from the official YouTube Data API v3 (`channels`, `videos`, `playlists`, and `playlistItems`) with pagination. Playback uses the official embedded player; this app does not download, proxy, extract, or store YouTube media. Some videos cannot be embedded because of owner restrictions, age/location limits, or availability and will display a player error.

YouTube's embedded player must remain visible and at least 200 by 200 pixels. Playback can be limited by browser autoplay policy, so users may need to initiate playback with a click. Only public/embeddable video playback is guaranteed; a liked item is not necessarily playable in an embed.

## Unified track shape

```js
{
  id,
  provider: "soundcloud" | "spotify" | "youtube",
  providerId,
  title,
  artist,
  artwork,
  url,
  playable
}
```

All three development redirect URIs must use `127.0.0.1`; add the SoundCloud and Google redirect URIs above to their provider dashboards as well as keeping Spotify's registered URI. Existing sessions created under `localhost` cannot be shared with `127.0.0.1` because local storage and host-only cookies are origin scoped. Connect each provider once at `http://127.0.0.1:5173` to establish its sessions on the canonical origin.
