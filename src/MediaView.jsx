import { useEffect } from "react";

// Presentation only. #youtube-player stays mounted so the single YT.Player instance survives open/close and track changes.
export function MediaView({ current, open, onClose, providerName, providerIcon }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const isYouTube = current?.provider === "youtube";
  const showArtwork = current && !isYouTube;

  return (
    <section
      className={`media-stage ${open ? "expanded" : "collapsed"}`}
      id="now-playing-media"
      aria-label="Now playing media"
      aria-hidden={!open}
    >
      {showArtwork && current.artwork && (
        <div className="media-backdrop" style={{ backgroundImage: `url("${current.artwork}")` }} aria-hidden="true" />
      )}
      <button className="media-close" onClick={onClose} aria-label="Close media view" title="Close media view" tabIndex={open ? 0 : -1}>
        <span aria-hidden="true">↓</span> Close
      </button>

      <div className="media-body">
        <div className={`youtube-player-shell ${isYouTube ? "visible" : "hidden"}`}>
          <div id="youtube-player" />
        </div>

        {showArtwork && (
          <div className="media-artwork">
            {current.artwork
              ? <img src={current.artwork} alt={`Artwork for ${current.title} by ${current.artist}`} />
              : <span aria-hidden="true">{providerIcon || "♫"}</span>}
          </div>
        )}

        {!current && <p className="media-empty">Nothing playing. Choose a track to see it here.</p>}
      </div>

      {current && (
        <div className="media-caption">
          <strong>{current.title}</strong>
          <span>{current.artist}</span>
          <span className={`provider-pill ${current.provider}`}>{providerName}</span>
        </div>
      )}
    </section>
  );
}
