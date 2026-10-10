import { UnifiedPlayer } from "./UnifiedPlayer";
import { SoundCloudWidgetAdapter } from "./adapters/SoundCloudWidgetAdapter";
import { SpotifyPlayerAdapter } from "./adapters/SpotifyPlayerAdapter";
import { YouTubePlayerAdapter } from "./adapters/YouTubePlayerAdapter";

export function createPlayer(spotifyAuthProvider) {
  return new UnifiedPlayer({
    soundcloud: new SoundCloudWidgetAdapter(),
    spotify: new SpotifyPlayerAdapter(spotifyAuthProvider),
    youtube: new YouTubePlayerAdapter(),
  });
}