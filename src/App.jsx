import { useEffect, useMemo, useRef, useState } from "react";
import { SoundCloudCallbackPage } from "./auth/soundcloud/CallbackPage";
import { SpotifyCallbackPage } from "./auth/spotify/CallbackPage";
import { YouTubeCallbackPage } from "./auth/youtube/CallbackPage";
import { createPlayer } from "./player/createPlayer";
import { MediaView } from "./MediaView";
import { playlistsApi } from "./playlists/playlistsApi";
import { auth, library } from "./providers";

const providerMeta = {
  soundcloud: { name: "SoundCloud", icon: "☁", className: "soundcloud" },
  spotify: { name: "Spotify", icon: "●", className: "spotify" },
  youtube: { name: "YouTube", icon: "▶", className: "youtube" },
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export default function App({ account, onAccountChange, onOpenSetup, onSignOut }) {
  const player = useMemo(() => createPlayer(auth.providers.spotify), []);
  const [connected, setConnected] = useState({
    soundcloud: auth.isConnected("soundcloud"),
    spotify: auth.isConnected("spotify"),
    youtube: auth.isConnected("youtube"),
  });
  const [profiles, setProfiles] = useState({ soundcloud: null, spotify: null, youtube: null });
  const [soundcloudPlaylists, setSoundcloudPlaylists] = useState([]);
  const [youtubePlaylists, setYoutubePlaylists] = useState([]);
  const [appPlaylists, setAppPlaylists] = useState([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [playlist, setPlaylist] = useState("all-liked");
  const [tracks, setTracks] = useState([]);
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [progress, setProgress] = useState({ currentTime: 0, duration: 0 });
  const [volume, setVolume] = useState(player.volume);
  const [youtubeLikedNextPageToken, setYoutubeLikedNextPageToken] = useState(null);
  const [spotifyLikedNextOffset, setSpotifyLikedNextOffset] = useState(null);
  const [loadingMoreSpotify, setLoadingMoreSpotify] = useState(false);
  const [spotifyPlayerStatus, setSpotifyPlayerStatus] = useState("idle");
  const [loadingMoreLiked, setLoadingMoreLiked] = useState(false);
  const libraryRequestId = useRef(0);
  const moreRequestId = useRef(0);
  const loadMoreInFlight = useRef(false);
  const [message, setMessage] = useState("");

  const invalidateLibraryRequests = () => {
    libraryRequestId.current += 1;
    moreRequestId.current += 1;
    loadMoreInFlight.current = false;
    setLoadingMoreLiked(false);
    setLoadingMoreSpotify(false);
    return libraryRequestId.current;
  };

  const currentAppPlaylistId = playlist.startsWith("app-playlist:") ? playlist.replace("app-playlist:", "") : null;

  const createAppPlaylist = async (event) => {
    event.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;
    try {
      const created = await playlistsApi.create(name);
      setAppPlaylists((previous) => [...previous, created]);
      setNewPlaylistName("");
      setMessage(`Created playlist “${name}”.`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const addTrackToAppPlaylist = async (playlistId, track) => {
    const targetPlaylist = appPlaylists.find((item) => item.id === playlistId);
    if (!targetPlaylist) return;
    try {
      const saved = await playlistsApi.addTrack(playlistId, track);
      setAppPlaylists((previous) => previous.map((item) =>
        item.id === playlistId ? { ...item, trackCount: (item.trackCount || 0) + 1 } : item));
      if (currentAppPlaylistId === playlistId) setTracks((previous) => [...previous, saved]);
      setMessage(`Added ${track.title} to ${targetPlaylist.title}.`);
    } catch (error) {
      setMessage(error.status === 409 ? `${track.title} is already in ${targetPlaylist.title}.` : error.message);
    }
  };

  const renameAppPlaylist = async () => {
    const target = appPlaylists.find((item) => item.id === currentAppPlaylistId);
    const name = target && window.prompt("Rename playlist", target.title)?.trim();
    if (!name || name === target.title) return;
    try {
      const updated = await playlistsApi.rename(target.id, name);
      setAppPlaylists((previous) => previous.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    } catch (error) {
      setMessage(error.message);
    }
  };

  const deleteAppPlaylist = async () => {
    const target = appPlaylists.find((item) => item.id === currentAppPlaylistId);
    if (!target || !window.confirm(`Delete “${target.title}”? This can't be undone.`)) return;
    try {
      await playlistsApi.remove(target.id);
      setAppPlaylists((previous) => previous.filter((item) => item.id !== target.id));
      setPlaylist("all-liked");
      setTracks([]);
      setMessage(`Deleted “${target.title}”.`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const removeFromAppPlaylist = async (track) => {
    try {
      await playlistsApi.removeTrack(currentAppPlaylistId, track.playlistTrackId);
      const remaining = tracks.filter((item) => item.playlistTrackId !== track.playlistTrackId);
      setTracks(remaining);
      player.setQueue(remaining);
      setAppPlaylists((previous) => previous.map((item) =>
        item.id === currentAppPlaylistId ? { ...item, trackCount: remaining.length } : item));
    } catch (error) {
      setMessage(error.message);
    }
  };

  const moveInAppPlaylist = async (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= tracks.length) return;
    const reordered = [...tracks];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setTracks(reordered);
    player.setQueue(reordered);
    try {
      await playlistsApi.reorder(currentAppPlaylistId, reordered.map((item) => item.playlistTrackId));
    } catch (error) {
      setMessage(error.message);
      setTracks(tracks);
      player.setQueue(tracks);
    }
  };

  const queuePlaylist = () => {
    player.setQueue(tracks);
    setMessage(`Queued ${tracks.length} tracks.`);
  };

  const loadSoundCloudLibrary = async () => {
    try {
      const [likedTracks, playlists] = await Promise.all([
        library.getLikedTracks("soundcloud"),
        library.getPlaylists("soundcloud"),
      ]);
      setSoundcloudPlaylists(playlists);
      setTracks(likedTracks);
      player.setQueue(likedTracks);
      setPlaylist("soundcloud-liked");
      return { likedTracks, playlists };
    } catch (error) {
      setMessage(error.message);
      return { likedTracks: [], playlists: [] };
    }
  };

  const loadYouTubeLibrary = async () => {
    const requestId = invalidateLibraryRequests();
    setPlaylist("youtube-liked");
    setTracks([]);
    setYoutubeLikedNextPageToken(null);
    library.getPlaylists("youtube")
      .then((playlists) => {
        if (requestId === libraryRequestId.current) setYoutubePlaylists(playlists);
      })
      .catch((error) => {
        if (requestId === libraryRequestId.current) setMessage(error.message);
      });
    try {
      const page = await library.getLikedTracksPage("youtube");
      if (requestId !== libraryRequestId.current) return { likedTracks: [], playlists: [] };
      setTracks(page.tracks);
      player.setQueue(page.tracks);
      setYoutubeLikedNextPageToken(page.nextPageToken);
      return { likedTracks: page.tracks, playlists: [] };
    } catch (error) {
      if (requestId === libraryRequestId.current) setMessage(error.message);
      return { likedTracks: [], playlists: [] };
    }
  };

  const loadSpotifyLibrary = async () => {
    const requestId = invalidateLibraryRequests();
    setPlaylist("spotify-liked");
    setTracks([]);
    setSpotifyLikedNextOffset(null);
    try {
      const page = await library.getLikedTracksPage("spotify");
      if (requestId !== libraryRequestId.current) return;
      setTracks(page.tracks);
      player.setQueue(page.tracks);
      setSpotifyLikedNextOffset(page.nextOffset);
    } catch (error) {
      if (requestId === libraryRequestId.current) setMessage(error.message);
    }
  };

  const warmUpProvider = (provider) => {
    if (provider === "spotify" || provider === "youtube") {
      player.adapters[provider]?.initialize?.().catch(() => {});
    }
  };

  const refreshProfile = async (provider) => {
    try {
      const user = await library.getCurrentUser(provider);
      setProfiles((previous) => ({ ...previous, [provider]: user }));
      setConnected((previous) => ({ ...previous, [provider]: Boolean(user) }));
      if (user) warmUpProvider(provider);
      else onAccountChange?.();
      if (provider === "soundcloud") await loadSoundCloudLibrary();
      if (provider === "youtube") await loadYouTubeLibrary();
      if (provider === "spotify") await loadSpotifyLibrary();
    } catch (error) {
      setMessage(error.message);
      setConnected((previous) => ({ ...previous, [provider]: false }));
    }
  };

  useEffect(() => {
    player.setOnTrackChange?.(setCurrent);
    player.setOnProgress?.(setProgress);
    player.setOnPlayingChange?.(setPlaying);
    player.adapters.youtube?.setOnError?.((error) => setMessage(error.message));
    player.adapters.spotify?.setOnError?.((error) => setMessage(error.message));
    player.adapters.spotify?.setOnStatusChange?.((status, error) => {
      setSpotifyPlayerStatus(status);
      if (status === "error" && error) setMessage(error.message);
    });
    if (auth.isConnected("soundcloud")) refreshProfile("soundcloud");
    if (auth.isConnected("youtube")) refreshProfile("youtube");
    if (auth.isConnected("spotify")) refreshProfile("spotify");
    playlistsApi.list().then(setAppPlaylists).catch((error) => setMessage(error.message));
  }, []);

  const clearCallbackPath = () => window.history.replaceState({}, "", "/");

  const handleCallbackComplete = async (provider, result) => {
    if (result instanceof Error) {
      setMessage(result.message);
      clearCallbackPath();
      onAccountChange?.();
      return;
    }
    if (result?.user) {
      setProfiles((previous) => ({ ...previous, [provider]: result.user }));
      setConnected((previous) => ({ ...previous, [provider]: true }));
      warmUpProvider(provider);
      setMessage(`${providerMeta[provider].name} connected.`);
      if (provider === "soundcloud") await loadSoundCloudLibrary();
      if (provider === "youtube") await loadYouTubeLibrary();
      if (provider === "spotify") await loadSpotifyLibrary();
    }
    clearCallbackPath();
    onAccountChange?.();
  };

  const soundCloudCallback = window.location.pathname === "/auth/soundcloud/callback";
  const spotifyCallback = window.location.pathname === "/auth/spotify/callback";
  const youtubeCallback = window.location.pathname === "/auth/youtube/callback";

  if (soundCloudCallback) {
    return <SoundCloudCallbackPage onComplete={(result) => handleCallbackComplete("soundcloud", result)} onError={(error) => setMessage(error.message)} />;
  }
  if (youtubeCallback) {
    return <YouTubeCallbackPage onComplete={(result) => handleCallbackComplete("youtube", result)} onError={(error) => { setMessage(error.message); clearCallbackPath(); onAccountChange?.(); }} />;
  }
  if (spotifyCallback) {
    return <SpotifyCallbackPage onComplete={(result) => handleCallbackComplete("spotify", result)} onError={(error) => { setMessage(error.message); clearCallbackPath(); onAccountChange?.(); }} />;
  }

  const loadPlaylist = async (id) => {
    const requestId = invalidateLibraryRequests();
    setPlaylist(id);
    setTracks([]);
    setYoutubeLikedNextPageToken(null);
    setSpotifyLikedNextOffset(null);
    try {
      let result;
      if (id === "all-liked") {
        const providers = ["soundcloud", "youtube", "spotify"].filter((provider) => auth.isConnected(provider));
        result = (await Promise.all(providers.map((provider) => library.getLikedTracks(provider)))).flat();
      } else if (id === "soundcloud-liked") {
        result = await library.getLikedTracks("soundcloud");
      } else if (id.startsWith("soundcloud-playlist:")) {
        result = await library.getPlaylistTracks("soundcloud", id.replace("soundcloud-playlist:", ""));
      } else if (id === "youtube-liked") {
        const page = await library.getLikedTracksPage("youtube");
        result = page.tracks;
        if (requestId === libraryRequestId.current) setYoutubeLikedNextPageToken(page.nextPageToken);
      } else if (id.startsWith("youtube-playlist:")) {
        result = await library.getPlaylistTracks("youtube", id.replace("youtube-playlist:", ""));
      } else if (id === "spotify-liked") {
        const page = await library.getLikedTracksPage("spotify");
        result = page.tracks;
        if (requestId === libraryRequestId.current) setSpotifyLikedNextOffset(page.nextOffset);
      } else if (id.startsWith("app-playlist:")) {
        result = (await playlistsApi.get(id.replace("app-playlist:", ""))).tracks;
      } else {
        result = [];
      }
      if (requestId !== libraryRequestId.current) return;
      setTracks(result);
      player.setQueue(result);
    } catch (error) {
      if (requestId === libraryRequestId.current) setMessage(error.message);
    }
  };

  const loadMoreYouTubeLiked = async () => {
    if (!youtubeLikedNextPageToken || loadMoreInFlight.current || playlist !== "youtube-liked") return;
    loadMoreInFlight.current = true;
    const requestId = libraryRequestId.current;
    const moreId = ++moreRequestId.current;
    setLoadingMoreLiked(true);
    try {
      const page = await library.getLikedTracksPage("youtube", { pageToken: youtubeLikedNextPageToken });
      if (requestId !== libraryRequestId.current || playlist !== "youtube-liked") return;
      setTracks((previous) => {
        const appended = [...previous, ...page.tracks];
        player.setQueue(appended);
        return appended;
      });
      setYoutubeLikedNextPageToken(page.nextPageToken);
    } catch (error) {
      if (requestId === libraryRequestId.current) setMessage(error.message);
    } finally {
      if (moreId === moreRequestId.current) {
        loadMoreInFlight.current = false;
        setLoadingMoreLiked(false);
      }
    }
  };

  const loadMoreSpotifyTracks = async () => {
    if (spotifyLikedNextOffset === null || loadMoreInFlight.current || playlist !== "spotify-liked") return;
    loadMoreInFlight.current = true;
    const requestId = libraryRequestId.current;
    const moreId = ++moreRequestId.current;
    setLoadingMoreSpotify(true);
    try {
      const page = await library.getLikedTracksPage("spotify", { offset: spotifyLikedNextOffset });
      if (requestId !== libraryRequestId.current || playlist !== "spotify-liked") return;
      setTracks((previous) => {
        const appended = [...previous, ...page.tracks];
        player.setQueue(appended);
        return appended;
      });
      setSpotifyLikedNextOffset(page.nextOffset);
    } catch (error) {
      if (requestId === libraryRequestId.current) setMessage(error.message);
    } finally {
      if (moreId === moreRequestId.current) {
        loadMoreInFlight.current = false;
        setLoadingMoreSpotify(false);
      }
    }
  };

  const handleLogin = async (provider) => {
    if (auth.isConnected(provider)) {
      try {
        await auth.logout(provider);
        setConnected((previous) => ({ ...previous, [provider]: false }));
        setProfiles((previous) => ({ ...previous, [provider]: null }));
        if (current?.provider === provider) await player.stop();
        if (provider === "spotify") {
          await player.adapters.spotify?.destroy();
          setSpotifyPlayerStatus("idle");
          setSpotifyLikedNextOffset(null);
        }
        setMessage(`${providerMeta[provider].name} disconnected.`);
        onAccountChange?.();
      } catch (error) {
        setMessage(error.message);
      }
      return;
    }
    try {
      await auth.login(provider);
      setMessage(`Redirecting to ${providerMeta[provider].name} for authorization...`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const playTrack = async (track) => {
    setMessage("");
    if (track.provider === "spotify" && !auth.isConnected("spotify")) {
      setMessage("Connect Spotify to play Spotify tracks.");
      return;
    }
    player.setQueue(tracks);
    try {
      await player.play(track);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const playQueuedTrack = async (track) => {
    try {
      await player.play(track);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const changeVolume = (event) => {
    const value = Number(event.target.value);
    setVolume(value);
    player.setVolume(value);
  };

  const togglePlayback = async () => {
    try { await player.togglePlayback(); } catch (error) { setMessage(error.message); }
  };
  const seekTo = async (event) => {
    const seconds = Number(event.target.value);
    setProgress((previous) => ({ ...previous, currentTime: seconds }));
    try { await player.seek(seconds); } catch (error) { setMessage(error.message); }
  };
  const skipPrevious = async () => {
    try { await player.previous(); } catch (error) { setMessage(error.message); }
  };
  const skipNext = async () => {
    try { await player.next(); } catch (error) { setMessage(error.message); }
  };

  const playlistDisplayName = playlist === "all-liked" ? "Liked Songs"
    : playlist === "soundcloud-liked" ? "SoundCloud Liked"
      : playlist === "youtube-liked" ? "YouTube Liked"
        : playlist === "spotify-liked" ? "Spotify Liked Songs"
          : soundcloudPlaylists.find((item) => `soundcloud-playlist:${item.id}` === playlist)?.title
            || youtubePlaylists.find((item) => `youtube-playlist:${item.id}` === playlist)?.title
            || appPlaylists.find((item) => `app-playlist:${item.id}` === playlist)?.title
            || playlist;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">SENADA</div>
        <div className="brand-sub">MUSIC</div>
        <section className="side-section">
          <div className="section-label">ACCOUNTS</div>
          {account && <div className="user-row">
            {account.user.avatarUrl ? <img src={account.user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="user-initial" aria-hidden="true">{account.user.displayName.slice(0, 1)}</span>}
            <div><div className="profile-name">{account.user.displayName}</div><small>Google ✓</small></div>
          </div>}
          {Object.entries(providerMeta).map(([key, provider]) => {
            const needsReconnect = !connected[key] && account?.providerStatus?.[key] === "needs_reconnect";
            return (
              <button className={`account ${provider.className}`} key={key} onClick={() => handleLogin(key)} title={connected[key] ? `Disconnect ${provider.name}` : needsReconnect ? `Reconnect ${provider.name}` : `Connect ${provider.name}`}>
                <span>{provider.icon}</span><span>{provider.name}{connected[key] ? " ✓" : ""}</span>
                <span className="status">{connected[key] ? "Disconnect" : needsReconnect ? "⚠ Reconnect" : "Connect"}</span>
              </button>
            );
          })}
          {account && <div className="account-actions">
            <button onClick={onOpenSetup}>Connect your music</button>
            <button onClick={onSignOut}>Log out</button>
          </div>}
        </section>
        {connected.soundcloud && profiles.soundcloud && <div className="profile-row"><img src={profiles.soundcloud.avatar_url || "https://soundcloud.com/favicon.ico"} alt="" /><div><div className="profile-name">{profiles.soundcloud.username}</div><small>SoundCloud connected</small></div></div>}
        {connected.youtube && profiles.youtube && <div className="profile-row">{profiles.youtube.thumbnail && <img src={profiles.youtube.thumbnail} alt="" />}<div><div className="profile-name">{profiles.youtube.title}</div><small>YouTube connected</small></div></div>}
        {connected.spotify && profiles.spotify && <div className="profile-row">{profiles.spotify.images?.[0]?.url && <img src={profiles.spotify.images[0].url} alt="" />}<div><div className="profile-name">{profiles.spotify.display_name || profiles.spotify.id}</div><small>Spotify connected</small></div></div>}

        <section className="side-section">
          <div className="section-label">LIBRARY</div>
          <button className={playlist === "all-liked" ? "nav active" : "nav"} onClick={() => loadPlaylist("all-liked")}>♥ Liked Songs</button>
          {connected.soundcloud && <>
            <button className={playlist === "soundcloud-liked" ? "nav active" : "nav"} onClick={() => loadPlaylist("soundcloud-liked")}>☁ SoundCloud Liked</button>
            {soundcloudPlaylists.map((item) => <button key={item.id} className={playlist === `soundcloud-playlist:${item.id}` ? "nav active" : "nav"} onClick={() => loadPlaylist(`soundcloud-playlist:${item.id}`)}>☁ {item.title}</button>)}
          </>}
          {connected.youtube && <>
            <button className={playlist === "youtube-liked" ? "nav active" : "nav"} onClick={() => loadPlaylist("youtube-liked")}>▶ YouTube Liked</button>
            {youtubePlaylists.map((item) => <button key={item.id} className={playlist === `youtube-playlist:${item.id}` ? "nav active" : "nav"} onClick={() => loadPlaylist(`youtube-playlist:${item.id}`)}>▶ {item.title}</button>)}
          </>}
          {connected.spotify && <button className={playlist === "spotify-liked" ? "nav active" : "nav"} onClick={() => loadPlaylist("spotify-liked")}>● Spotify Liked Songs</button>}
        </section>
        <section className="side-section app-playlists-section">
          <div className="section-label">MY PLAYLISTS</div>
          <form className="create-playlist-form" onSubmit={createAppPlaylist}>
            <input aria-label="New playlist name" placeholder="Playlist name" value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} maxLength={60} />
            <button type="submit" disabled={!newPlaylistName.trim()} aria-label="Create playlist" title="Create playlist">+</button>
          </form>
          {appPlaylists.map((item) => <button key={item.id} className={playlist === `app-playlist:${item.id}` ? "nav active" : "nav"} onClick={() => loadPlaylist(`app-playlist:${item.id}`)}>♫ {item.title}<span className="playlist-count">{item.trackCount ?? 0}</span></button>)}
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">ONE LIBRARY</div><h1>i like music more than people</h1></div>
          <div className="connection-count">{Object.values(connected).filter(Boolean).length}/3 connected</div>
        </header>
        <div className="notice">
          <strong>SoundCloud, YouTube, and Spotify</strong> use their official account, library, and playback integrations.
          {!connected.spotify && <span className="spotify-status"> Connect Spotify to play Spotify tracks.</span>}
          {connected.spotify && spotifyPlayerStatus === "loading" && <span className="spotify-status"> Connecting to Spotify player...</span>}
          {connected.spotify && spotifyPlayerStatus === "ready" && <span className="spotify-status"> Spotify player ready.</span>}
        </div>
        {message && <div className="message" role="status">{message}</div>}

        <MediaView
          current={current}
          open={mediaOpen}
          onClose={() => setMediaOpen(false)}
          providerName={current ? providerMeta[current.provider]?.name : ""}
          providerIcon={current ? providerMeta[current.provider]?.icon : ""}
        />
        <iframe id="soundcloud-widget" title="SoundCloud player" allow="autoplay" className="soundcloud-iframe" />

        <section className="library-header">
          <div><div className="eyebrow">CURRENT LIBRARY</div><h2>{playlistDisplayName}</h2></div>
          <div className="library-actions">
            <span>{tracks.length} tracks</span>
            {currentAppPlaylistId && <>
              <button className="playlist-action" onClick={() => tracks[0] && playTrack(tracks[0])} disabled={tracks.length === 0}>Play</button>
              <button className="playlist-action" onClick={queuePlaylist} disabled={tracks.length === 0}>Queue</button>
              <button className="playlist-action" onClick={renameAppPlaylist}>Rename</button>
              <button className="playlist-action danger" onClick={deleteAppPlaylist}>Delete</button>
            </>}
          </div>
        </section>

        {queueOpen && <section className="queue-panel" id="playback-queue" aria-label="Playback queue">
          <div className="queue-heading"><div><div className="eyebrow">UP NEXT</div><h3>Queue</h3></div><span>{player.queue.length} songs</span></div>
          {player.queue.length === 0 ? <p className="queue-empty">Play a song to start the queue.</p> : <ol className="queue-list">
            {player.queue.map((track, index) => <li key={`${track.provider}:${track.id}`}>
              <button className={`queue-track ${player.queueIndex === index ? "current" : ""}`} onClick={() => playQueuedTrack(track)} aria-current={player.queueIndex === index ? "true" : undefined}>
                <span className="queue-position">{player.queueIndex === index && playing ? "▶" : String(index + 1).padStart(2, "0")}</span>
                <span className="queue-artwork">{track.artwork ? <img src={track.artwork} alt="" /> : providerMeta[track.provider]?.icon || "♫"}</span>
                <span className="queue-track-info"><strong>{track.title}</strong><small>{track.artist}</small></span>
                <span className={`provider-pill ${track.provider}`}>{providerMeta[track.provider]?.name || track.provider}</span>
              </button>
            </li>)}
          </ol>}
        </section>}

        <section className="track-list">
          {tracks.map((track, index) => <div className="track-row" key={track.id}>
            <button className={`track ${current?.id === track.id ? "playing" : ""}`} onClick={() => playTrack(track)}>
              <span className="track-number">{index + 1}</span>
              <span className="cover">{track.artwork ? <img src={track.artwork} alt="" /> : providerMeta[track.provider]?.icon || "♫"}</span>
              <span className="track-info"><strong>{track.title}</strong><small>{track.album ? `${track.artist} · ${track.album}` : track.artist}</small></span>
              <span className={`provider-pill ${track.provider}`}>{providerMeta[track.provider]?.name || track.provider}</span>
              <span className="play-icon">{track.playable ? "▶" : "○"}</span>
            </button>
            {currentAppPlaylistId ? (
              <div className="row-actions">
                <button onClick={() => moveInAppPlaylist(index, -1)} disabled={index === 0} aria-label={`Move ${track.title} up`} title="Move up">↑</button>
                <button onClick={() => moveInAppPlaylist(index, 1)} disabled={index === tracks.length - 1} aria-label={`Move ${track.title} down`} title="Move down">↓</button>
                <button onClick={() => removeFromAppPlaylist(track)} aria-label={`Remove ${track.title} from playlist`} title="Remove from playlist">✕</button>
              </div>
            ) : (
              <select className="add-track-select" aria-label={`Add ${track.title} to an app playlist`} defaultValue="" disabled={appPlaylists.length === 0} onChange={(event) => { addTrackToAppPlaylist(event.target.value, track); event.target.value = ""; }}>
              <option value="" disabled>{appPlaylists.length ? "+ Playlist" : "No playlists"}</option>
              {appPlaylists.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            )}
          </div>)}
        </section>

        {playlist === "youtube-liked" && youtubeLikedNextPageToken && <div className="load-more-wrap"><button className="load-more" onClick={loadMoreYouTubeLiked} disabled={loadingMoreLiked}>{loadingMoreLiked ? "Loading more..." : "Load more"}</button></div>}
        {playlist === "spotify-liked" && spotifyLikedNextOffset !== null && <div className="load-more-wrap"><button className="load-more" onClick={loadMoreSpotifyTracks} disabled={loadingMoreSpotify}>{loadingMoreSpotify ? "Loading more..." : "Load more"}</button></div>}

        <div className="player-bar">
          <div className="now-playing">
            <div><strong>{current?.title ?? "Nothing playing"}</strong><span>{current?.artist ?? "Choose a track"}</span></div>
          </div>
          <div className="controls">
            <button onClick={skipPrevious} disabled={!current || player.queueIndex <= 0} aria-label="Previous song" title="Previous song">|◀</button>
            <button onClick={togglePlayback} disabled={!current} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"}>{playing ? "Ⅱ" : "▶"}</button>
            <button onClick={skipNext} disabled={!current || player.queueIndex < 0 || player.queueIndex >= player.queue.length - 1} aria-label="Next song" title="Next song">▶|</button>
            <div className="timeline"><span>{formatTime(progress.currentTime)}</span><input type="range" min="0" max={Math.max(progress.duration, 1)} step="0.1" value={Math.min(progress.currentTime, progress.duration || 0)} onChange={seekTo} disabled={!current || !progress.duration} aria-label="Seek through song" /><span>{formatTime(progress.duration)}</span></div>
          </div>
          <div className="player-right">
            <div className="player-provider">
              <span>{current ? providerMeta[current.provider]?.name : "Universal Player"}</span>
              <label className="volume"><span aria-hidden="true">{volume === 0 ? "🔇" : "🔊"}</span><input type="range" min="0" max="100" value={volume} onChange={changeVolume} aria-label="Volume" /></label>
            </div>
            <div className="player-actions">
              <button className={`queue-toggle ${queueOpen ? "active" : ""}`} onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="playback-queue">Queue <span>{player.queue.length}</span></button>
              <button className={`media-toggle ${mediaOpen ? "active" : ""}`} onClick={() => setMediaOpen((open) => !open)} aria-expanded={mediaOpen} aria-controls="now-playing-media">
                {mediaOpen ? "Hide media" : "Show media"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
