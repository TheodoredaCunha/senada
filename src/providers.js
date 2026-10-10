import { AuthManager } from "./auth/AuthManager";
import { SoundCloudAuthProvider } from "./auth/providers/SoundCloudAuthProvider";
import { SpotifyAuthProvider } from "./auth/providers/SpotifyAuthProvider";
import { YouTubeAuthProvider } from "./auth/providers/YouTubeAuthProvider";
import { LibraryManager } from "./library/LibraryManager";
import { SoundCloudLibraryProvider } from "./library/providers/SoundCloudLibraryProvider";
import { SpotifyLibraryProvider } from "./library/providers/SpotifyLibraryProvider";
import { YouTubeLibraryProvider } from "./library/providers/YouTubeLibraryProvider";

const soundcloudAuth = new SoundCloudAuthProvider("soundcloud");
export const spotifyAuth = new SpotifyAuthProvider("spotify");
const youtubeAuth = new YouTubeAuthProvider("youtube");

export const auth = new AuthManager({
  soundcloud: soundcloudAuth,
  spotify: spotifyAuth,
  youtube: youtubeAuth,
});

export const library = new LibraryManager({
  soundcloud: new SoundCloudLibraryProvider(soundcloudAuth, "soundcloud"),
  spotify: new SpotifyLibraryProvider(spotifyAuth, "spotify"),
  youtube: new YouTubeLibraryProvider(youtubeAuth, "youtube"),
});