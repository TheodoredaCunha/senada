export const demoTracks = [
  {
    id: "sc-demo",
    provider: "soundcloud",
    providerId: "https://soundcloud.com/mtmrecords/sets/mtm-records-demo",
    title: "SoundCloud Demo",
    artist: "SoundCloud",
    artwork: "https://i1.sndcdn.com/artworks-000000000000-demo-t500x500.jpg",
    playable: true,
    url: "https://soundcloud.com/mtmrecords/sets/mtm-records-demo",
  },
  {
    id: "spotify-demo",
    provider: "spotify",
    providerId: "spotify:track:demo",
    title: "Spotify Track",
    artist: "Spotify",
    artwork: "",
    playable: false,
  },
  {
    id: "youtube-demo",
    provider: "youtube",
    providerId: "youtube:video:demo",
    title: "YouTube Music Track",
    artist: "YouTube",
    artwork: "",
    playable: false,
  },
];

export const demoPlaylists = [
  {
    id: "all-liked",
    title: "Liked Songs",
    provider: "unified",
    tracks: demoTracks,
  },
  {
    id: "soundcloud-liked",
    title: "SoundCloud Liked",
    provider: "soundcloud",
    tracks: [demoTracks[0]],
  },
  {
    id: "spotify-liked",
    title: "Spotify Liked",
    provider: "spotify",
    tracks: [demoTracks[1]],
  },
  {
    id: "youtube-liked",
    title: "YouTube Liked",
    provider: "youtube",
    tracks: [demoTracks[2]],
  },
];