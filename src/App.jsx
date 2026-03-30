import { useState, useEffect, useCallback, useRef } from 'react';

/* ═══════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════ */

const STORAGE_KEY = 'kidstube_config';
const DEFAULT_PIN = '1234';
const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

const COLORS = {
  bg: '#FFF8E7', primary: '#FF6B6B', secondary: '#4ECDC4',
  accent: '#FFE66D', purple: '#A78BFA', blue: '#60A5FA',
  green: '#34D399', orange: '#FB923C', pink: '#F472B6',
  text: '#2D3436', textLight: '#636E72', white: '#FFFFFF',
  dark: '#1a1a2e', shadow: 'rgba(0,0,0,0.08)',
};

const PILL_COLORS = ['#FF6B6B','#4ECDC4','#A78BFA','#60A5FA','#34D399','#FB923C','#F472B6','#FBBF24'];

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    pin: DEFAULT_PIN,
    clientId: '',
    accessToken: '',
    tokenExpiry: 0,
    userName: '',
    userPhoto: '',
    whitelist: ['Bumba', 'Knabbel en Babbel', 'Timmy het schaapje', 'Donald Duck', 'Peppa Pig'],
    cachedVideos: {},
  };
}

function saveConfig(config) {
  try {
    // Don't persist access token — it's short-lived and kept in memory only
    const toSave = { ...config, accessToken: '', tokenExpiry: 0 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

/* ═══════════════════════════════════════════
   GOOGLE IDENTITY SERVICES
   ═══════════════════════════════════════════ */

let gsiLoaded = false;
let gsiLoadPromise = null;

function loadGSI() {
  if (gsiLoaded) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => { gsiLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Google Identity Services laden mislukt'));
    document.head.appendChild(script);
  });
  return gsiLoadPromise;
}

function requestGoogleToken(clientId) {
  return new Promise(async (resolve, reject) => {
    try {
      await loadGSI();
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: YOUTUBE_SCOPES,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error));
          } else {
            resolve({
              accessToken: response.access_token,
              expiresIn: response.expires_in,
            });
          }
        },
        error_callback: (err) => {
          reject(new Error(err.message || 'Login geannuleerd'));
        },
      });
      client.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Gebruikersinfo ophalen mislukt');
  return res.json();
}

function revokeGoogleToken(accessToken) {
  if (!accessToken) return;
  try { window.google?.accounts?.oauth2?.revoke(accessToken); } catch {}
}

/* ═══════════════════════════════════════════
   YOUTUBE API (met OAuth token)
   ═══════════════════════════════════════════ */

async function searchYouTube(accessToken, query, maxResults = 12) {
  const url = `https://www.googleapis.com/youtube/v3/search?` +
    `part=snippet&type=video&safeSearch=strict&maxResults=${maxResults}` +
    `&q=${encodeURIComponent(query + ' voor kinderen')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error('TOKEN_EXPIRED');
  if (!res.ok) throw new Error(`YouTube API fout: ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    publishedAt: item.snippet.publishedAt,
  }));
}

async function fetchPlaylistVideos(accessToken, playlistId, maxResults = 20) {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?` +
    `part=snippet&maxResults=${maxResults}` +
    `&playlistId=${encodeURIComponent(playlistId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error('TOKEN_EXPIRED');
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(item => ({
    id: item.snippet.resourceId?.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    publishedAt: item.snippet.publishedAt,
  })).filter(v => v.id);
}

async function fetchAllVideos(accessToken, whitelist) {
  const results = {};
  for (const term of whitelist) {
    try {
      if (term.startsWith('PL')) {
        results[term] = await fetchPlaylistVideos(accessToken, term);
      } else {
        results[term] = await searchYouTube(accessToken, term);
      }
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') throw err;
      console.error(`"${term}" ophalen mislukt:`, err);
      results[term] = [];
    }
  }
  return results;
}

/* ═══════════════════════════════════════════
   FULLSCREEN LOCKDOWN
   ═══════════════════════════════════════════ */

function requestFullscreen() {
  const el = document.documentElement;
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (rfs) rfs.call(el).catch(() => {});
}

function exitFullscreen() {
  const efs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (efs && document.fullscreenElement) efs.call(document).catch(() => {});
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/* ═══════════════════════════════════════════
   PIN SCREEN
   ═══════════════════════════════════════════ */

function PinScreen({ correctPin, onUnlock, title, subtitle }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleDigit = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError(false);
    if (next.length === 4) {
      setTimeout(() => {
        if (next === correctPin) {
          setPin('');
          onUnlock();
        } else {
          setError(true);
          setShake(true);
          setTimeout(() => { setShake(false); setPin(''); }, 500);
        }
      }, 200);
    }
  };

  return (
    <div style={styles.pinContainer}>
      <div style={{ fontSize: 56, marginBottom: 8 }}>🔒</div>
      <h2 style={styles.pinTitle}>{title || 'KidsTube'}</h2>
      <p style={styles.pinSubtitle}>{subtitle || 'Voer de pincode in'}</p>

      <div style={{ ...styles.pinDots, animation: shake ? 'shake 0.4s ease' : 'none' }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            ...styles.pinDot,
            background: i < pin.length ? (error ? COLORS.primary : COLORS.secondary) : '#ddd',
            transform: i < pin.length ? 'scale(1.25)' : 'scale(1)',
          }} />
        ))}
      </div>

      <div style={styles.pinPad}>
        {[1,2,3,4,5,6,7,8,9,null,0,'⌫'].map((d, i) => (
          d === null ? <div key={i} /> :
          <button key={i}
            onClick={() => d === '⌫' ? (setPin(p => p.slice(0,-1)), setError(false)) : handleDigit(String(d))}
            style={{ ...styles.pinBtn, ...(d === '⌫' ? styles.pinBtnDel : {}) }}
          >{d}</button>
        ))}
      </div>
      {error && <p style={styles.pinError}>Verkeerde pincode!</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   YOUTUBE IFRAME API LOADER
   ═══════════════════════════════════════════ */

let ytApiLoaded = false;
let ytApiPromise = null;

function loadYouTubeAPI() {
  if (ytApiLoaded && window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) { ytApiLoaded = true; resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      if (prev) prev();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

/* ═══════════════════════════════════════════
   AD OVERLAY — fun screen during ads
   ═══════════════════════════════════════════ */

const AD_ANIMALS = ['🐶','🐱','🐰','🦊','🐻','🐼','🐨','🦁','🐸','🐵','🦋','🐢','🐙','🦄','🐳','🐬'];
const AD_BG_COLORS = ['#FF6B6B','#4ECDC4','#A78BFA','#60A5FA','#34D399','#FB923C','#F472B6','#FBBF24'];

function AdOverlay() {
  const [animals, setAnimals] = useState([]);
  const [score, setScore] = useState(0);
  const [bgIdx, setBgIdx] = useState(0);
  const frameRef = useRef(null);

  // Spawn floating animals
  useEffect(() => {
    const spawn = () => {
      const a = {
        id: Date.now() + Math.random(),
        emoji: AD_ANIMALS[Math.floor(Math.random() * AD_ANIMALS.length)],
        x: 10 + Math.random() * 75,
        y: 100 + Math.random() * 10,
        size: 32 + Math.random() * 28,
        speed: 1.5 + Math.random() * 2.5,
        wobble: Math.random() * 360,
        wobbleSpeed: 1 + Math.random() * 2,
      };
      setAnimals(prev => [...prev.slice(-14), a]);
    };
    spawn(); spawn(); spawn();
    const interval = setInterval(spawn, 800);
    return () => clearInterval(interval);
  }, []);

  // Animate upward
  useEffect(() => {
    let raf;
    const tick = () => {
      setAnimals(prev => prev
        .map(a => ({ ...a, y: a.y - a.speed * 0.3, wobble: a.wobble + a.wobbleSpeed }))
        .filter(a => a.y > -15)
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pop = (id) => {
    setAnimals(prev => prev.filter(a => a.id !== id));
    setScore(s => s + 1);
    setBgIdx(i => (i + 1) % AD_BG_COLORS.length);
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: `linear-gradient(135deg, ${AD_BG_COLORS[bgIdx]}dd, ${AD_BG_COLORS[(bgIdx+3)%8]}dd)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', overflow: 'hidden',
      fontFamily: "'Nunito', sans-serif", transition: 'background 0.5s ease',
    }}>
      {/* Floating animals to tap */}
      {animals.map(a => (
        <button key={a.id} onClick={() => pop(a.id)} style={{
          position: 'absolute',
          left: `${a.x}%`,
          top: `${a.y}%`,
          fontSize: a.size,
          background: 'none', border: 'none', cursor: 'pointer',
          transform: `translateX(${Math.sin(a.wobble * 0.05) * 20}px) scale(1)`,
          transition: 'transform 0.1s',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))',
          zIndex: 2,
          padding: 0, lineHeight: 1,
        }}>
          {a.emoji}
        </button>
      ))}

      {/* Center message */}
      <div style={{
        zIndex: 3, textAlign: 'center', pointerEvents: 'none',
      }}>
        <div style={{
          fontSize: 52, marginBottom: 8,
          animation: 'adBounce 1.5s ease infinite',
        }}>⏳</div>
        <h3 style={{
          color: '#fff', fontSize: 22, fontWeight: 900,
          textShadow: '0 2px 8px rgba(0,0,0,0.3)',
          margin: '0 0 6px',
        }}>Even wachten...</h3>
        <p style={{
          color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: 600,
          textShadow: '0 1px 4px rgba(0,0,0,0.2)',
          margin: '0 0 16px',
        }}>Tik op de diertjes terwijl je wacht!</p>
        <div style={{
          background: 'rgba(255,255,255,0.25)', borderRadius: 16,
          padding: '8px 24px', display: 'inline-block',
          backdropFilter: 'blur(8px)',
        }}>
          <span style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>
            ⭐ {score}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   YOUTUBE PLAYER (with ad detection)
   ═══════════════════════════════════════════ */

function VideoPlayer({ video, onBack, allVideos }) {
  const [current, setCurrent] = useState(video);
  const [adPlaying, setAdPlaying] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const playerRef = useRef(null);
  const playerContainerRef = useRef(null);
  const pollRef = useRef(null);
  const expectedVideoId = useRef(video.id);
  const others = allVideos.filter(v => v.id !== current.id);

  useEffect(() => { setCurrent(video); expectedVideoId.current = video.id; }, [video]);

  // Load the YT API
  useEffect(() => {
    loadYouTubeAPI().then(() => setApiReady(true));
  }, []);

  // Create / update player
  useEffect(() => {
    if (!apiReady) return;

    // Destroy old player
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    }

    expectedVideoId.current = current.id;
    setAdPlaying(false);

    const container = playerContainerRef.current;
    if (!container) return;

    // Create a fresh div for the player
    const div = document.createElement('div');
    div.id = 'yt-player-' + Date.now();
    container.innerHTML = '';
    container.appendChild(div);

    playerRef.current = new window.YT.Player(div.id, {
      videoId: current.id,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        fs: 0,
      },
      events: {
        onReady: () => { startAdPolling(); },
        onStateChange: (e) => { checkForAd(); },
      },
    });

    return () => {
      stopAdPolling();
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [current.id, apiReady]);

  function checkForAd() {
    const p = playerRef.current;
    if (!p || typeof p.getVideoData !== 'function') return;
    try {
      // Method 1: compare video IDs — during an ad the ID differs
      const data = p.getVideoData();
      const currentId = data?.video_id || '';
      const isAdById = currentId && currentId !== expectedVideoId.current;

      // Method 2: check video URL for ad indicators
      let isAdByUrl = false;
      try {
        const url = p.getVideoUrl?.() || '';
        isAdByUrl = url.includes('&ad_') || url.includes('ad_type');
      } catch {}

      // Method 3: check if player reports ad state (undocumented but works)
      let isAdByState = false;
      try {
        // During ads, getAdState returns 1
        const adState = p.getAdState?.();
        if (adState === 1) isAdByState = true;
      } catch {}

      // Method 4: during pre-roll ads, getDuration() is often very short
      let isAdByDuration = false;
      try {
        const dur = p.getDuration?.() || 0;
        const currentTime = p.getCurrentTime?.() || 0;
        // If video is loaded but duration is < 31s and doesn't match expected video
        if (dur > 0 && dur <= 30 && isAdById) isAdByDuration = true;
      } catch {}

      const isAd = isAdById || isAdByUrl || isAdByState || isAdByDuration;
      setAdPlaying(isAd);
    } catch {}
  }

  function startAdPolling() {
    stopAdPolling();
    pollRef.current = setInterval(checkForAd, 500);
  }

  function stopAdPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  const switchVideo = (v) => {
    setCurrent(v);
    expectedVideoId.current = v.id;
    setAdPlaying(false);
  };

  return (
    <div style={styles.playerRoot}>
      <div style={styles.playerVideoWrap}>
        {/* Player container */}
        <div
          ref={playerContainerRef}
          style={styles.playerIframe}
        />

        {/* Ad overlay */}
        {adPlaying && <AdOverlay />}

        {/* Fallback: plain iframe if API hasn't loaded yet */}
        {!apiReady && (
          <iframe
            src={`https://www.youtube.com/embed/${current.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            style={{ ...styles.playerIframe, position: 'absolute', top: 0, left: 0 }}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title={current.title}
          />
        )}

        <button onClick={onBack} style={styles.playerBackBtn}>✕</button>
      </div>

      <div style={styles.playerInfo}>
        <h3 style={styles.playerTitle}>{current.title}</h3>
        <p style={styles.playerChannel}>{current.channel}</p>
        {adPlaying && (
          <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.accent, fontWeight: 700 }}>
            ⏳ Reclame — even geduld...
          </p>
        )}
      </div>

      <div style={styles.playerUpNext}>
        <h4 style={styles.playerUpNextTitle}>Nog meer kijken</h4>
        <div style={styles.playerUpNextList}>
          {others.slice(0, 8).map(v => (
            <button key={v.id} onClick={() => switchVideo(v)} style={styles.upNextCard}>
              <img src={v.thumbnail} alt="" style={styles.upNextThumb} />
              <div style={styles.upNextInfo}>
                <p style={styles.upNextCardTitle}>{v.title}</p>
                <p style={styles.upNextCardChannel}>{v.channel}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   LOADING SCREEN
   ═══════════════════════════════════════════ */

function LoadingScreen({ message }) {
  return (
    <div style={styles.loadingRoot}>
      <div style={styles.loadingSpinner} />
      <p style={styles.loadingText}>{message || "Video's ophalen..."}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════
   KIDS BROWSER
   ═══════════════════════════════════════════ */

function KidsBrowser({ config, onOpenSettings, onTokenExpired }) {
  const [videos, setVideos] = useState(config.cachedVideos || {});
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [fullscreenLost, setFullscreenLost] = useState(false);

  useEffect(() => {
    const hasCache = Object.keys(config.cachedVideos || {}).length > 0;
    if (config.accessToken && !hasCache) {
      refreshVideos();
    }
  }, []);

  // Fullscreen lockdown
  useEffect(() => {
    const handleFSChange = () => {
      if (!isFullscreen()) setFullscreenLost(true);
      else setFullscreenLost(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'l' || e.key === 't')) {
        e.preventDefault();
      }
    };
    const handleBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const handleContextMenu = (e) => e.preventDefault();

    document.addEventListener('fullscreenchange', handleFSChange);
    document.addEventListener('webkitfullscreenchange', handleFSChange);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('contextmenu', handleContextMenu);

    requestFullscreen();

    return () => {
      document.removeEventListener('fullscreenchange', handleFSChange);
      document.removeEventListener('webkitfullscreenchange', handleFSChange);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  async function refreshVideos() {
    if (!config.accessToken) return;
    setLoading(true);
    try {
      const fetched = await fetchAllVideos(config.accessToken, config.whitelist);
      setVideos(fetched);
      config.cachedVideos = fetched;
      saveConfig(config);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        onTokenExpired();
        return;
      }
      console.error('Ophalen mislukt:', err);
    }
    setLoading(false);
  }

  const allVideos = Object.values(videos).flat();
  const displayVideos = activeCategory ? (videos[activeCategory] || []) : allVideos;

  if (loading) return <LoadingScreen message="Video's ophalen van YouTube..." />;

  if (selectedVideo) {
    return <VideoPlayer video={selectedVideo} onBack={() => setSelectedVideo(null)} allVideos={allVideos} />;
  }

  const hasVideos = allVideos.length > 0;
  const isLoggedIn = !!config.accessToken;

  return (
    <div style={styles.kidsRoot}>
      {fullscreenLost && (
        <div style={styles.fsOverlay}>
          <div style={styles.fsOverlayBox}>
            <div style={{ fontSize: 48 }}>📺</div>
            <h3 style={{ color: COLORS.text, margin: '12px 0 8px', fontWeight: 800 }}>
              Volledig scherm verlaten
            </h3>
            <p style={{ color: COLORS.textLight, fontSize: 14, marginBottom: 16 }}>
              Tik om weer volledig scherm te gaan
            </p>
            <button
              onClick={() => { requestFullscreen(); setFullscreenLost(false); }}
              style={styles.fsOverlayBtn}
            >Volledig scherm</button>
          </div>
        </div>
      )}

      <div style={styles.kidsHeader}>
        <div>
          <h1 style={styles.kidsLogo}>🎬 KidsTube</h1>
          <p style={styles.kidsTagline}>
            {isLoggedIn && config.userName
              ? `Hoi! Ingelogd als ${config.userName}`
              : 'Veilig kijken — alleen leuke videos!'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isLoggedIn && (
            <button onClick={refreshVideos} style={styles.kidsHeaderBtn} title="Vernieuwen">🔄</button>
          )}
          <button onClick={onOpenSettings} style={styles.kidsHeaderBtn} title="Instellingen">⚙️</button>
        </div>
      </div>

      <div style={styles.kidsPills}>
        <button
          onClick={() => setActiveCategory(null)}
          style={{ ...styles.kidsPill, background: !activeCategory ? COLORS.secondary : COLORS.white, color: !activeCategory ? '#fff' : COLORS.text }}
        >🌟 Alles</button>
        {config.whitelist.map((term, i) => {
          const label = term.startsWith('PL') ? `📋 Playlist` : term;
          return (
            <button key={term}
              onClick={() => setActiveCategory(term)}
              style={{
                ...styles.kidsPill,
                background: activeCategory === term ? PILL_COLORS[i % PILL_COLORS.length] : COLORS.white,
                color: activeCategory === term ? '#fff' : COLORS.text,
              }}
            >{label}</button>
          );
        })}
      </div>

      <div style={styles.kidsContent}>
        {!hasVideos ? (
          <div style={styles.kidsEmpty}>
            {!isLoggedIn ? (
              <>
                <div style={{ fontSize: 56 }}>🔑</div>
                <h3 style={styles.kidsEmptyTitle}>Nog niet ingelogd</h3>
                <p style={styles.kidsEmptyText}>
                  Vraag aan mama of papa om in te loggen via ⚙️
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 56 }}>📺</div>
                <h3 style={styles.kidsEmptyTitle}>Geen video's gevonden</h3>
                <p style={styles.kidsEmptyText}>Tik op 🔄 om opnieuw te zoeken</p>
              </>
            )}
          </div>
        ) : (
          <div style={styles.videoGrid}>
            {displayVideos.map((v, i) => (
              <button key={v.id + '-' + i} onClick={() => setSelectedVideo(v)} style={styles.videoCard}>
                <div style={styles.videoThumbWrap}>
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt="" style={styles.videoThumbImg} />
                  ) : (
                    <div style={{ ...styles.videoThumbImg, background: PILL_COLORS[i%8]+'30', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36 }}>📺</div>
                  )}
                </div>
                <div style={styles.videoCardInfo}>
                  <p style={styles.videoCardTitle}>{v.title}</p>
                  <p style={styles.videoCardChannel}>{v.channel}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={styles.kidsFooter}>
        🛡️ Veilige modus — {displayVideos.length} video's
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   PARENT SETTINGS
   ═══════════════════════════════════════════ */

function ParentSettings({ config, onSave, onBack }) {
  const [clientId, setClientId] = useState(config.clientId || '');
  const [whitelist, setWhitelist] = useState([...config.whitelist]);
  const [newTerm, setNewTerm] = useState('');
  const [newPin, setNewPin] = useState('');
  const [loginStatus, setLoginStatus] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [accessToken, setAccessToken] = useState(config.accessToken || '');
  const [userName, setUserName] = useState(config.userName || '');
  const [userPhoto, setUserPhoto] = useState(config.userPhoto || '');

  const addTerm = () => {
    const t = newTerm.trim();
    if (t && !whitelist.includes(t)) {
      setWhitelist([...whitelist, t]);
      setNewTerm('');
    }
  };

  const removeTerm = (t) => setWhitelist(whitelist.filter(x => x !== t));

  useEffect(() => { exitFullscreen(); }, []);

  const handleGoogleLogin = async () => {
    if (!clientId.trim()) {
      setLoginStatus('Vul eerst een Google Client ID in');
      return;
    }
    setLoginBusy(true);
    setLoginStatus('Google login openen...');
    try {
      const { accessToken: token } = await requestGoogleToken(clientId.trim());
      setAccessToken(token);
      try {
        const userInfo = await fetchGoogleUserInfo(token);
        setUserName(userInfo.name || userInfo.email || '');
        setUserPhoto(userInfo.picture || '');
        setLoginStatus(`Ingelogd als ${userInfo.name || userInfo.email}`);
      } catch {
        setLoginStatus('Ingelogd (naam ophalen mislukt)');
      }
    } catch (err) {
      setLoginStatus(err.message);
      setAccessToken('');
    }
    setLoginBusy(false);
  };

  const handleLogout = () => {
    revokeGoogleToken(accessToken);
    setAccessToken('');
    setUserName('');
    setUserPhoto('');
    setLoginStatus('Uitgelogd');
  };

  const handleSave = () => {
    const updated = {
      ...config,
      clientId: clientId.trim(),
      accessToken,
      tokenExpiry: accessToken ? Date.now() + 3500000 : 0,
      userName,
      userPhoto,
      whitelist,
      cachedVideos: {},
    };
    if (newPin.length === 4 && /^\d{4}$/.test(newPin)) updated.pin = newPin;
    saveConfig(updated);
    onSave(updated);
  };

  const isLoggedIn = !!accessToken;

  return (
    <div style={styles.settingsRoot}>
      <div style={styles.settingsHeader}>
        <button onClick={onBack} style={styles.settingsBackBtn}>←</button>
        <div>
          <h2 style={styles.settingsTitle}>⚙️ Ouder Instellingen</h2>
          <p style={styles.settingsSubtitle}>Google login, zoektermen en pincode</p>
        </div>
      </div>

      <div style={styles.settingsBody}>

        {/* ── Google Login ── */}
        <div style={styles.settingsCard}>
          <label style={styles.settingsLabel}>🔐 Google / YouTube Login</label>

          {isLoggedIn ? (
            <div style={styles.loggedInBox}>
              <div style={styles.loggedInRow}>
                {userPhoto ? (
                  <img src={userPhoto} alt="" style={styles.userAvatar} />
                ) : (
                  <div style={{ ...styles.userAvatar, background: COLORS.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 800, borderRadius: '50%' }}>
                    {(userName || '?')[0]}
                  </div>
                )}
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.text }}>
                    {userName || 'Ingelogd'}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: COLORS.green }}>✅ Verbonden met YouTube</p>
                </div>
              </div>
              <button onClick={handleLogout} style={styles.logoutBtn}>Uitloggen</button>
            </div>
          ) : (
            <>
              <p style={styles.settingsHint}>
                Maak eenmalig een OAuth Client ID aan in de{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener"
                  style={{ color: COLORS.secondary, fontWeight: 700 }}>
                  Google Cloud Console
                </a>
              </p>
              <div style={styles.setupSteps}>
                <p style={{margin:'0 0 4px'}}>1. Maak een project (of gebruik een bestaand)</p>
                <p style={{margin:'0 0 4px'}}>2. Activeer <strong>YouTube Data API v3</strong></p>
                <p style={{margin:'0 0 4px'}}>3. Configureer het <strong>OAuth consent screen</strong></p>
                <p style={{margin:'0 0 4px'}}>4. Maak een <strong>OAuth 2.0 Client ID</strong> (type: Web application)</p>
                <p style={{margin:'0 0 4px'}}>5. Voeg je Azure URL toe als <strong>Authorized JavaScript origin</strong></p>
                <p style={{margin:0}}>6. Plak de Client ID hieronder</p>
              </div>
              <input
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder="Bijv. 123456789.apps.googleusercontent.com"
                style={styles.settingsInput}
              />
              <button
                onClick={handleGoogleLogin}
                disabled={loginBusy}
                style={{ ...styles.googleLoginBtn, opacity: loginBusy ? 0.6 : 1 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 10, flexShrink: 0 }}>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {loginBusy ? 'Bezig...' : 'Inloggen met Google'}
              </button>
            </>
          )}
          {loginStatus && (
            <p style={{
              fontSize: 13, marginTop: 10, fontWeight: 600,
              color: loginStatus.includes('Ingelogd') ? COLORS.green : loginStatus === 'Uitgelogd' ? COLORS.textLight : COLORS.primary,
            }}>
              {loginStatus}
            </p>
          )}
        </div>

        {/* ── Whitelist ── */}
        <div style={styles.settingsCard}>
          <label style={styles.settingsLabel}>📋 Toegestane zoektermen</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              value={newTerm}
              onChange={e => setNewTerm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTerm()}
              placeholder="bv. Peppa Pig, Paw Patrol, of PL..."
              style={{ ...styles.settingsInput, flex: 1, marginBottom: 0 }}
            />
            <button onClick={addTerm} style={styles.settingsAddBtn}>+</button>
          </div>
          <div style={styles.tagWrap}>
            {whitelist.map((t, i) => (
              <div key={t} style={{ ...styles.tag, background: PILL_COLORS[i%8]+'20', borderColor: PILL_COLORS[i%8]+'40' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {t.startsWith('PL') ? `📋 ${t.substring(0,14)}...` : t}
                </span>
                <button onClick={() => removeTerm(t)} style={styles.tagRemove}>×</button>
              </div>
            ))}
            {whitelist.length === 0 && (
              <p style={{ color: COLORS.textLight, fontSize: 13 }}>Nog geen termen</p>
            )}
          </div>
        </div>

        {/* ── Pincode ── */}
        <div style={styles.settingsCard}>
          <label style={styles.settingsLabel}>🔒 Pincode wijzigen</label>
          <p style={styles.settingsHint}>Huidige pin: {config.pin}</p>
          <input
            type="tel"
            maxLength={4}
            value={newPin}
            onChange={e => setNewPin(e.target.value.replace(/\D/g,''))}
            placeholder="Nieuwe 4-cijferige pin"
            style={styles.settingsInput}
          />
        </div>

        {/* ── Save ── */}
        <button onClick={handleSave} style={styles.settingsSaveBtn}>
          💾 Opslaan & terug naar KidsTube
        </button>

        {/* ── Tips ── */}
        <div style={styles.settingsTip}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            <strong>💡 Tips:</strong><br/>
            • Log in met het account dat YouTube Premium heeft → geen reclame!<br/>
            • Je kunt ook YouTube playlist-ID's toevoegen (beginnen met PL)<br/>
            • "voor kinderen" wordt automatisch aan zoekopdrachten toegevoegd<br/>
            • YouTube SafeSearch staat altijd op strict<br/>
            • Na ~1 uur verloopt de sessie — open instellingen om opnieuw in te loggen<br/>
            • Installeer als app: browsermenu → "Toevoegen aan startscherm"
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [screen, setScreen] = useState('locked');

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
      @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
      @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes adBounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
      * { -webkit-tap-highlight-color: transparent; }
      ::-webkit-scrollbar { width: 0; height: 0; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const handleTokenExpired = () => {
    const updated = { ...config, accessToken: '', tokenExpiry: 0 };
    setConfig(updated);
    saveConfig(updated);
    setScreen('pin-settings');
  };

  switch (screen) {
    case 'locked':
      return (
        <PinScreen
          correctPin={config.pin}
          onUnlock={() => setScreen('kids')}
          title="KidsTube"
          subtitle={`Voer de pincode in (standaard: ${DEFAULT_PIN})`}
        />
      );
    case 'pin-settings':
      return (
        <PinScreen
          correctPin={config.pin}
          onUnlock={() => setScreen('settings')}
          title="Ouder Toegang"
          subtitle="Voer de pincode in voor instellingen"
        />
      );
    case 'settings':
      return (
        <ParentSettings
          config={config}
          onSave={(updated) => { setConfig(updated); setScreen('kids'); }}
          onBack={() => setScreen('kids')}
        />
      );
    case 'kids':
      return (
        <KidsBrowser
          config={config}
          onOpenSettings={() => setScreen('pin-settings')}
          onTokenExpired={handleTokenExpired}
        />
      );
    default:
      return null;
  }
}

/* ═══════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════ */

const styles = {
  pinContainer: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: `linear-gradient(145deg, ${COLORS.bg}, ${COLORS.primary}10, ${COLORS.purple}10)`,
    fontFamily: "'Nunito', sans-serif", padding: 20,
  },
  pinTitle: { fontSize: 26, fontWeight: 900, color: COLORS.text, margin: '0 0 4px', letterSpacing: '-0.5px' },
  pinSubtitle: { fontSize: 14, color: COLORS.textLight, margin: '0 0 28px' },
  pinDots: { display: 'flex', gap: 16, marginBottom: 32 },
  pinDot: { width: 18, height: 18, borderRadius: '50%', transition: 'all 0.2s ease' },
  pinPad: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, maxWidth: 260 },
  pinBtn: {
    width: 72, height: 72, borderRadius: 22, border: 'none',
    fontSize: 28, fontWeight: 700, background: COLORS.white, color: COLORS.text,
    cursor: 'pointer', boxShadow: `0 2px 10px ${COLORS.shadow}`,
    fontFamily: "'Nunito', sans-serif",
  },
  pinBtnDel: { background: 'transparent', boxShadow: 'none', fontSize: 24 },
  pinError: { color: COLORS.primary, fontSize: 14, fontWeight: 700, marginTop: 18 },

  loadingRoot: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: COLORS.bg,
    fontFamily: "'Nunito', sans-serif",
  },
  loadingSpinner: {
    width: 48, height: 48, border: `4px solid ${COLORS.primary}30`,
    borderTopColor: COLORS.primary, borderRadius: '50%',
    animation: 'spin 0.8s linear infinite', marginBottom: 16,
  },
  loadingText: { color: COLORS.textLight, fontSize: 15, fontWeight: 600 },

  kidsRoot: {
    minHeight: '100vh', background: COLORS.bg,
    fontFamily: "'Nunito', sans-serif", display: 'flex', flexDirection: 'column',
  },
  kidsHeader: {
    background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.orange})`,
    padding: '16px 20px 12px', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  kidsLogo: { margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: '-1px' },
  kidsTagline: { margin: 0, fontSize: 12, opacity: 0.9 },
  kidsHeaderBtn: {
    background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 14,
    width: 44, height: 44, fontSize: 20, cursor: 'pointer', color: '#fff',
  },
  kidsPills: {
    padding: '14px 16px 4px', display: 'flex', gap: 8,
    overflowX: 'auto', flexShrink: 0,
  },
  kidsPill: {
    padding: '8px 18px', borderRadius: 20, border: 'none',
    fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: `0 2px 8px ${COLORS.shadow}`, fontFamily: "'Nunito', sans-serif",
  },
  kidsContent: { flex: 1, overflow: 'auto', padding: '10px 16px' },
  kidsEmpty: { textAlign: 'center', padding: '60px 20px' },
  kidsEmptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: 800, margin: '12px 0 6px' },
  kidsEmptyText: { color: COLORS.textLight, fontSize: 14 },
  videoGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 14,
  },
  videoCard: {
    background: COLORS.white, border: 'none', borderRadius: 18,
    overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
    boxShadow: `0 3px 14px ${COLORS.shadow}`, transition: 'transform 0.15s',
    fontFamily: "'Nunito', sans-serif", animation: 'fadeIn 0.3s ease',
  },
  videoThumbWrap: { position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: '#f0f0f0' },
  videoThumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  videoCardInfo: { padding: '10px 12px 12px' },
  videoCardTitle: {
    margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.text, lineHeight: 1.3,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  videoCardChannel: { margin: '4px 0 0', fontSize: 11, color: COLORS.textLight },
  kidsFooter: {
    textAlign: 'center', padding: '14px 0 20px',
    fontSize: 12, color: COLORS.textLight, flexShrink: 0,
  },

  fsOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  fsOverlayBox: {
    background: COLORS.white, borderRadius: 24, padding: '32px 28px',
    textAlign: 'center', maxWidth: 300, fontFamily: "'Nunito', sans-serif",
  },
  fsOverlayBtn: {
    background: COLORS.secondary, color: '#fff', border: 'none', borderRadius: 14,
    padding: '12px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
    fontFamily: "'Nunito', sans-serif",
  },

  playerRoot: { minHeight: '100vh', background: COLORS.dark, fontFamily: "'Nunito', sans-serif" },
  playerVideoWrap: { position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' },
  playerIframe: { width: '100%', height: '100%', border: 'none' },
  playerBackBtn: {
    position: 'absolute', top: 10, left: 10,
    background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 12,
    width: 40, height: 40, color: '#fff', fontSize: 18, cursor: 'pointer',
  },
  playerInfo: { padding: '14px 18px 8px' },
  playerTitle: { margin: 0, fontSize: 16, fontWeight: 800, color: '#fff' },
  playerChannel: { margin: '4px 0 0', fontSize: 13, color: '#ffffff70' },
  playerUpNext: { padding: '8px 18px 20px' },
  playerUpNextTitle: { margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#ffffff50' },
  playerUpNextList: { display: 'flex', flexDirection: 'column', gap: 10 },
  upNextCard: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#ffffff08', border: 'none', borderRadius: 14,
    padding: 8, cursor: 'pointer', textAlign: 'left', fontFamily: "'Nunito', sans-serif",
  },
  upNextThumb: { width: 100, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#ffffff15' },
  upNextInfo: { flex: 1, minWidth: 0 },
  upNextCardTitle: {
    margin: 0, fontSize: 13, fontWeight: 700, color: '#fff',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  upNextCardChannel: { margin: '2px 0 0', fontSize: 11, color: '#ffffff50' },

  settingsRoot: { minHeight: '100vh', background: COLORS.bg, fontFamily: "'Nunito', sans-serif" },
  settingsHeader: {
    background: COLORS.white, padding: '16px 20px',
    boxShadow: `0 2px 12px ${COLORS.shadow}`,
    display: 'flex', alignItems: 'center', gap: 12,
  },
  settingsBackBtn: {
    background: `${COLORS.primary}15`, border: 'none', borderRadius: 12,
    width: 42, height: 42, fontSize: 20, cursor: 'pointer', color: COLORS.primary,
  },
  settingsTitle: { margin: 0, fontSize: 20, fontWeight: 800, color: COLORS.text },
  settingsSubtitle: { margin: 0, fontSize: 12, color: COLORS.textLight },
  settingsBody: { padding: 20, maxWidth: 540, margin: '0 auto' },
  settingsCard: {
    background: COLORS.white, borderRadius: 20, padding: 20,
    boxShadow: `0 4px 20px ${COLORS.shadow}`, marginBottom: 16,
  },
  settingsLabel: { display: 'block', fontSize: 15, fontWeight: 800, color: COLORS.text, marginBottom: 6 },
  settingsHint: { fontSize: 12, color: COLORS.textLight, margin: '0 0 10px', lineHeight: 1.5 },
  settingsInput: {
    width: '100%', padding: '12px 16px', borderRadius: 14,
    border: `2px solid ${COLORS.secondary}30`, fontSize: 15,
    fontFamily: "'Nunito', sans-serif", outline: 'none',
    boxSizing: 'border-box',
  },
  settingsAddBtn: {
    background: COLORS.secondary, color: '#fff', border: 'none', borderRadius: 14,
    padding: '12px 20px', fontSize: 18, fontWeight: 700, cursor: 'pointer',
  },
  tagWrap: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  tag: {
    display: 'flex', alignItems: 'center', gap: 6,
    borderRadius: 12, padding: '8px 12px', border: '2px solid transparent',
  },
  tagRemove: {
    background: 'none', border: 'none', fontSize: 18, cursor: 'pointer',
    color: COLORS.primary, padding: 0, lineHeight: 1,
  },
  settingsSaveBtn: {
    width: '100%', padding: 16, borderRadius: 16,
    background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.orange})`,
    color: '#fff', border: 'none', fontSize: 16, fontWeight: 800,
    cursor: 'pointer', fontFamily: "'Nunito', sans-serif",
    boxShadow: `0 4px 16px ${COLORS.primary}40`, marginBottom: 16,
  },
  settingsTip: {
    background: `${COLORS.accent}30`, borderRadius: 16, padding: 16,
    border: `2px solid ${COLORS.accent}60`,
  },

  loggedInBox: {
    background: `${COLORS.green}10`, borderRadius: 14, padding: 16,
    border: `2px solid ${COLORS.green}30`,
  },
  loggedInRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  userAvatar: { width: 44, height: 44, borderRadius: '50%', flexShrink: 0 },
  logoutBtn: {
    background: `${COLORS.primary}15`, color: COLORS.primary, border: 'none',
    borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: "'Nunito', sans-serif",
  },
  googleLoginBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', padding: '14px 20px', borderRadius: 14,
    background: COLORS.white, border: `2px solid #dadce0`,
    fontSize: 15, fontWeight: 700, color: COLORS.text,
    cursor: 'pointer', fontFamily: "'Nunito', sans-serif",
    marginTop: 12, boxShadow: `0 1px 3px rgba(0,0,0,0.08)`,
  },
  setupSteps: {
    background: COLORS.bg, borderRadius: 12, padding: '12px 16px',
    marginBottom: 12, fontSize: 13, color: COLORS.text, lineHeight: 1.6,
  },
};
