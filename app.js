// Listen for venue modal open requests from map.html via postMessage
window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'openVenueModal' && event.data.venueId) {
    window.openVenueModal(event.data.venueId);
  }
});
// Expose global openVenueModal for map.html integration
window.openVenueModal = function(venueId) {
  if (!venueId) return;
  // Try to find venue by id
  const venue = Object.values(venues).find(v => String(v.id) === String(venueId));
  if (venue) {
    openVenueModal(venue);
  } else {
    alert('Venue not found.');
  }
};

// === Unified Clickbar Component ===
function clickbarHTML(v){
  return `
  <div class="venue-clickbar">
    <div class="button-row">
      <button class="click-btn" data-id="${v.id}">Click</button>
      <button class="map-btn" data-id="${v.id}">Open in Map</button>
    </div>
    <div class="click-meter">
      <div class="click-fill" style="width:${Math.min((v.clicks||0)/10*100,100)}%"></div>
    </div>
    <div class="click-count">${v.clicks||0} clicks</div>
  </div>`;
}


// === Scroll reset helper (fixes scroll-position glitch when switching panels) ===
function resetScroll(){
  try {
    const list = document.getElementById("venueList");
    if (list && typeof list.scrollTo === "function") {
      list.scrollTo({ top: 0, behavior: "instant" });
    }
  } catch(_){}
  try { window.scrollTo({ top: 0, behavior: "instant" }); } catch(_){}
}

/* =========================
   Boot helpers (splash)
// ========================= */
(function(){
  const loading = document.getElementById('loading');
  const app = document.getElementById('app');
  let shown = false;

  function show(){
    if (shown) return;
    shown = true;
    if (loading) loading.remove?.();
    if (app) {
      app.style.display = 'block';
      app.style.opacity = '1';
    }
    const bg = document.getElementById('bgVideo');
    if (bg) bg.style.filter = "brightness(1) blur(2px)";
  }

  const bg = document.getElementById('bgVideo');
  if (bg) {
    bg.addEventListener('loadeddata', show);
    bg.addEventListener('error', show);
  }

  // 🧩 Force-show fallback in case video never loads
  window.addEventListener('load', show);
  setTimeout(show, 3000);
})();

// Active promotions map to prevent duplicates
const activePromosByVenue = new Map();

/* =========================
   Week + Quotes
// ========================= */
function getWeekNumber(d){
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
const weekNumEl = document.getElementById('weekNum');
if(weekNumEl) weekNumEl.textContent = getWeekNumber(new Date());

const quotes = [
  "All our dreams can come true, if we have the courage to pursue them.",
  "The way to get started is to quit talking and begin clicking.",
  "Where every night has a story.",
  "There's magic in the air — and on the map."
];
(function rotateQuote(){
  const el = document.getElementById('quote');
  if(!el) return;
  let i=0; el.textContent = quotes[i];
  setInterval(()=>{ i=(i+1)%quotes.length; el.textContent = quotes[i]; }, 6000);
})();

/* =========================
   Events & Sessions
// ========================= */
const EVENTS_KEY="clicks_beta_events";
const USER_KEY="clicks_user_id";

let events=[];
try{ events=JSON.parse(localStorage.getItem(EVENTS_KEY)||"[]"); }catch{ events=[]; }
if(!Array.isArray(events)) events=[];

function saveEvents(){ localStorage.setItem(EVENTS_KEY, JSON.stringify(events)); }

function uuid(){
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ========== ANALYTICS HELPERS ==========
function getDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone (Safari)";
  if (/iPad/.test(ua)) return "iPad (Safari)";
  if (/Android/.test(ua)) return "Android (Chrome)";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Macintosh/.test(ua)) return "Mac";
  return navigator.platform;
}

async function sendEvent(e){
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(e)
    });
  } catch(err){
    console.error("Failed to send event:", err);
  }
}

async function sendAdminLogin(){
  try {
    await fetch("/api/admin-logins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: uuid(),
        ts: Date.now(),
        ip: "",
        device: getDeviceLabel(),
        userAgent: navigator.userAgent
      })
    });
  } catch(err){
    console.error("Failed to log admin login:", err);
  }
}

let userId = localStorage.getItem(USER_KEY);
if(!userId){ userId=uuid(); localStorage.setItem(USER_KEY,userId); }

function startSession(){
  const s = { id: uuid(), type:"session", ts: Date.now(), userId };
  events.push(s);
  saveEvents();
  sendEvent(s);
  sessionStorage.setItem("current_session", s.id);
}

function endSession(){
  const sid = sessionStorage.getItem("current_session");
  if(!sid) return;
  const sess = events.find(e=>e.id===sid);
  if(sess && !sess.end){
    sess.end = Date.now();
    saveEvents();
    sendEvent({
      id: uuid(),
      type: "session_end",
      ts: Date.now(),
      userId,
      zone: "",
      venue: "",
      sessionId: sid
    });
  }
  sessionStorage.removeItem("current_session");
}

if(!sessionStorage.getItem("current_session")) startSession();
window.addEventListener("beforeunload", endSession);
document.addEventListener("visibilitychange", ()=>{
  if(document.hidden) endSession();
  else if(!sessionStorage.getItem("current_session")) startSession();
});

/* =========================
   Venues + API
// ========================= */
let venues = {}; // key → venue

async function loadVenues() {
  try {
    const res = await fetch("/api/venues");
    if (!res.ok) throw new Error("Bad response " + res.status);
    const data = await res.json();
    venues = {};
    if (Array.isArray(data)) {
      data.forEach(v => { venues[venueKey(v)] = v; });
    }

    // Standard renders (no top-level await)
    renderVenues();
    renderPicks();

    if (typeof renderPromotions === "function") {
      renderPromotions();
    }

    renderVotingPool();

    if (typeof analyticsPanel !== "undefined" && analyticsPanel && analyticsPanel.style && analyticsPanel.style.display !== "none") {
      renderAnalytics();
    }

    // Check if we should open a venue modal from map.html
    const openVenueId = sessionStorage.getItem('openVenueId');
    if (openVenueId) {
      sessionStorage.removeItem('openVenueId');
      // Find and open the venue modal
      const venue = Object.values(venues).find(v => String(v.id) === String(openVenueId));
      if (venue && typeof openVenueModal === 'function') {
        setTimeout(() => openVenueModal(venue), 100);
      }
    }
  } catch (err) {
    console.warn("⚠️ Could not load venues:", err);
    venues = {};
    renderVenues();
    renderPicks();
  }
}

/* ---- Helper: sanitize payload before sending to server ---- */
function sanitizeVenuePayload(v) {
  const coerceNum = (x) => {
    if (x === null || x === undefined || x === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  
  // Enforce required venue name
  const venueName = (v.name || "").trim();
  if (!venueName) {
    throw new Error("Venue name is required");
  }
  
  const current = (venues && venues[venueKey(v)]) ? venues[venueKey(v)] : {};
  return {
    name: venueName,
    category: (v.category || "Bar").trim(),
    price: (v.price || "$").trim(),
    zone: (v.zone || "Other").trim(),
    expect: (v.expect || "").trim(),
    // Preserve existing image unless an explicit new one is provided
    image: (v.image && v.image.trim()) ? v.image.trim() : (current.image || null),
    isPick: !!v.isPick,
    lat: coerceNum(v.lat),
    lng: coerceNum(v.lng),
    clicks: Number.isFinite(v.clicks) ? v.clicks : null
  };
}


/* ---- Save Venue (unified version with Promotions) ---- */
async function saveVenue(v) {
  try {
    // Validate and sanitize the venue data first
    const payload = sanitizeVenuePayload(v);
    if (!payload.name) {
      throw new Error("Venue name cannot be empty");
    }

    // Preserve clicks if not provided
    if (venues[venueKey(v)] && !Number.isFinite(payload.clicks)) {
      payload.clicks = venues[venueKey(v)].clicks || 0;
    }

    const method = v?.id ? 'PUT' : 'POST';
    const url = v?.id ? `/api/venues/${v.id}` : '/api/venues';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await (async () => { try { return await res.json(); } catch { return {}; } })();
    if (!res.ok) {
      console.error('❌ Failed to save venue:', data);
      return null;
    }

    // Update local cache
    if (data && data.id) v.id = data.id;
    if (v.id) {
      const key = venueKey(v);
      if (!venues[key]) venues[key] = {};
      venues[key] = { ...venues[key], ...v };
      venues[key].clicks = payload.clicks ?? venues[key].clicks ?? 0;
      renderVenues();
    }

    // Refresh authoritative data
    await loadVenues();
    console.log('✅ Venue saved:', data);

    // If a clicks promotion was requested, always create/replace it
    try {
      const promoCheckbox = document.getElementById('vPromo');
      if (promoCheckbox && promoCheckbox.checked) {
        const promoTitle = (document.getElementById('vPromoTitle')?.value || v.name || '').trim();
        const promoDesc = (document.getElementById('vPromoDesc')?.value || v.expect || '').trim();

        // optional image upload
        let promoImagePath = '';
        const promoFile = document.getElementById('vPromoImage')?.files?.[0] || null;
            if (promoFile) {
            try {
            const fd = new FormData(); fd.append('file', promoFile);
            const up = await fetch('/upload?folder=promotions', { method: 'POST', body: fd });
            const upOut = await (async () => { try { return await up.json(); } catch { return {}; } })();
            if (up.ok && (upOut?.url || upOut?.path)) {
              promoImagePath = upOut.url || upOut.path;
            } else {
              const msg = upOut?.error || upOut?.message || ('Status ' + up.status);
              console.error('Promo upload failed', msg, upOut);
              alert('Promotion image upload failed: ' + msg);
            }
          } catch (_) {}
        }

        if (!promoImagePath) {
          const manual = (document.getElementById('vPromoImagePath')?.value || '').trim();
          if (manual) promoImagePath = manual;
        }

        const promoRes = await fetch('/api/promotions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venueId: v.id || data?.id, title: promoTitle, description: promoDesc, image: promoImagePath || '' })
        });

        const promoText = await promoRes.text();
        let promoOut = {};
        try { promoOut = JSON.parse(promoText); } catch { promoOut = { raw: promoText }; }
        if (!promoRes.ok) {
          console.warn('⚠️ Promotion not created:', promoOut?.error || promoRes.status, promoOut?.raw || '');
          try { alert('Promotion not created: ' + (promoOut?.error || promoRes.status)); } catch(e){}
        } else {
          // update cache
          try { activePromosByVenue.set(String(v.id || data?.id), promoOut); } catch(_){}
          try { const fileEl = document.getElementById('vPromoImage'); if(fileEl) fileEl.value = ''; const prevEl = document.getElementById('vPromoPreview'); if(prevEl){ prevEl.src=''; prevEl.style.display='none'; } } catch(_){}
          try { if (typeof renderPromotions === 'function') renderPromotions(); } catch(_){}
        }
      }
    } catch (promoErr) {
      console.error('❌ Failed to save promotion:', promoErr);
    }

    return data;
  } catch (err) {
    console.error('Error saving venue:', err);
    throw err;
  }
}

/* ---- Delete Venue ---- */

/* ---- Delete Venue ---- */
async function deleteVenueFromServer(id) {
  try {
    await fetch(`/api/venues/${id}`, { method: "DELETE" });
    await loadVenues();
  } catch (err) {
    console.error("Delete failed", err);
  }
}

/* =========================
   Utils
// ========================= */
const COOLDOWN_MS = 15000;
function venueKey(v){
  return `${(v.name||'').toLowerCase()}__${(v.zone||'').toLowerCase()}`;
}
function findByKey(key){ return venues[key]; }
function cooldownKey(v){ return `cooldown_${venueKey(v)}`; }
function getProgressPct(v){
  const last = parseInt(sessionStorage.getItem(cooldownKey(v))||"0",10);
  const diff = Date.now()-last;
  return Math.max(0, Math.min(100, (diff/COOLDOWN_MS)*100));
}
function isAdmin(){ return sessionStorage.getItem('clicks_is_admin')==='1'; }

/* =========================
   DOM refs
// ========================= */
const welcome = document.querySelector('.welcome')||{style:{}};
const zoneSelect = document.getElementById('zoneSelect')||{style:{}};
const venuesPanel = document.getElementById('venues')||{style:{}};
const adminPanel = document.getElementById('adminPanel')||{style:{}};
const analyticsPanel = document.getElementById('analyticsPanel')||{style:{}};
const venueList = document.getElementById('venueList')||{innerHTML:'',textContent:''};
const picksList = document.getElementById('picksList')||{innerHTML:'',textContent:''};
const searchInput = document.getElementById('venueSearch');

/* =========================
   🗳️ WEEKLY VOTING (Final)
// ========================= */
function showThankYouScreen() {
  const voteSection = document.getElementById("voteSection");
  if (!voteSection) return;

  // 🧼 Add "no-bg" class so background, shadow, and blur are hidden
  voteSection.classList.add("no-bg");

  // Clean inner HTML to avoid background ghost box
  voteSection.innerHTML =`
  <div class="vote-confirm-box fade-in" style="background:none; box-shadow:none; text-align:center; padding:40px 20px;">
    <div class="vote-confirm-logo">
      <img src="Media/logo.png" alt="Clicks Logo">
    </div>
    <h2>THANKS FOR SUBMITTING YOUR CLICKS PICK OF THE WEEK!</h2>
    <p style="
  font-size: 1.25em;
  font-weight: 600;
  color: #f3f4f6;
  letter-spacing: 0.4px;
  margin-top: 12px;
">
  You can submit your next vote in
  <span id="voteCountdown" style="
    color: var(--yellow);
    font-weight: 800;
    font-family: 'Bebas Neue', sans-serif;
    letter-spacing: 1px;
    font-size: 1.35em;
    text-shadow:
      0 0 6px rgba(255, 215, 94, 0.7),
      0 0 12px rgba(159, 75, 242, 0.4);
    animation: glowPulse 2.2s ease-in-out infinite;
  "></span>.
</p>
    <h3 style="margin-top:16px;">Current Leaderboard</h3>
    <ul id="leaderboardList"></ul>
  </div>
`;

  // Attach Hide/Show toggle immediately so it's present regardless of fetch success
  setupHideDetailsToggle();

  // ⏳ Countdown to next Monday
  let timer; // Declare timer here so it's available throughout the function
  function updateCountdown() {
    const now = new Date();
    const nextMonday = new Date();
    nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7));
    nextMonday.setHours(0, 0, 0, 0);
    const diff = nextMonday - now;
    const el = document.getElementById("voteCountdown");
    if (!el) return;
    if (diff <= 0) {
      el.textContent = "you can vote now!";
      clearInterval(timer);
      return;
    }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    el.textContent = `${d}d ${h}h ${m}m ${s}s`;
  }
  updateCountdown();
  timer = setInterval(updateCountdown, 1000);

// 🏆 Leaderboard — show real votes only
fetch("/api/leaderboard")
  .then(r => r.json())
  .then(rows => {
    const list = document.getElementById("leaderboardList");
    if (!list) return;
    list.innerHTML = "";

    if (!rows || rows.length === 0) {
      const msg = document.createElement("p");
      msg.textContent = "No votes yet this week. Be the first to vote!";
      msg.style.opacity = "0.8";
      msg.style.marginTop = "8px";
      list.parentElement.insertBefore(msg, list);
      return;
    }

    rows.forEach((v, i) => {
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${v.name} — ${v.votes || 0} votes`;
      list.appendChild(li);
    });

    setupHideDetailsToggle();
  })
  .catch(err => console.error("Leaderboard error:", err));
}

/* =========================
   🟣 Hide/Show Details Toggle (Condensed Banner)
// ========================= */
function setupHideDetailsToggle() {
  const box = document.querySelector(".vote-confirm-box");
  if (!box) return;

  // Avoid duplicate button
  if (box.querySelector(".hide-details-btn")) return;

  // Create Hide button
  const hideBtn = document.createElement("button");
  hideBtn.textContent = "Hide Details";
  hideBtn.className = "hide-details-btn";
  box.appendChild(hideBtn);

  hideBtn.addEventListener("click", () => {
    // Hide original thank-you box
    box.style.display = "none";

        // Create condensed version
    const compact = document.createElement("div");
    compact.className = "vote-compact-banner";
    compact.innerHTML = `
  <div class="vote-compact-logo">
    <img src="Media/logo.png" alt="Clicks Logo">
  </div>
  <div class="vote-compact-text">
    <strong>Thanks for submitting your vote for Clicks Pick of the Week</strong><br>
    <small>Next vote in <span id="voteCountdownMini"></span>.</small>
  </div>
  <button class="show-details-btn small">Show Details</button>
`;


    document.getElementById("voteSection").appendChild(compact);

    // Countdown mirror
    const bigCountdown = document.getElementById("voteCountdown");
    const miniCountdown = document.getElementById("voteCountdownMini");
    if (bigCountdown && miniCountdown) {
      miniCountdown.textContent = bigCountdown.textContent;
      setInterval(() => {
        miniCountdown.textContent = bigCountdown.textContent;
      }, 1000);
    }

    // Restore when clicked
    compact.querySelector(".show-details-btn").addEventListener("click", () => {
      compact.remove();
      box.style.display = "block";
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}


async function renderVotingPool() {
  const voteSection = document.getElementById("voteSection");
  const carousel = document.getElementById("voteCarousel");
  const searchInput = document.getElementById("voteSearch");
  const leaderboard = document.getElementById("leaderboard");
  const leaderboardList = document.getElementById("leaderboardList");
  const closeLeaderboard = document.getElementById("closeLeaderboard");

// Current ISO week number (match server)
const currentWeek = (function(d){
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
})(new Date());

  // Has the user already voted?
  const storedWeek = localStorage.getItem("clicks_vote_week");
  const hasVoted = storedWeek && parseInt(storedWeek) === currentWeek;

 // If already voted, skip full box and show condensed banner by default
if (hasVoted) {
  // Mark section clean
  const voteSection = document.getElementById("voteSection");
  if (voteSection) {
    voteSection.classList.add("no-bg");
    voteSection.innerHTML = `
      <div class="vote-compact-banner">
        <div class="vote-compact-logo">
          <img src="Media/logo.png" alt="Clicks Logo">
        </div>
        <div class="vote-compact-text">
          <strong>Thanks for submitting your vote for Clicks Pick of the Week</strong><br>
          <small>Next vote in <span id="voteCountdownMini"></span>.</small>
        </div>
        <button class="show-details-btn small">Show Details</button>
      </div>
    `;

    // Countdown timer (same as thank-you)
    function updateCountdownMini() {
      const now = new Date();
      const nextMonday = new Date();
      nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7));
      nextMonday.setHours(0, 0, 0, 0);
      const diff = nextMonday - now;
      const el = document.getElementById("voteCountdownMini");
      if (!el) return;
      if (diff <= 0) {
        el.textContent = "you can vote now!";
        clearInterval(timerMini);
        return;
      }
      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const m = Math.floor((diff / (1000 * 60)) % 60);
      const s = Math.floor((diff / 1000) % 60);
      el.textContent = `${d}d ${h}h ${m}m ${s}s`;
    }
    updateCountdownMini();
    const timerMini = setInterval(updateCountdownMini, 1000);

    // Allow restoring full details
    voteSection.querySelector(".show-details-btn").addEventListener("click", () => {
      voteSection.innerHTML = "";
      showThankYouScreen();
    });
  }
  return;
}


  // Load venues
  let venuesList = [];
  try {
    const res = await fetch("/api/venues");
    venuesList = await res.json();
  } catch (err) {
    console.error("❌ Failed to load venues:", err);
  }

  venuesList.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));

  function displayVenues(list) {
    carousel.innerHTML = "";
    
list.forEach(v => {
  const card = document.createElement("div");
  card.className = "vote-card";
  card.innerHTML = `
    <img src="${v.image || "Media/logo.png"}" alt="${v.name}">
    <div class="venue-name">${v.name}</div>
    <div class="venue-zone">${v.zone || ""}</div>
    <button class="btn-vote" data-id="${v.id}">Vote</button>
  `;

  // 🧩 Open modal only when clicking outside any button (preserves all click and meter logic)
  card.addEventListener("click", (e) => {
    const isButton = e.target.closest("button");
    if (isButton) return;
    openVenueModal(v);
  });

  carousel.appendChild(card);
});


    carousel.style.display = "flex";
    carousel.style.overflowX = "auto";
    carousel.style.gap = "16px";
    carousel.style.scrollSnapType = "x mandatory";
    carousel.querySelectorAll(".vote-card").forEach(card => {
      card.style.scrollSnapAlign = "start";
      card.style.flex = "0 0 240px";
    });

    // Voting behavior
    carousel.querySelectorAll(".btn-vote").forEach(btn => {
      btn.addEventListener("click", async e => {
        if (localStorage.getItem("clicks_vote_week") == currentWeek) {
          alert("You've already voted this week! Come back next Monday.");
          return;
        }

        const venueId = e.target.dataset.id;
        const userId = localStorage.getItem("USER_KEY") || crypto.randomUUID();

        try {
          const res = await fetch("/api/votes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueId, userId, week: currentWeek })
          });
          const data = await res.json();

          if (!res.ok) throw new Error(data.error || "Vote failed");

          // Save local record
          localStorage.setItem("clicks_vote_week", currentWeek.toString());

          // Replace with thank-you
          showThankYouScreen();
        } catch (err) {
          console.error("❌ Vote error:", err);
          alert("There was a problem submitting your vote.");
        }
      });
    });
  }

  // Search filter
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.toLowerCase();
    const filtered = venuesList.filter(v =>
      v.name.toLowerCase().includes(term) ||
      (v.zone||"").toLowerCase().includes(term)
    );
    displayVenues(filtered);
  });

  // Leaderboard render helper (if ever needed)
  async function renderLeaderboard() {
    leaderboardList.innerHTML = "";
    leaderboard.classList.remove("hidden");

    try {
      const res = await fetch("/api/leaderboard");
      const rows = await res.json();
      rows.forEach((v, i) => {
        const li = document.createElement("li");
        li.textContent = `${i + 1}. ${v.name} — ${v.votes} votes`;
        leaderboardList.appendChild(li);
      });
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
    }
  }
  closeLeaderboard?.addEventListener("click", () => {
    leaderboard.classList.add("hidden");
  });

  // Initially show ALL venues immediately
  displayVenues(venuesList);
  leaderboard.classList.add("hidden");
  voteSection.style.display = "block";
}

// 🕓 Reset weekly voting automatically every Monday midnight
setInterval(() => {
  const now = new Date();
  if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() < 10) {
    localStorage.removeItem("clicks_vote_week");
    location.reload();
  }
}, 60000); // check every minute

/* =========================
   Card HTML
// ========================= */
function cardHTML(v){
  const key = venueKey(v);
  const pct = getProgressPct(v);
  const admin = isAdmin();
  return `
  <div class="venue-card" data-key="${key}">
    ${v.isPick ? `<div class="pick-ribbon">Pick of the Week</div>` : ""}
    ${v.image?`<img class="venue-thumb" src="${v.image}" alt="">`:""}
    <div class="venue-title">${v.name||""}</div>
    <div class="venue-meta-line"><span class="venue-zone">${v.zone||""}</span></div>
    <div class="venue-meta-line"><span class="venue-cat">${v.category||""}</span> • <span class="venue-price">${v.price||"$"}</span></div>
    <div class="venue-desc">"${v.expect||""}"</div>

    <div class="venue-clickbar">
      <div class="button-row">
        <button class="click-btn" data-key="${key}">
          <img src="Media/logo.png" class="click-icon" alt=""> Click
        </button>
        <button class="map-btn" data-key="${key}">Open in Map</button>
      </div>
      <div class="click-meter" data-key="${key}">
        <div class="click-fill" style="width:${pct}%"></div>
      </div>
      <span class="click-count" data-key="${key}">${v.clicks||0} clicks</span>
    </div>

    ${admin?`
      <div class="admin-actions">
        <button class="btn small edit-btn" data-key="${key}">✎ Edit</button>
        <button class="btn small danger delete-btn" data-key="${key}">🗑 Delete</button>
      </div>
      <div class="boost-buttons">
        ${[5,10,50,100,500].map(n=>`<button class="boost-btn" data-key="${key}" data-boost="${n}">+${n}</button>`).join("")}
      </div>`:""}
  </div>`;
}

/* =========================
   Renderers
// ========================= */
function renderVenues(){
  const all = Object.values(venues||{});
  if(!all.length){ venueList.textContent="No venues yet. Log in to add some."; return; }

  const selected = sessionStorage.getItem("selectedZone");
  let list = all;
  if(selected && selected!=="all"){ list = all.filter(v=>v.zone===selected); }

  const q = (searchInput&&searchInput.value||"").trim().toLowerCase();
  if(q){
    list = list.filter(v=>
      (v.name||"").toLowerCase().includes(q) ||
      (v.price||"").toLowerCase().includes(q) ||
      (v.expect||"").toLowerCase().includes(q)
    );
  }

  if(!list.length){ venueList.textContent = "No venues match your search."; return; }
  venueList.innerHTML = list.map(cardHTML).join("");
  attachVenueCardEvents();
  updateClickMeters();
}


/* =========================
   🎟️ Clicks Promotions — 3-per-row with ribbon
// ========================= */
async function renderPromotions(){
  const section = document.getElementById('clicksPromos');
  const list = document.getElementById('promosList');
  const empty = document.getElementById('noPromosMsg');
  if (!section || !list) return;

  try{
  const res = await fetch('/api/promotions' + (isAdmin() ? '?includeInactive=1' : ''));
    if (!res.ok) throw new Error('Bad response ' + res.status);
    const promos = await res.json();
    // populate active promos map
    activePromosByVenue.clear();
    if (Array.isArray(promos)) {
      promos.forEach(p => {
        if (p && p.venueId) {
          // The server now returns the correct property names
          activePromosByVenue.set(String(p.venueId), p);
        }
      });
    }


    list.innerHTML = '';
    if (!Array.isArray(promos) || promos.length === 0){
      section.style.display = 'none';
      if (empty) empty.style.display = 'block';
      return;
    }
    section.style.display = 'block';
    if (empty) empty.style.display = 'none';

    list.innerHTML = promos
      .filter(p => p.active === 1)
      .map(p => `
        <div class="promo-card" data-venue-id="${p.venueId||''}" data-promo-id="${p.id||''}" data-venue-name="${(p.venueName||'')}">
          <div class="venue-image-wrap">
            <img class="venue-thumb" src="${(p.image && p.image.startsWith('Media/') ? p.image : (p.image || '')) || p.venueImage || 'Media/logo.png'}" alt="${p.venueName||''}">
          </div>
          <div class="venue-title">${p.title || ''}</div>
          <div class="promo-venue-name">${p.venueName ? p.venueName : ''}</div>
          <div class="promo-desc">${p.description || ''}</div>
          <div class="venue-meta-line"></div>
          <div class="promo-link-container" style="margin-top:10px;">
            <a href="#" class="see-venue-link" data-venue-id="${p.venueId||''}" data-venue-name="${(p.venueName||'')}" style="display:inline-block;text-decoration:underline;color:var(--neon);font-weight:700;">See Venue</a>
          </div>
          ${isAdmin() ? `<button class="btn danger promo-delete-btn" data-promo-id="${p.id}" style="margin-top:8px;width:100%">Delete Promotion</button>` : ""}
        </div>
      `).join('');

  // Responsive grid for promo cards — let it wrap on small screens
  list.style.display = 'grid';
  list.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
  list.style.justifyContent = 'center';
  list.style.gap = '20px';

    list.querySelectorAll('.promo-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        // If clicking admin buttons, never open modal
        if (e.target.classList.contains('promo-delete-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const promoId = e.target.getAttribute('data-promo-id');
          const venueId = card.getAttribute('data-venue-id');
          if (promoId && confirm('Delete this promotion?')) {
            try {
              const res = await fetch(`/api/promotions/by-venue/${venueId}`, { method: 'DELETE' });
              if (!res.ok) {
                const txt = await res.text().catch(()=>res.statusText||'');
                alert('Failed to delete promotion: ' + (txt || res.status));
              } else {
                activePromosByVenue.delete(String(venueId));
                if (typeof renderPromotions === 'function') await renderPromotions();
              }
            } catch (err) {
              alert('Failed to delete promotion: ' + (err && err.message));
            }
          }
          return;
        }
        if (e.target.classList.contains('promo-toggle-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const promoId = e.target.getAttribute('data-promo-id');
          if (promoId) {
            try {
              const res = await fetch(`/api/promotions/toggle/${promoId}`, { method: 'PUT' });
              if (!res.ok) throw new Error('Failed to toggle promotion');
              if (typeof renderPromotions === 'function') await renderPromotions();
            } catch (err) {
              alert('Failed to toggle promotion.');
            }
          }
          return;
        }
        // Only open modal if not clicking admin buttons
        if (e.target.closest('.promo-delete-btn') || e.target.closest('.promo-toggle-btn')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // ...existing code for opening modal...
        const venueId = card.getAttribute('data-venue-id');
        const promoId = card.getAttribute('data-promo-id');
        const promo = (Array.isArray(promos)?promos:[]).find(pr => String(pr.id)===String(promoId));
        let venue = null;
        try {
          const all = (typeof venues === 'object') ? Object.values(venues) : [];
          venue = all.find(v => String(v.id) === String(venueId));
        } catch(_){}
        if (!venue) venue = { id: venueId, name: (promo?.venueName||''), zone: (promo?.venueZone||'') };
        if (typeof openVenueModal === 'function') {
          openVenueModal({ ...venue, promotion: promo });
        }
      });
    });

    // Capture-phase handler for See Venue links inside promo-cards.
    // Runs in capture so it intercepts the click before the promo-card click handler
    // (which would otherwise open the promo modal).
    document.addEventListener('click', function(ev){
      try{
        const a = ev.target.closest && ev.target.closest('.see-venue-link');
        if (!a) return;
        ev.preventDefault();
        ev.stopPropagation();
        const vid = a.dataset.venueId || a.getAttribute('data-venue-id');
        const vname = a.dataset.venueName || a.getAttribute('data-venue-name') || '';
        let venueObj = null;
        try { venueObj = (typeof venues === 'object') ? Object.values(venues).find(x => String(x.id)===String(vid)) : null; } catch(_){ venueObj = null; }
        if (venueObj && typeof openVenueModal === 'function') {
          openVenueModal(venueObj);
        } else if (typeof openVenueModal === 'function'){
          openVenueModal({ id: vid, name: vname });
        }
      }catch(err){/* swallow */}
    }, true);

  }catch(err){
    console.error('renderPromotions error:', err);
    section.style.display = 'none';
    if (empty) empty.style.display = 'block';
  }
}


async function claimPromo(id) {
  try {
    const userId = localStorage.getItem('clicks_user') || crypto.randomUUID();
    localStorage.setItem('clicks_user', userId);

    const res = await fetch('/api/promotions/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promoId: id, userId })
    });

    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(out.error || 'Could not claim promotion.');
      return;
    }

    alert('✅ Promotion claimed successfully!');
    renderPromotions();
  } catch (err) {
    console.error('❌ claimPromo failed:', err);
  }
}

function showPromoQR(qr, code) {
  const popup = document.createElement('div');
  popup.className = 'promo-qr-popup';
  popup.innerHTML = `
    <div class="promo-qr-content">
      <img src="${qr}" alt="QR Code">
      <p><strong>Code:</strong> ${code || '(no code)'}</p>
      <button class="btn close-btn">Close</button>
    </div>
  `;
  popup.querySelector('.close-btn').addEventListener('click', () => popup.remove());
  document.body.appendChild(popup);
}

function renderPicks(){
  const picks = Object.values(venues||{}).filter(v=>v.isPick);
  const section = document.getElementById('clicksPicks')||{style:{}};
  if(!picks.length){ section.style.display="none"; picksList.innerHTML=""; return; }
  section.style.display="block";
  picksList.innerHTML = picks.map(cardHTML).join("");
  attachVenueCardEvents();
  updateClickMeters();
}

function updateClickMeters(){
  Object.values(venues||{}).forEach(v=>{
    const k = venueKey(v);
    const pct = getProgressPct(v);

    const fills = document.querySelectorAll(`.click-meter[data-key="${k}"] .click-fill`);
    for(const el of fills){ el.style.width = `${pct}%`; }
    const counts = document.querySelectorAll(`.click-count[data-key="${k}"]`);
    for(const el of counts){ el.textContent = `${v.clicks||0} clicks`; }

    if(venueModal?.style?.display === 'flex' && venueModalTitle?.textContent === v.name){
      const mFill = document.getElementById('venueClickFill');
      const mCount = document.getElementById('venueClickCount');
      if(mFill) mFill.style.width = `${pct}%`;
      if(mCount) mCount.textContent = `${v.clicks||0} clicks`;
    }
  });
}
setInterval(updateClickMeters, 200);

/* =========================
   Promotion Link Management
// ========================= */
function showPromoForVenue(venue) {
  try {
    // Get the promo button
    const btn = document.getElementById('showPromoBtn');
    if (!btn) return;

    // Check for active promotion
    const venueId = String(venue.id);
    const activePromo = venue.promotion || (activePromosByVenue && activePromosByVenue.get(venueId));
    
    // Update button state
    if (activePromo) {
      // Enable and show button
  btn.style.display = 'inline-block';
  // Use a consistent prompt label
  btn.textContent = 'See Promotion';
      
      // Setup click handler
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Close venue modal
        if (venueModal) {
          venueModal.style.display = 'none';
        }

        // Prepare promo data
        const promoData = {
          ...activePromo,
          venueName: venue.name || '',
          lat: venue.lat || 0,
          lng: venue.lng || 0,
          image: activePromo.image || venue.image || ''
        };

        // Open promo modal after short delay
        setTimeout(() => {
          window.openPromoModal(promoData);
        }, 100);
      };

      // Remove any existing handlers and add new one
      btn.replaceWith(btn.cloneNode(true));
      const newBtn = document.getElementById('showPromoBtn');
      newBtn.addEventListener('click', handler);
    } else {
      // No promotion or no modal handler - hide button
      btn.style.display = 'none';
    }
  } catch (err) {
    console.error('Error in showPromoForVenue:', err);
    // Hide button on error
    const btn = document.getElementById('showPromoBtn');
    if (btn) btn.style.display = 'none';
  }
}
/* =========================
   Click logging
// ========================= */
function logClickEvent(v){
  const e = {
    id: uuid(),
    type: "click",
    ts: Date.now(),
    userId,
    venue: v.name,
    zone: v.zone || "",
    sessionId: sessionStorage.getItem("current_session")
  };
  events.push(e);
  saveEvents();
  sendEvent(e);
  if(analyticsPanel && analyticsPanel.style && analyticsPanel.style.display!=="none"){
    renderAnalytics();
  }
}

/* =========================
   Venue Modal plumbing
// ========================= */
const venueModal = document.getElementById('venueModal');
const venueClose = document.getElementById('venueClose');
// Ensure the close (X) works
if (typeof venueClose !== 'undefined' && venueClose) {
  venueClose.addEventListener('click', () => {
    if (venueModal) {
      venueModal.style.display = 'none';
      venueModal.setAttribute('aria-hidden', 'true');
    }
  });
}

const venueModalTitle = document.getElementById('venueModalTitle');
const venueModalImage = document.getElementById('venueModalImage');
const venueModalExpect = document.getElementById('venueModalExpect');
const venueModalZone = document.getElementById('venueModalZone');
const venueModalCategory = document.getElementById('venueModalCategory');
const venueModalPrice = document.getElementById('venueModalPrice');
const venueModalMapBtn = document.getElementById('venueModalMap');



/* === Helper: ensure venue basics (zone/category/price/expect) visibility === */
function setVenueBasicsVisibility(show){
  try{
    const expect = document.getElementById('venueModalExpect');
    const zoneEl = document.getElementById('venueModalZone');
    const catEl  = document.getElementById('venueModalCategory');
    const priceEl= document.getElementById('venueModalPrice');
    const zoneP  = zoneEl ? zoneEl.parentElement : null;
    const catP   = catEl ? catEl.parentElement : null;
    const priceP = priceEl ? priceEl.parentElement : null;

    const disp = show ? 'block' : 'none';
    if (expect){ expect.style.display = disp; }
    if (zoneP){ zoneP.style.display = disp; }
    if (catP){ catP.style.display = disp; }
    if (priceP){ priceP.style.display = disp; }
  }catch(_){}
}

function openVenueModal(v) {
  // Input validation
  if (!venueModal || !v) return;

  // Clear previous tick for the click meter in this modal
  if (venueModal.__tick) { 
    clearInterval(venueModal.__tick); 
    venueModal.__tick = null; 
  }

  // Update basic venue info
  if (venueModalTitle) venueModalTitle.textContent = v.name || '';
  if (venueModalImage) {
    if (v.image) { 
      venueModalImage.src = v.image; 
      venueModalImage.style.display = 'block'; 
    } else { 
      venueModalImage.removeAttribute('src'); 
      venueModalImage.style.display = 'none'; 
    }
  }
  
  // Check for promo and update button visibility
  showPromoForVenue(v);

  // ---- Populate universal fields (venue basics)
  if (venueModalTitle) venueModalTitle.textContent = v.name || '';
  if (venueModalImage) {
    if (v.image) { 
      venueModalImage.src = v.image; 
      venueModalImage.style.display = 'block'; 
    } else { 
      venueModalImage.removeAttribute('src'); 
      venueModalImage.style.display = 'none'; 
    }
  }
  if (venueModalExpect) venueModalExpect.textContent = v.expect || '';
  if (venueModalZone) venueModalZone.textContent = v.zone || '';
  if (venueModalCategory) venueModalCategory.textContent = v.category || '';
  if (venueModalPrice) venueModalPrice.textContent = v.price || '';

  // ALWAYS reveal basics on open (non-promo default)
  setVenueBasicsVisibility(true);

  // Setup click handlers for modal buttons (use IDs to avoid picking promo buttons)
  const clickBtn = document.getElementById('venueClickBtn');
  const mapBtn = document.getElementById('venueMapBtn');
  const clickMeter = document.getElementById('venueClickMeter');

  if (clickBtn) {
    clickBtn.setAttribute('data-key', venueKey(v));
    clickBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isAdmin() && getProgressPct(v) < 100) return;
      v.clicks = (v.clicks || 0) + 1;
      sessionStorage.setItem(cooldownKey(v), Date.now().toString());
      await saveVenue(v);
      updateClickMeters();
      logClickEvent(v);
    };
  }

  if (mapBtn) {
    mapBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (v.lat && v.lng) {
        sessionStorage.setItem("map_focus", JSON.stringify({ 
          lat: parseFloat(v.lat), 
          lng: parseFloat(v.lng) 
        }));
        window.location.href = "map.html";
      } else {
        alert("This venue has no map location set.");
      }
    };
  }

  if (clickMeter) {
    clickMeter.setAttribute('data-key', venueKey(v));
  }

  // Initial update of click meters
  updateClickMeters();
  // Initial update complete; continue with promotion-specific UI below
  
  // ---- Promotion panel inside the modal
  try {
    const box = document.getElementById('venuePromoContainer');
    if (box){
      const promo = v && v.promotion;
      if (!promo){
        // Not a promotion view: hide promo box and show bottom clickbar
        box.style.display = 'none';
        const seeL = document.getElementById('seeVenueLink'); if (seeL) seeL.style.display='none';
        const clickbar = document.querySelector('.venue-clickbar'); if (clickbar) clickbar.style.display = 'block';
        // ensure basics are visible
        updateSeePromoLink(v);

        // Show "See promotions" link if this venue has an active promo
        try{
          const seePromo = document.getElementById('seePromoLink');
          if (seePromo){
            const ap = activePromosByVenue.get(String(v.id || ''));
            if (ap){
              seePromo.style.display = 'inline';
              seePromo.onclick = (ev)=>{
                ev.preventDefault();
                const clone = { ...v, promotion: ap };
                openVenueModal(clone);
              };
            } else {
              seePromo.style.display = 'none';
            }
          }
        }catch(_){}
    
      } else {
        // Promotion view
        box.style.display = 'block';
        box.dataset.promoId = promo.id || '';

        // Hide basics for promo
        setVenueBasicsVisibility(false);
        if (venueModalImage) venueModalImage.style.display = 'none';
        const clickbar = document.querySelector('.venue-clickbar'); if (clickbar) clickbar.style.display = 'none';

        // Fill promo content
        const t = document.getElementById('venuePromoTitle');
        const d = document.getElementById('venuePromoDesc');
        const q = document.getElementById('venuePromoQR');
        const c  = document.getElementById('venuePromoCode');
        const s  = document.getElementById('venuePromoScans');
        const img = document.getElementById('venuePromoImage');
        const mapBtn = document.getElementById('venuePromoMap');
        const claimBtn = document.getElementById('claimPromoBtn');

        if (t) t.textContent = promo.title || '';
        if (d) d.textContent = promo.description || '';
        if (img){
          if (promo.image){ img.src = promo.image; img.style.display='block'; }
          else { img.removeAttribute('src'); img.style.display='none'; }
        }

        // Hide the promo's inline map button (we keep only "See venue" link)
        if (mapBtn) mapBtn.style.display = 'none';

        // Hide QR & code in modal (only show in claim.html)
        if (q) q.style.display = 'none';
        if (c) c.style.display = 'none';

        // "See venue" link
        const seeVenue = document.getElementById('seeVenueLink');
        if (seeVenue){
          seeVenue.style.display = 'block';
          seeVenue.onclick = (ev)=>{
            ev.preventDefault();
            const clone = { ...v };
            delete clone.promotion;
            openVenueModal(clone);
            // re-enable basics
            setVenueBasicsVisibility(true);
          };
        }

        // Claim navigates to dedicated page
        if (claimBtn){
          claimBtn.onclick = ()=>{
            const promoId = box.dataset.promoId;
            if (!promoId) return;
            const modal = document.getElementById('claimConfirm');
            const text  = document.getElementById('claimConfirmText');
            // Venue name for copy
            const vName = (v && v.name) ? v.name : 'this venue';
            if (text){
              text.innerHTML = `<b>WARNING:</b> Claiming a promotion will <b>CONSUME</b> it. ` +
                               `Be sure to claim it at <b><u>${vName}</u></b> and have the bartender ready to scan. ` +
                               `Closing the code will result in <b>losing it forever</b>.`;
            }
            if (modal){ 
              modal.style.display = 'flex'; 
              modal.dataset.promoId = promoId;
            }
          };
        }
      }
    }
  }catch(e){ console.error('promo modal error', e); }

  // Show modal
  venueModal.style.display = 'flex';
  venueModal.setAttribute('aria-hidden', 'false');
}
/* =========================
   Card events
// ========================= */

function attachVenueCardEvents(){
  [venueList, picksList].forEach(listEl=>{
    if(!listEl || listEl.__hasClicksAttached) return;
    listEl.__hasClicksAttached = true;

    listEl.addEventListener('click', async (e)=>{
      const card = e.target.closest('.venue-card');
      if(!card) return;
      const key = card.getAttribute('data-key');
      const v = findByKey(key);
      if(!v) return;

      if(e.target.closest('.click-btn')){
        e.stopPropagation();
        if(!isAdmin() && getProgressPct(v) < 100) return;
        v.clicks = (v.clicks||0)+1;
        sessionStorage.setItem(cooldownKey(v), Date.now().toString());
        await saveVenue(v);
        updateClickMeters();
        logClickEvent(v);
        return;
      }

      if(e.target.closest('.map-btn')){
        e.stopPropagation();
        if(v.lat && v.lng){
          sessionStorage.setItem("map_focus", JSON.stringify({ lat: parseFloat(v.lat), lng: parseFloat(v.lng) }));
          window.location.href = "map.html";
        }else{
          alert("This venue has no map location set.");
        }
        return;
      }

      if(e.target.closest('.boost-btn')){
        e.stopPropagation();
        if(!isAdmin()) return;
        const amt = parseInt(e.target.closest('.boost-btn').dataset.boost,10)||0;
        v.clicks = (v.clicks||0)+amt;
        await saveVenue(v);
        updateClickMeters();
        logClickEvent(v);
        return;
      }

      if(e.target.closest('.edit-btn')){
        e.stopPropagation();
        if(!isAdmin()) return;
        populateEditForm(v);
        openAdmin();
        return;
      }

      if(e.target.closest('.delete-btn')){
        e.stopPropagation();
        if(!isAdmin()) return;
        if(confirm(`Delete "${v.name}"?`)){
          await deleteVenueFromServer(v.id);
        }
        return;
      }

      openVenueModal(v);
    });
  });
}

/* =========================
   Admin form + Image upload
// ========================= */
function populateEditForm(v){
  const byId = (id)=>document.getElementById(id);

  // Store promotion info in form dataset for state tracking
  const form = document.getElementById('adminForm');
  const existingPromo = activePromosByVenue.get(String(v.id));
  if (form) {
    form.dataset.hadPromo = String(!!existingPromo);
    form.dataset.wasPick = String(!!v.isPick);
  }

  // Store promotion info in hidden input
  const promoInput = byId('vPromoData');
  if (!promoInput) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = 'vPromoData';
    document.getElementById('adminForm')?.appendChild(input);
  }
  if (byId('vPromoData')) {
    byId('vPromoData').value = existingPromo ? JSON.stringify(existingPromo) : '';
  }

  // If there is an active promotion for this venue, prefill the admin promo fields
  try {
    const promoCheckbox = byId('vPromo');
    const promoTitle = byId('vPromoTitle');
    const promoDesc = byId('vPromoDesc');
    const promoImagePath = byId('vPromoImagePath');
    const promoPreview = byId('vPromoPreview');
    if (existingPromo) {
      if (promoCheckbox) { promoCheckbox.checked = true; promoCheckbox.disabled = false; }
      if (promoTitle) promoTitle.value = existingPromo.title || '';
      if (promoDesc) promoDesc.value = existingPromo.description || '';
      if (promoImagePath) promoImagePath.value = existingPromo.image || '';
      if (promoPreview && existingPromo.image) { promoPreview.src = existingPromo.image; promoPreview.style.display = 'block'; }
    } else {
      // Ensure promo controls are reset
      if (promoCheckbox) { promoCheckbox.checked = false; promoCheckbox.disabled = false; }
      if (promoTitle) promoTitle.value = '';
      if (promoDesc) promoDesc.value = '';
      if (promoImagePath) promoImagePath.value = '';
      if (promoPreview) { promoPreview.src = ''; promoPreview.style.display = 'none'; }
    }
  } catch(_) {}

  byId('vId') && (byId('vId').value = v.id || "");
  byId('vName') && (byId('vName').value = v.name || "");
  byId('vCategory') && (byId('vCategory').value = v.category || "Bar");
  byId('vPrice') && (byId('vPrice').value = v.price || "$");
  // If the zone is not in the dropdown, treat it as custom
  const zoneDropdown = byId('vZone');
  const zoneCustom = byId('vZoneCustom');
  if (zoneDropdown && zoneCustom) {
    const zones = Array.from(zoneDropdown.options).map(opt => opt.value);
    if (v.zone && zones.includes(v.zone)) {
      zoneDropdown.value = v.zone;
      zoneCustom.value = "";
    } else {
      zoneDropdown.value = "Other";
      zoneCustom.value = v.zone || "";
    }
  } else {
    if (zoneDropdown) zoneDropdown.value = v.zone || "Other";
    if (zoneCustom) zoneCustom.value = "";
  }
  byId('vExpect') && (byId('vExpect').value = v.expect || "");
  byId('vImage') && (byId('vImage').value = v.image || "");
  byId('vPick') && (byId('vPick').checked = !!v.isPick);
  byId('vLat') && (byId('vLat').value = v.lat || "");
  byId('vLng') && (byId('vLng').value = v.lng || "");
}

const vImageFile = document.getElementById('vImageFile');
if(vImageFile){
  vImageFile.addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;

    try{
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/upload?folder=venues', { method:'POST', body: fd });
      const out = await (async () => { try { return await res.json(); } catch { return {}; } })();
      if(res.ok){
        const path = out.url || out.path || `Media/Venues/${file.name}`;
        const input = document.getElementById('vImage');
        if(input) input.value = path;
        return;
      } else {
        const msg = out?.error || out?.message || ('Status ' + res.status);
        console.error('Upload failed', msg, out);
        alert('Image upload failed: ' + msg);
        const input = document.getElementById('vImage');
        if(input) input.value = `Media/Venues/${file.name}`;
      }
    }catch(err){
      console.error('Upload error', err);
      alert('Image upload error: ' + (err.message || err));
      const input = document.getElementById('vImage');
      if(input) input.value = `Media/Venues/${file.name}`;
    }
  });
}

/* =========================
   Admin form "Add Venue" resets after save
// ========================= */
document.getElementById('addVenueBtn')?.addEventListener('click', async ()=>{
  // Get venue data
  const v = {
    id: document.getElementById('vId')?.value || undefined,
    name: document.getElementById('vName')?.value || "",
    category: document.getElementById('vCategory')?.value || "Bar",
    price: document.getElementById('vPrice')?.value || "$",
    zone: (document.getElementById('vZoneCustom')?.value || document.getElementById('vZone')?.value) || "Other",
    expect: document.getElementById('vExpect')?.value || "",
    image: document.getElementById('vImage')?.value || "",
    isPick: document.getElementById('vPick')?.checked || false,
    lat: document.getElementById('vLat')?.value || "",
    lng: document.getElementById('vLng')?.value || "",
    clicks: (() => {
      const key = `${(document.getElementById('vName')?.value || "").toLowerCase()}__${((document.getElementById('vZoneCustom')?.value || document.getElementById('vZone')?.value) || "Other").toLowerCase()}`;
      return (venues[key]?.clicks ?? 0);
    })()
  };

  // Get existing promotion if any
  const form = document.getElementById('adminForm');
  const savedPromo = form?.dataset?.promotion ? JSON.parse(form.dataset.promotion) : null;
  if (savedPromo) {
    activePromosByVenue.set(String(v.id), savedPromo);
  }

  // Save venue first
  await saveVenue(v);

  // Always deactivate promotion if checkbox is unchecked
  const promoCheckbox = document.getElementById('vPromo');
  if (promoCheckbox && !promoCheckbox.checked && v.id) {
    try {
      await fetch(`/api/promotions/by-venue/${v.id}`, { method: 'DELETE' });
      activePromosByVenue.delete(String(v.id));
      console.log('✅ Deactivated promotion for venue:', v.id);
      if (typeof loadVenues === 'function') await loadVenues();
      if (typeof renderPromotions === 'function') await renderPromotions();
    } catch (err) {
      console.error('Failed to deactivate promotion:', err);
    }
  }

  // Update state trackers for next time
  if (form) {
    form.dataset.wasPick = String(v.isPick);
  }

  const formIds = ['vId','vName','vCategory','vPrice','vZone','vZoneCustom','vExpect','vImage','vPick','vLat','vLng'];
  formIds.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    if(el.type==="checkbox") el.checked = false;
    else el.value = "";
  });

  openVenues();
});

/* =========================
   Analytics (tables + charts)
// ========================= */
let zoneChart, timeChart;
function makeChart(ctx, type, data, options){
  if(!ctx) return null;
  try{
    const prev = Chart.getChart(ctx.canvas);
    if(prev) prev.destroy();
  }catch{}
  return new Chart(ctx, { type, data, options });
}

function renderAnalytics(){
  if(analyticsPanel?.style?.display==="none") return;

  const sessionEvents = events.filter(e=>e.type==="session");
  const clickEvents = events.filter(e=>e.type==="click");
  const adminLogins = events.filter(e=>e.type==="admin_login");
  const uniqueUsers = [...new Set(events.map(e=>e.userId))];

  const totalSessions = sessionEvents.length;
  const avgSessionsPerUser = uniqueUsers.length ? (totalSessions/uniqueUsers.length).toFixed(1) : 0;
  let avgSessionMin = 0;
  if(sessionEvents.length){
    const durations = sessionEvents.map(s=>{
      const end = s.end || Date.now();
      return (end - s.ts)/60000;
    });
    avgSessionMin = durations.reduce((a,b)=>a+b,0)/durations.length;
  }
  const clickerIds = new Set(clickEvents.map(e=>e.userId));
  const nonClickerIds = uniqueUsers.filter(u=>!clickerIds.has(u));
  const diffs=[];
  for(const s of sessionEvents){
    const userClicks = clickEvents.filter(c=>c.userId===s.userId && c.ts>=s.ts && (!s.end || c.ts<=s.end));
    if(userClicks.length){
      const first = userClicks.sort((a,b)=>a.ts-b.ts)[0];
      diffs.push((first.ts - s.ts)/1000);
    }
  }
  const avgFirstClick = diffs.length ? (diffs.reduce((a,b)=>a+b,0)/diffs.length) : 0;

  const setTxt = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  setTxt('kpiUsers', uniqueUsers.length);
  setTxt('kpiSessions', totalSessions);
  setTxt('kpiAvgSessions', avgSessionsPerUser);
  setTxt('kpiClickingUsers', clickerIds.size);
  setTxt('kpiNonClickingUsers', nonClickerIds.length);
  setTxt('kpiAvg', ((clickEvents.length/(uniqueUsers.length||1))||0).toFixed(1));
  setTxt('kpiTime', avgSessionMin.toFixed(1));
  setTxt('kpiFirstClick', avgFirstClick.toFixed(1));

  const zonesMap={};
  clickEvents.forEach(e=>{ const z=e.zone||"Unknown"; zonesMap[z]=(zonesMap[z]||0)+1; });
  const zonesTbody=document.querySelector('#zonesTable tbody');
  if(zonesTbody){
    zonesTbody.innerHTML = Object.entries(zonesMap)
      .sort((a,b)=>b[1]-a[1])
      .map(([z,c])=>`<tr><td>${z}</td><td>${c}</td></tr>`).join("");
  }

  const vMap={};
  clickEvents.forEach(e=>{ vMap[e.venue]=(vMap[e.venue]||0)+1; });
  const venuesTbody=document.querySelector('#venuesTable tbody');
  if(venuesTbody){
    venuesTbody.innerHTML = Object.entries(vMap)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10)
      .map(([name,c],i)=>{
        const ven = Object.values(venues).find(v=>v.name===name)||{};
        return `<tr><td>${i+1}</td><td>${name}</td><td>${ven.zone||""}</td><td>${c}</td></tr>`;
      }).join("");
  }

  const tbody=document.querySelector("#adminLoginsTable tbody");
  if(tbody){
    const last3=adminLogins.slice(-3).reverse();
    tbody.innerHTML=last3.map(e=>{
      const date=new Date(e.ts).toLocaleString();
      const dev=`${e.platform||""} ${e.userAgent||""}`.trim();
      return `<tr><td>${date}</td><td>${e.ip||"?"}</td><td>${dev}</td></tr>`;
    }).join("");
  }
  const countEl=document.getElementById("adminLoginCount");
  if(countEl) countEl.textContent=adminLogins.length;

  const allBody=document.querySelector("#allLoginsTable tbody");
  if(allBody){
    allBody.innerHTML=adminLogins.slice().reverse().map(e=>{
      const date=new Date(e.ts).toLocaleString();
      const dev=`${e.platform||""} ${e.userAgent||""}`.trim();
      return `<tr><td>${date}</td><td>${e.ip||"?"}</td><td>${dev}</td></tr>`;
    }).join("");
  }

  const zCtx=document.getElementById('zoneChart')?.getContext('2d');
  const tCtx=document.getElementById('timeChart')?.getContext('2d');

  if(zCtx){
    const labelsZ=Object.keys(zonesMap);
    const dataZ=Object.values(zonesMap);
    zoneChart=makeChart(zCtx,'bar',{labels:labelsZ,datasets:[{label:'Clicks',data:dataZ}]},{responsive:true,maintainAspectRatio:false});
  }
  if(tCtx){
    const byDay={};
    clickEvents.forEach(e=>{
      const d=new Date(e.ts).toISOString().slice(0,10);
      byDay[d]=(byDay[d]||0)+1;
    });
    const labelsT=Object.keys(byDay).sort();
    const dataT=labelsT.map(k=>byDay[k]);
    timeChart=makeChart(tCtx,'line',{labels:labelsT,datasets:[{label:'Clicks',data:dataT,fill:false,tension:.3}]},{responsive:true,maintainAspectRatio:false});
  }

  // 🎟 Promotions Performance
  (async ()=>{
    try{
      const res = await fetch('/api/promotions/summary');
      if (!res.ok) return;
      const rows = await res.json();
      const tbody = document.querySelector('#promosTable tbody'); if (tbody) tbody.innerHTML = '';
      if (!tbody) return;
      tbody.innerHTML = (rows || []).map(r => `
        <tr>
          <td>${r.venue || ''}</td>
          <td>${r.promotion || ''}</td>
          <td>${r.claims ?? 0}</td>
        </tr>`).join('') || `<tr><td colspan="3" style="opacity:.7">No promotion data yet</td></tr>`;
    }catch(e){ console.warn('promo summary error', e); }
  })();
}

/* =========================
   Navigation
// ========================= */
function show(el){ el.style.display="block"; }
function hide(el){ el.style.display="none"; }
function goHome(){ hide(zoneSelect); hide(venuesPanel); hide(adminPanel); hide(analyticsPanel); show(welcome); }
function openZones(){ hide(welcome); hide(venuesPanel); hide(adminPanel); hide(analyticsPanel); show(zoneSelect); }
function openVenues(){ hide(welcome); hide(zoneSelect); hide(adminPanel); hide(analyticsPanel); show(venuesPanel); renderVenues();
  resetScroll(); }
function openAdmin(){ hide(welcome); hide(zoneSelect); hide(venuesPanel); hide(analyticsPanel); show(adminPanel); }
function openAnalytics(){ hide(welcome); hide(zoneSelect); hide(venuesPanel); hide(adminPanel); show(analyticsPanel); renderAnalytics(); }

document.getElementById('viewVenues')?.addEventListener('click', (e)=>{ e.preventDefault(); openZones(); });
document.getElementById('backToZones')?.addEventListener('click', openZones);
document.getElementById('backToHome')?.addEventListener('click', goHome);
document.getElementById('zoneBackHome')?.addEventListener('click', goHome);
document.getElementById('adminBackHome')?.addEventListener('click', goHome);
document.getElementById('backFromAnalytics')?.addEventListener('click', goHome);

document.getElementById('zoneSelect')?.addEventListener('click', (e)=>{
  const card = e.target.closest('.zone-card');
  if(card){
    const zone = card.getAttribute('data-zone') || "";
    sessionStorage.setItem('selectedZone', zone);
    openVenues();
    return;
  }
  if(e.target.closest('.see-all')){
    sessionStorage.setItem('selectedZone', 'all');
    openVenues();
  }
});

document.getElementById('analyticsBtn')?.addEventListener('click', ()=>{ if(isAdmin()) openAnalytics(); });
document.getElementById('adminBtn')?.addEventListener('click', ()=>{ if(isAdmin()) openAdmin(); });
document.querySelector('.header .brand')?.addEventListener('click', goHome);

/* =========================
   Admin Panel buttons
// ========================= */
document.getElementById('clearVenuesBtn')?.addEventListener('click', async ()=>{
  if(!isAdmin()) return;
  const pw = prompt("Password to clear venues?");
  if(pw !== "end it") return;

  if(!confirm("Are you absolutely sure you want to COMPLETELY remove all venues?")) return;

  try {
    const res = await fetch("/api/venues", { method: "DELETE" });
    if(res.ok){
      await loadVenues();
    }
  } catch(err){
    console.error("Clear venues error:", err);
  }
});

/* =========================
   Analytics Panel buttons
// ========================= */
document.getElementById('refreshAnalytics')?.addEventListener('click', renderAnalytics);

document.getElementById('resetAnalytics')?.addEventListener('click', ()=>{
  if(!isAdmin()) return;
  const pw = prompt("Password to reset analytics?");
  if(pw!=="end it") return alert("❌ Wrong password.");
  if(confirm("Are you absolutely sure you want to COMPLETELY remove analytics?")){
    events = events.filter(e => e.type === "admin_login");
    saveEvents();
    startSession();
    renderAnalytics();
  }
});

document.getElementById('resetClicks')?.addEventListener('click', async ()=>{
  if(!isAdmin()) return;
  const pw = prompt("Password to reset clicks?");
  if(pw!=="end it") return alert("❌ Wrong password.");
  if(confirm("Are you absolutely sure you want to COMPLETELY reset all clicks?")){
    for(const v of Object.values(venues)){
      v.clicks = 0;
      await saveVenue(v);
    }
    renderAnalytics();
  }
});

document.getElementById('resetAdminLogins')?.addEventListener('click', ()=>{
  if(!isAdmin()) return;
  const pw = prompt("Password to reset admin logins?");
  if(pw!=="end it") return alert("❌ Wrong password.");
  if(confirm("Are you absolutely sure you want to COMPLETELY remove all admin logins?")){
    events = events.filter(e=>e.type!=="admin_login");
    saveEvents();
    renderAnalytics();
    const tbody=document.querySelector("#adminLoginsTable tbody");
    if(tbody) tbody.innerHTML="";
    const allBody=document.querySelector("#allLoginsTable tbody");
    if(allBody) allBody.innerHTML="";
  }
});

/* =========================
   Weekly Votes Leaderboard
// ========================= */
async function loadLeaderboardHistory(year = "", week = "") {
  try {
    let url = "/api/leaderboard-history";
    const params = [];
    if (year) params.push(`year=${encodeURIComponent(year)}`);
    if (week) params.push(`week=${encodeURIComponent(week)}`);
    if (params.length) url += "?" + params.join("&");

    const res = await fetch(url);
    const data = await res.json();

    const tbody = document.querySelector("#votesLeaderboardTable tbody");
    tbody.innerHTML = "";

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.7;">No data found for this period.</td></tr>`;
      return;
    }

    data.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

    data.forEach((row, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${row.name}</td>
        <td>${row.votes}</td>
        <td>${row.week}</td>
        <td>${row.year}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("❌ Failed to load leaderboard history:", err);
  }
}

async function populateYearWeekFilters() {
  try {
    const res = await fetch("/api/leaderboard-history");
    const data = await res.json();
    if (!Array.isArray(data)) return;

    const years = [...new Set(data.map(r => r.year))].sort((a, b) => b - a);
    const weeks = [...new Set(data.map(r => r.week))].sort((a, b) => a - b);

    const yearSel = document.getElementById("filterYear");
    const weekSel = document.getElementById("filterWeek");
    yearSel.innerHTML = `<option value="">Select Year</option>`;
    weekSel.innerHTML = `<option value="">Select Week</option>`;

    years.forEach(y => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearSel.appendChild(opt);
    });
    weeks.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = "Week " + w;
      weekSel.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Failed to populate filters:", err);
  }
}

document.getElementById("downloadLeaderboardExcel")?.addEventListener("click", async () => {
  const year = document.getElementById("filterYear").value || "All Years";
  const week = document.getElementById("filterWeek").value || "All Weeks";
  const table = document.getElementById("votesLeaderboardTable");
  if (!table) return alert("No leaderboard data to export.");

  const rows = [...table.querySelectorAll("tr")].map(r =>
    [...r.querySelectorAll("th,td")].map(c => c.innerText)
  );

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, `Week_${week}`);

  const filename = `Leaderboard_${year}_Week${week}.xlsx`;
  XLSX.writeFile(wb, filename);
});

document.getElementById("refreshLeaderboard")?.addEventListener("click", () => {
  const year = document.getElementById("filterYear").value;
  const week = document.getElementById("filterWeek").value;
  loadLeaderboardHistory(year, week);
});

document.getElementById("analyticsBtn")?.addEventListener("click", () => {
  populateYearWeekFilters();
  loadLeaderboardHistory();
});

/* =========================
   Reset All Votes
// ========================= */
document.getElementById('resetVotesBtn')?.addEventListener('click', async () => {
  if (!isAdmin()) return;
  const pw = prompt("Password to reset all votes?");
  if (pw !== "end it") return alert("❌ Wrong password.");
  if (!confirm("Are you absolutely sure you want to remove ALL votes? This cannot be undone.")) return;

  try {
    const res = await fetch("/api/votes", { method: "DELETE" });
    if (res.ok) {
      localStorage.removeItem("clicks_vote_week");
      renderVotingPool();
      alert("✅ All votes have been cleared for the week. Everyone can now vote again.");
    } else {
        // See venue (switch modal to normal venue view)
        const seeVenue = document.getElementById('seeVenueLink');
        if (seeVenue) {
          seeVenue.style.display='block';
          seeVenue.onclick = (ev)=>{ ev.preventDefault(); const clone={...v}; delete clone.promotion; openVenueModal(clone); };
        }

      alert("⚠️ Failed to reset votes on server.");
    }
  } catch (err) {
    console.error("Vote reset error:", err);
    alert("⚠️ An error occurred while resetting votes.");
  }
});

/* =========================
   See All Venues Modal
// ========================= */
const allVenuesModal = document.getElementById('allVenuesModal');
document.getElementById('seeAllVenuesAnalytics')?.addEventListener('click', ()=>{
  if(!allVenuesModal) return;
  const tbody=document.querySelector("#allVenuesTable tbody");
  if(tbody){
    const vMap={};
    events.filter(e=>e.type==="click").forEach(e=>{ vMap[e.venue]=(vMap[e.venue]||0)+1; });
    const rows = Object.entries(vMap)
      .sort((a,b)=>b[1]-a[1])
      .map(([name,c],i)=>{
        const ven = Object.values(venues).find(v=>v.name===name)||{};
        return `<tr><td>${i+1}</td><td>${name}</td><td>${ven.zone||""}</td><td>${c}</td></tr>`;
      }).join("");
    tbody.innerHTML = rows;
  }
  allVenuesModal.style.display="flex";
});
document.getElementById('allVenuesClose')?.addEventListener('click', ()=>{ if(allVenuesModal) allVenuesModal.style.display="none"; });

/* =========================
   Admin Logins Modal
// ========================= */
const loginsModal = document.getElementById('loginsModal');
document.getElementById('seeAllLogins')?.addEventListener('click', ()=>{
  if(loginsModal){
    const allBody=document.querySelector("#allLoginsTable tbody");
    if(allBody){
      const adminLogins = events.filter(e=>e.type==="admin_login");
      allBody.innerHTML=adminLogins.slice().reverse().map(e=>{
        const date=new Date(e.ts).toLocaleString();
        const dev=`${e.platform||""} ${e.userAgent||""}`.trim();
        return `<tr><td>${date}</td><td>${e.ip||"?"}</td><td>${dev}</td></tr>`;
      }).join("");
    }
    loginsModal.style.display="flex";
  }
});
document.getElementById('loginsClose')?.addEventListener('click', ()=>{ if(loginsModal) loginsModal.style.display="none"; });

/* =========================
   Login
// ========================= */
document.addEventListener("DOMContentLoaded", () => {
  const loginModal = document.getElementById("loginModal");
  const loginToggle = document.getElementById("loginToggle") || document.querySelector(".login-link");
  const loginClose = document.getElementById("loginClose");
  const loginBtn = document.getElementById("loginBtn");
  const loginErr = document.getElementById("loginErr");
  const loginOk = document.getElementById("loginOk");

  function updateLoginUI() {
    const adminBtn = document.getElementById("adminBtn");
    const analyticsBtn = document.getElementById("analyticsBtn");
    if (isAdmin()) {
      if (adminBtn) adminBtn.style.display = "inline-block";
      if (analyticsBtn) analyticsBtn.style.display = "inline-block";
      if (loginToggle) loginToggle.textContent = "Logged in as Admin";
    } else {
        // See venue (switch modal to normal venue view)
        const seeVenue = document.getElementById('seeVenueLink');
        if (seeVenue) {
          seeVenue.style.display='block';
          seeVenue.onclick = (ev)=>{ ev.preventDefault(); const clone={...v}; delete clone.promotion; openVenueModal(clone); };
        }

      if (adminBtn) adminBtn.style.display = "none";
      if (analyticsBtn) analyticsBtn.style.display = "none";
      if (loginToggle) loginToggle.textContent = "Team Member? Log In.";
    }
  }

  function openLoginModal() {
    if (loginModal) loginModal.style.display = "flex";
  }

  function closeLoginModal() {
    if (loginModal) loginModal.style.display = "none";
  }

  if (loginToggle) {
    loginToggle.addEventListener("click", () => {
      if (isAdmin()) {
        const confirm = window.confirm("Log out of admin?");
        if (confirm) {
          sessionStorage.removeItem("clicks_is_admin");
          updateLoginUI();
          goHome();
        }
      } else {
        // See venue (switch modal to normal venue view)
        const seeVenue = document.getElementById('seeVenueLink');
        if (seeVenue) {
          seeVenue.style.display='block';
          seeVenue.onclick = (ev)=>{ ev.preventDefault(); const clone={...v}; delete clone.promotion; openVenueModal(clone); };
        }

        openLoginModal();
        if (loginErr) loginErr.style.display = "none";
        if (loginOk) loginOk.style.display = "none";
      }
    });
  }

  if (loginClose) loginClose.addEventListener("click", closeLoginModal);

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      const u = document.getElementById("uName")?.value.trim().toLowerCase();
      const p = document.getElementById("uPass")?.value.trim();
      if (u === "sammy" && p === "admin") {
        sessionStorage.setItem("clicks_is_admin", "1");
        if (loginErr) loginErr.style.display = "none";
        if (loginOk) loginOk.style.display = "block";
        updateLoginUI();
        setTimeout(closeLoginModal, 1200);

        const e = {
          id: uuid(),
          type: "admin_login",
          ts: Date.now(),
          userId: "sammy",
          ip: "local",
          userAgent: navigator.userAgent,
          platform: navigator.platform
        };
        events.push(e);
        saveEvents();
        renderAnalytics();
        sendAdminLogin();
      } else {
        // See venue (switch modal to normal venue view)
        const seeVenue = document.getElementById('seeVenueLink');
        if (seeVenue) {
          seeVenue.style.display='block';
          seeVenue.onclick = (ev)=>{ ev.preventDefault(); const clone={...v}; delete clone.promotion; openVenueModal(clone); };
        }

        if (loginErr) loginErr.style.display = "block";
        if (loginOk) loginOk.style.display = "none";
      }
    });
  }

  updateLoginUI();
});

/* =========================
   Search bar
// ========================= */
searchInput?.addEventListener('input', renderVenues);

/* =========================
   Init
// ========================= */
(async function init(){
  try{
    await loadVenues();
  }catch(err){
    console.warn("Init load failed", err);
    venues={};
    renderVenues();
    renderPicks();
    renderVotingPool();
  }
})();

/* =========================
   Force Login Button Activation (Failsafe)
// ========================= */
document.addEventListener("DOMContentLoaded", () => {
  const loginToggle = document.getElementById("loginToggle");
  const loginModal  = document.getElementById("loginModal");
  const loginClose  = document.getElementById("loginClose");

  if (loginToggle && loginModal) {
    loginToggle.addEventListener("click", () => {
      loginModal.style.display = "flex";
      console.log("✅ Login modal opened manually (failsafe)");
    });
  }

  if (loginClose && loginModal) {
    loginClose.addEventListener("click", () => {
      loginModal.style.display = "none";
      console.log("✅ Login modal closed manually");
    });
  }
});


/* promo injection decorator */
(function(){
  const originalOpen = (typeof openVenueModal === 'function') ? openVenueModal : null;
  window.openVenueModal = function(v){
    if (originalOpen) originalOpen(v);
    try{
      const box = document.getElementById('venuePromoContainer');
      if (!box) return;
      const promo = v && v.promotion;
      if (!promo) {
        box.style.display = 'none';
        setVenueBasicsVisibility(true);
        
        try { const cb = document.getElementById('vPromo'); if (cb) { cb.disabled = false; } } catch(_){}
return;
      }
      box.style.display = 'block';
      box.dataset.promoId = promo.id || '';
      const t = document.getElementById('venuePromoTitle');
      const d = document.getElementById('venuePromoDesc');
      const q = document.getElementById('venuePromoQR');
      const c = document.getElementById('venuePromoCode');
      const s = document.getElementById('venuePromoScans');
      /* hide venue fields in promo */
        if (venueModalImage) venueModalImage.style.display='none';
        if (venueModalExpect) { venueModalExpect.textContent=''; venueModalExpect.style.display='none'; }
        try{
          const zoneP = document.getElementById('venueModalZone')?.parentElement;
          const catP  = document.getElementById('venueModalCategory')?.parentElement;
          const priceP= document.getElementById('venueModalPrice')?.parentElement;
          if (zoneP) zoneP.style.display = 'none';
          if (catP)  catP.style.display  = 'none';
          if (priceP)priceP.style.display= 'none';
        }catch(_){}
        if (t) t.textContent = promo.title || '';
      if (d) d.textContent = promo.description || '';
      if (q) q.src = promo.qr || '';
      if (c) c.textContent = promo.code || '';
      if (s) s.textContent = ((promo.claims ?? 0) + ' claims');
    }catch(e){
      console.warn('promo inject failed', e);
    }
  };
})();



document.getElementById('resetPromotions')?.addEventListener('click', async () => {
  if (!confirm('Reset ALL promotion claims?')) return;
  try{
    const res = await fetch('/api/promotions/reset', { method:'DELETE' });
    const out = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(out.error || res.status);
    alert('✅ Promotion claims reset.');
    try{ renderPromotions(); }catch(_){}
    try{ renderAnalytics(); }catch(_){}
  }catch(err){
    console.error('reset claims failed', err);
    alert('⚠️ Could not reset promotion claims.');
  }
});



(function(){
  function injectResetAll(){
    if (document.getElementById('resetAllPromotions')) return;
    const anchor = document.getElementById('resetPromotions');
    const btn = document.createElement('button');
    btn.id = 'resetAllPromotions';
    btn.className = 'btn danger';
    btn.textContent = 'Reset Promotions & Claims';
    if (anchor && anchor.parentElement) anchor.parentElement.appendChild(btn);
    else (document.getElementById('analyticsPanel')||document.body).appendChild(btn);
  }
  document.addEventListener('DOMContentLoaded', injectResetAll);

  document.addEventListener('click', async (e)=>{
    const el = e.target.closest('#resetAllPromotions');
    if (!el) return;
    const pw = prompt('Password to delete ALL promotions and claims?');
    if (pw !== 'end it') return alert('❌ Wrong password.');
    if (!confirm('This will DELETE ALL promotions and ALL claims. Continue?')) return;
    try{
      const res = await fetch('/api/promotions/all-reset', {
        method:'DELETE',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pw:'end it' })
      });
      const out = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(out.error || res.status);
      alert('✅ All promotions and claims deleted.');
      try{ renderPromotions(); }catch(_){}
      try{ renderAnalytics(); }catch(_){}
    }catch(err){
      console.error('all-reset failed', err);
      alert('⚠️ Could not delete promotions/claims.');
    }
  });
})();



// promotions summary -> analytics table (if present)
(async function(){
  const origAnalytics = (typeof renderAnalytics === 'function') ? renderAnalytics : null;
  window.renderAnalytics = async function(){
    if (origAnalytics) try{ await origAnalytics(); }catch(_){}
    try{
      const res = await fetch('/api/promotions/summary');
      if (!res.ok) return;
      const rows = await res.json();
      const tbody = document.querySelector('#promosTable tbody'); if (tbody) tbody.innerHTML = '';
      if (tbody){
        tbody.innerHTML = (rows||[]).map(r => `
          <tr>
            <td>${r.venue || ''}</td>
            <td>${r.promotion || ''}</td>
            <td style="text-align:right;">${r.claims || 0}</td>
          </tr>
        `).join('');
      }
      const kpi = document.getElementById('kpiPromoClaims');
      if (kpi) {
        const total = (rows||[]).reduce((s,r)=> s + (r.claims||0), 0);
        kpi.textContent = total;
      }
    }catch(err){
      console.warn('promotions analytics patch failed', err);
    }
  };
})();



/* Live preview for promo image */
document.getElementById("vPromoImage")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  const prev = document.getElementById("vPromoPreview");
  if (!prev) return;
  if (file) {
    prev.src = URL.createObjectURL(file);
    prev.style.display = "block";
  } else {
        // See venue (switch modal to normal venue view)
        const seeVenue = document.getElementById('seeVenueLink');
        if (seeVenue) {
          seeVenue.style.display='block';
          seeVenue.onclick = (ev)=>{ ev.preventDefault(); const clone={...v}; delete clone.promotion; openVenueModal(clone); };
        }

    prev.removeAttribute("src");
    prev.style.display = "none";
  }
});
// === Claim confirmation actions ===
(function(){
  const modal = document.getElementById('claimConfirm');
  const cancel = document.getElementById('cancelClaim');
  const confirmBtn = document.getElementById('confirmClaim');
  if (cancel) cancel.onclick = ()=>{ if (modal) modal.style.display='none'; };
  if (confirmBtn) confirmBtn.onclick = ()=>{
    if (!modal) return;
    const promoId = modal.dataset.promoId;
    modal.style.display='none';
    if (promoId) window.location.href = `claim.html?promoId=${encodeURIComponent(promoId)}`;
  };
})();    

// === Global delegated handlers for claim confirmation modal ===
document.addEventListener('click', function(e){
  const t = e.target;
  if (!t) return;
  if (t.id === 'cancelClaim'){
    const modal = document.getElementById('claimConfirm');
    if (modal) modal.style.display = 'none';
  }
  if (t.id === 'confirmClaim'){
    const modal = document.getElementById('claimConfirm');
    if (!modal) return;
    const promoId = modal.dataset.promoId;
    modal.style.display = 'none';
    if (promoId) window.location.href = `claim.html?promoId=${encodeURIComponent(promoId)}`;
  }
});

function getClicksUserId(){
  return localStorage.getItem('clicks_user_id') || localStorage.getItem('USER_KEY') || (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
}
function claimsText(n){
  const x = Number(n);
  return 'Claims Remaining: ' + (Number.isFinite(x) ? x : 1);
}


/* PROMO_USERID_FETCH_WRAP */
(function(){
  const _fetch = window.fetch;
  window.fetch = function(input, init){
    try{
      let url = (typeof input === 'string') ? input : input.url;
      if (url && url.startsWith('/api/promotions') && !/userId=/.test(url)) {
        const uid = getClicksUserId();
        const sep = url.includes('?') ? '&' : '?';
        input = url + sep + 'userId=' + encodeURIComponent(uid);
      }
    }catch(e){}
    return _fetch.call(this, input, init);
  };
})();


window.__promos = window.__promos || [];
window.currentPromo = window.currentPromo || null;

function findPromoInCacheByIdOrTitle(id, title){
  if (id != null){
    const hit = window.__promos.find(p => String(p.id) === String(id));
    if (hit) return hit;
  }
  if (title){
    const t = (title||'').trim();
    const hit = window.__promos.find(p => (p.title||'').trim() === t);
    if (hit) return hit;
  }
  return null;
}

function updateClaimsUI(){
  // Modal label
  const modalClaims = document.getElementById('venuePromoClaims');
  if (modalClaims && window.currentPromo){
    modalClaims.textContent = claimsText(window.currentPromo.claimsRemaining);
  }
  // Remove any legacy "1 claims" in visible modal area
  document.querySelectorAll('#venuePromoContainer .promo-scans').forEach(n => n.textContent = '');
}


/* PROMO_FETCH_CACHE */
(function(){
  const _fetch = window.fetch;
  window.fetch = async function(input, init){
    const resp = await _fetch.call(this, input, init);
    try{
      const url = (typeof input === 'string') ? input : input.url;
      if (url && url.startsWith('/api/promotions')){
        const clone = resp.clone();
        const data = await clone.json().catch(()=>null);
        if (Array.isArray(data)){
          window.__promos = data;
          // Bind currentPromo if modal has dataset or title
          const box = document.getElementById('venuePromoContainer');
          const titleEl = document.getElementById('venuePromoTitle');
          const pid = box?.dataset?.promoId;
          const title = titleEl?.textContent?.trim();
          const found = findPromoInCacheByIdOrTitle(pid, title);
          if (found) window.currentPromo = found;
          setTimeout(updateClaimsUI, 30);
        }
      }
    }catch(e){}
    return resp;
  };
})();


// SEE_PROMO_CLICK_BIND
document.getElementById('seePromoLink')?.addEventListener('click', () => {
  setTimeout(()=>{
    const box = document.getElementById('venuePromoContainer');
    if (box){
      const pid = box.dataset?.promoId;
      const title = document.getElementById('venuePromoTitle')?.textContent?.trim();
      const found = findPromoInCacheByIdOrTitle(pid, title);
      if (found) window.currentPromo = found;
    }
    updateClaimsUI();
  }, 80);
});


function showNoClaimsModal(){
  const modal = document.createElement('div');
  modal.className = 'no-claims-modal';
  modal.innerHTML = '<div class="no-claims-inner"><h3>No claims remaining</h3><p>Try again tomorrow!</p><button class="btn glow" id="dismissNoClaims">Dismiss</button></div>';
  document.body.appendChild(modal);
  modal.style.display='flex';
  document.getElementById('dismissNoClaims').onclick = ()=> modal.remove();
}


/* PROMO_CLAIM_HANDLER */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t && t.id === 'claimPromoBtn'){
    const p = window.currentPromo;
    if (!p){ return; }
    const remaining = (typeof p.claimsRemaining === 'number') ? p.claimsRemaining : 1;
    if (remaining <= 0){
      e.preventDefault(); e.stopPropagation();
      showNoClaimsModal();
      return;
    }
    // Call server claim endpoint with userId
    try{
      const uid = getClicksUserId();
      const res = await fetch('/api/promotions/claim', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ promoId: p.id, userId: uid })
      });
      // If OK, set remaining to 0 locally and refresh
      if (res.ok){
        p.claimsRemaining = 0;
        updateClaimsUI();
        // Refresh promos so it sticks
        fetch('/api/promotions').then(()=>setTimeout(updateClaimsUI, 50));
      }else{
        // If server says already claimed, also show modal and set to 0
        p.claimsRemaining = 0;
        updateClaimsUI();
        showNoClaimsModal();
      }
    }catch(err){
      // Network failure: optimistically set to 0 and show modal
      p.claimsRemaining = 0;
      updateClaimsUI();
      showNoClaimsModal();
    }
  }
});

// Global delegated admin handlers for promo-card buttons (robust guard)
document.addEventListener('click', async (e) => {
  try {
    const del = e.target.closest && e.target.closest('.promo-delete-btn');
    if (del) {
      e.preventDefault(); e.stopPropagation();
      const promoId = del.getAttribute('data-promo-id');
      const venueId = del.closest && del.closest('.promo-card') ? del.closest('.promo-card').getAttribute('data-venue-id') : null;
      if (promoId && confirm('Delete this promotion?')) {
        try {
          const res = await fetch(`/api/promotions/by-venue/${venueId}`, { method: 'DELETE' });
          if (!res.ok) {
            const txt = await res.text().catch(()=>res.statusText||'');
            alert('Failed to delete promotion: ' + (txt || res.status));
          } else {
            activePromosByVenue.delete(String(venueId));
            if (typeof renderPromotions === 'function') await renderPromotions();
          }
        } catch (err) {
          alert('Failed to delete promotion: ' + (err && err.message));
        }
      }
      return;
    }

    const tog = e.target.closest && e.target.closest('.promo-toggle-btn');
    if (tog) {
      e.preventDefault(); e.stopPropagation();
      const promoId = tog.getAttribute('data-promo-id');
      if (promoId) {
        try {
          const res = await fetch(`/api/promotions/toggle/${promoId}`, { method: 'PUT' });
          if (!res.ok) {
            const txt = await res.text().catch(()=>res.statusText||'');
            alert('Failed to toggle promotion: ' + (txt || res.status));
          } else {
            // Optionally update cache with returned promo
            try {
              const out = await res.json().catch(()=>null);
              if (out && out.promo && out.promo.venueId) activePromosByVenue.set(String(out.promo.venueId), out.promo);
            } catch(_){}
            if (typeof renderPromotions === 'function') await renderPromotions();
          }
        } catch (err) {
          alert('Failed to toggle promotion: ' + (err && err.message));
        }
      }
      return;
    }
  } catch (err) { /* swallow */ }
});


// PROMO_MODAL_OBSERVER: keep label in sync when modal content re-renders
(function(){
  const box = document.getElementById('venuePromoContainer');
  if (!box) return;
  const obs = new MutationObserver(()=> updateClaimsUI());
  obs.observe(box, { childList:true, subtree:true, characterData:true, attributes:true });
})();


// Google Import attach
(function attachGoogleImport(){
  const btn = document.getElementById("gImportBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const payload = {
      query: document.getElementById("gQuery")?.value?.trim(),
      lat: parseFloat(document.getElementById("gLat")?.value || ""),
      lng: parseFloat(document.getElementById("gLng")?.value || ""),
      radius: parseInt(document.getElementById("gRadius")?.value || "1200", 10),
      zone: document.getElementById("gZone")?.value?.trim(),
      categoryHint: document.getElementById("gCat")?.value || "",
      maxResults: 15
    };
    if (!Number.isFinite(payload.lat)) delete payload.lat;
    if (!Number.isFinite(payload.lng)) delete payload.lng;
    try {
      btn.disabled = true; btn.textContent = "Importing…";
      const r = await fetch("/api/google/import", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      const out = await r.json();
      console.log("Import result:", out);
      await loadVenues();
      alert(`Imported/updated: ${out.count || 0} venues`);
    } catch (e) {
      console.error(e);
      alert("Import failed");
    } finally {
      btn.disabled = false; btn.textContent = "Import Venues";
    }
  });
})();



// === Reset Buttons (Venues + Leaderboards) ===
(function setupResetButtons(){
  const resetVenuesBtn = document.getElementById("resetVenuesBtn");
  const resetLeaderBtn = document.getElementById("resetLeaderboardsBtn");

  if (resetVenuesBtn){
    resetVenuesBtn.addEventListener("click", async ()=>{
      if(!confirm("Are you sure you want to reset all venues?")) return;
      resetVenuesBtn.disabled = true;
      try{
        const res = await fetch('/api/reset-venues', {method:'POST'});
        const data = await res.json();
        if(data.ok){ alert("✅ Venues reset successfully!"); if(typeof loadVenues==='function') await loadVenues(); }
        else alert("⚠️ Failed to reset venues: "+(data.error||'Unknown error'));
      }catch(e){ console.error(e); alert("❌ Error resetting venues"); }
      finally{ resetVenuesBtn.disabled = false; }
    });
  }

  if (resetLeaderBtn){
    resetLeaderBtn.addEventListener("click", async ()=>{
      if(!confirm("Are you sure you want to clear all votes leaderboards?")) return;
      resetLeaderBtn.disabled = true;
      try{
        const res = await fetch('/api/reset-leaderboards', {method:'POST'});
        const data = await res.json();
        if(data.ok){ alert("✅ Votes leaderboard reset successfully!"); }
        else alert("⚠️ Failed to reset leaderboards: "+(data.error||'Unknown error'));
      }catch(e){ console.error(e); alert("❌ Error resetting leaderboards"); }
      finally{ resetLeaderBtn.disabled = false; }
    });
  }
})();


// 🧹 Reset Weekly Leaderboards
const resetLeaderboardsBtn = document.getElementById("resetLeaderboards");
if (resetLeaderboardsBtn) {
  resetLeaderboardsBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to reset all leaderboard data?")) return;
    try {
      const res = await fetch("/api/leaderboard", { method: "DELETE" });
      const data = await res.json();
      alert(`✅ Leaderboards reset successfully (${data.deleted || 0} rows removed).`);
      console.log("Leaderboard reset:", data);
    } catch (err) {
      console.error("Failed to reset leaderboard:", err);
      alert("❌ Failed to reset leaderboard.");
    }
  });
}



/* =========================================================
   🔒 Single Promo Modal Controller (Aesthetic version)
   - Uses #promoModal only
   - Hides #venuePromoContainer to avoid duplicates
   - Ensures .promo-card opens ONLY this modal
========================================================= */
(function SinglePromoModal(){
  if (window.__singlePromoWired) return; window.__singlePromoWired = true;

  // Hide any embedded venue promo container if present
  try {
    const vpc = document.getElementById("venuePromoContainer");
    if (vpc) vpc.style.display = "none";
  } catch(_){}

  // Helper: map focus
  function focusMap(lat, lng, name){
    try { sessionStorage.setItem("map_focus", JSON.stringify({lat,lng,name})); } catch(_){}
    location.href = "map.html";
  }

  // Open modal
  window.openPromoModal = async function(promo){
    const modal = document.getElementById("promoModal");
    if (!modal) return;

    // Normalize data
    const title = promo.title || promo.name || "Promotion";
    const desc  = promo.description || promo.expect || "";
    const img   = promo.image || "";
    const lat   = Number(promo.lat ?? (promo.venueObj && promo.venueObj.lat));
    const lng   = Number(promo.lng ?? (promo.venueObj && promo.venueObj.lng));

    // Determine venue name and object (prefer explicit fields, then try cache lookups)
    let venueName = promo.venueName || promo.venue || "";
    let venueObj = null;
    try{
      if (promo.venueId) {
        const all = (typeof venues === 'object') ? Object.values(venues) : [];
        venueObj = all.find(v => String(v.id) === String(promo.venueId)) || null;
        if (venueObj && !venueName) venueName = venueObj.name || '';
      } else if (venueName) {
        // try find by name
        const all = (typeof venues === 'object') ? Object.values(venues) : [];
        venueObj = all.find(v => String((v.name||'')).trim().toLowerCase() === String(venueName).trim().toLowerCase()) || null;
      }
    }catch(_){ venueObj = null; }

  // Fill UI
  const vHead = modal.querySelector("#promoVenueHeading");
    const pTitle= modal.querySelector("#promoTitle");
    const pDesc = modal.querySelector("#promoDesc");
    const pImg  = modal.querySelector("#promoImage");
    const mapBtn= modal.querySelector("#promoMapBtn");
    const claim = modal.querySelector("#promoClaimBtn");
    const click = modal.querySelector("#promoClickBtn");
    const fill  = modal.querySelector("#promoClickFill");
    const count = modal.querySelector("#promoClickCount");

  if (vHead) vHead.textContent = (venueName || "").toUpperCase();
    if (pTitle) pTitle.textContent = title;
    if (pDesc)  pDesc.textContent  = desc;
    if (pImg){
      if (img){ pImg.src = img; pImg.style.display = "block"; }
      else { pImg.removeAttribute("src"); pImg.style.display = "none"; }
    }
    if (mapBtn){
      mapBtn.onclick = (e)=>{ e.preventDefault(); if (Number.isFinite(lat)&&Number.isFinite(lng)) focusMap(lat,lng,venue); };
    }
    if (claim){
      const id = promo.id ? String(promo.id) : "";
      claim.href = id ? `claim.html?promoId=${id}` : "#";
    }
    if (click){
      click.onclick = (e)=>{
        e.preventDefault();
        if (fill) fill.style.width = "100%";
        if (count){
          const n = parseInt((count.textContent||"0").replace(/\D+/g,"")) || 0;
          count.textContent = (n+1) + " clicks";
        }
      };
    }

    // Wire the 'See Venue' link inside the promo modal
    try {
      const seeVenue = modal.querySelector('#promoSeeVenue');
      if (seeVenue) {
        if (promo.venueId || promo.venueName) {
          seeVenue.style.display = 'inline-block';
          seeVenue.textContent = 'See Venue';
          seeVenue.onclick = (e) => {
            e.preventDefault();
            // close promo modal
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden','true');
            // attempt to find venue in cache
            let venueObj = null;
            try { venueObj = (typeof venues === 'object') ? Object.values(venues).find(x => String(x.id) === String(promo.venueId || promo.venueId)) : null; } catch(_){ venueObj = null; }
            if (venueObj && typeof openVenueModal === 'function') {
              openVenueModal(venueObj);
            } else if (typeof openVenueModal === 'function') {
              openVenueModal({ id: promo.venueId || '', name: promo.venueName || '' });
            }
          };
        } else {
          seeVenue.style.display = 'none';
        }
      }
    } catch (e) { /* swallow */ }

    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  };

  window.closePromoModal = function(){
    const modal = document.getElementById("promoModal");
    if (modal){ modal.style.display = "none"; modal.setAttribute("aria-hidden","true"); }
  };

  const promoClose = document.getElementById("promoClose");
  if (promoClose && !promoClose.__wired){
    promoClose.__wired = true;
    promoClose.addEventListener("click", closePromoModal);
  }

  // Delegate clicks from any .promo-card to openPromoModal only
  // Ignore clicks that originate from admin controls inside the card (delete/toggle)
  document.addEventListener("click", (ev) => {
    const card = ev.target.closest?.(".promo-card");
    if (!card) return;
    // If the click started on an admin control, bail out so those handlers run
    try {
      if (ev.target.closest('.promo-delete-btn') || ev.target.closest('.promo-toggle-btn') || ev.target.closest('.see-venue-link')) {
        return;
      }
    } catch (_) {}
    ev.preventDefault(); ev.stopPropagation();

    const promo = {
      id: card.dataset.promoId || card.getAttribute("data-promo-id"),
      title: card.dataset.title || card.getAttribute("data-title") || card.querySelector(".venue-title")?.textContent || "",
      description: card.dataset.desc || card.getAttribute("data-desc") || card.querySelector(".venue-desc")?.textContent || "",
      image: card.dataset.image || card.getAttribute("data-image") || card.querySelector("img.venue-thumb")?.src || "",
      venueName: card.dataset.venueName || card.getAttribute("data-venue-name") || card.querySelector(".venue-title")?.textContent || "",
      lat: Number(card.dataset.lat || card.getAttribute("data-lat")),
      lng: Number(card.dataset.lng || card.getAttribute("data-lng")),
      zone: card.dataset.zone || card.getAttribute("data-zone") || "",
      price: card.dataset.price || card.getAttribute("data-price") || ""
    };
    openPromoModal(promo);
  });

  // ESC to close
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closePromoModal(); });
})();



/* =========================================================
   🧩 SeePromoLink Fix
   - Wraps openVenueModal to keep venue promo container hidden
   - Rewires #seePromoLink to open ONLY the unified promo modal
========================================================= */
(function SeePromoLinkFix(){
  if (window.__seePromoPatched) return; window.__seePromoPatched = true;

  // Cache promotions and find by venue
  const PromoFinder = {
    list: null, ts: 0,
    async all(){
      if (!Array.isArray(this.list) || (Date.now() - this.ts) > 60_000){
        try{
          const r = await fetch("/api/promotions");
          this.list = r.ok ? await r.json() : [];
          this.ts = Date.now();
        }catch{ this.list = []; }
      }
      return this.list || [];
    },
    async forVenue(v){
      const all = await this.all();
      if (!v) return null;
      // Prefer by id, then by name (case-insensitive)
      const vid = v.id && String(v.id);
      let p = null;
      if (vid){
        p = all.find(x => String(x.venueId) === vid) || null;
      }
      if (!p && v.name){
        const key = String(v.name).trim().toLowerCase();
        p = all.find(x => String(x.venueName||"").trim().toLowerCase() === key) || null;
      }
      return p || null;
    }
  };

  // Keep a reference to original openVenueModal (if any)
  const _origOpenVenueModal = window.openVenueModal;
  window.openVenueModal = function wrappedOpenVenueModal(v){
    // Call original behavior first
    if (typeof _origOpenVenueModal === "function"){
      _origOpenVenueModal(v);
    }

    // Store current venue for later usage
    window.__currentVenueForModal = v;

    // Hide any embedded promo container to prevent duplicates
    try{
      const emb = document.getElementById("venuePromoContainer");
      if (emb){
        emb.style.display = "none";
        emb.setAttribute("aria-hidden","true");
      }
    }catch{}

    // Rewire See promotions link
    const link = document.getElementById("seePromoLink");
    if (link && !link.__wiredSeePromo){
      link.__wiredSeePromo = true;
      link.style.display = "inline-block";
      link.onclick = async (ev)=>{
        ev.preventDefault(); ev.stopPropagation();
        try{
          const venue = window.__currentVenueForModal || v || {};
          const promo = await PromoFinder.forVenue(venue);
          if (promo){
            // Enrich with venue data for map/buttons
            openPromoModal({
              ...promo,
              venueName: promo.venueName || venue.name || "",
              lat: Number(promo.lat ?? venue.lat),
              lng: Number(promo.lng ?? venue.lng),
              zone: venue.zone || "",
              price: venue.price || "",
              category: venue.category || "Bar",
              image: promo.image || venue.image || ""
            });
          } else {
            // No active promo: gracefully show message or fallback
            alert("No active promotions for this venue right now.");
          }
        }catch(err){
          console.error("SeePromoLink error:", err);
        }
      };
    }
  };
})();



/* =========================================================
   🧼 Modal De-dup + Orphan Cleanup (v3)
   - Ensures only ONE promo modal shows
   - Closes venue modal before showing promo
   - Hard overrides #seePromoLink to prevent legacy handlers
   - Removes orphan .venue-clickbar outside modals (stray buttons)
========================================================= */
(function DeDupAndCleanup(){
  if (window.__dedupCleanupV3) return; window.__dedupCleanupV3 = true;

  function closeAllModals(){
    document.querySelectorAll('.modal').forEach(m=>{
      m.style.display = 'none';
      m.setAttribute('aria-hidden','true');
    });
  }

  function hideEmbeddedVenuePromo(){
    const emb = document.getElementById('venuePromoContainer');
    if (emb){
      emb.style.display = 'none';
      emb.setAttribute('aria-hidden','true');
    }
    // Also nuke any promo QR/code remnants inside venue modal
    ['venuePromoQR','venuePromoCode','venuePromoScans'].forEach(id=>{
      const el = document.getElementById(id);
      if (el){ el.style.display = 'none'; }
    });
  }

  function removeOrphans(){
    // Remove only promo-related .venue-clickbar elements that aren't inside a modal
    // (do NOT remove normal venue card clickbars)
    document.querySelectorAll('.venue-clickbar').forEach(el=>{
      if (!el.closest('.modal-inner')) {
        // If this clickbar contains promo-specific controls, it's an orphan we can remove
        if (el.querySelector('#promoClickBtn') || el.querySelector('#venueClaimBtn') || el.querySelector('#promoMapBtn')) {
          el.remove();
        }
      }
    });
    // Defensive: any .button-row not in a modal that belongs to promo controls
    document.querySelectorAll('.button-row').forEach(el=>{
      if (!el.closest('.modal-inner') && (el.querySelector('#promoClickBtn') || el.querySelector('#venueClaimBtn'))) {
        el.remove();
      }
    });
  }

  // Run once at load
  document.addEventListener('DOMContentLoaded', ()=>{
    // Force-hide embedded promo container with CSS just in case
    const style=document.createElement('style');
    style.textContent = '#venuePromoContainer{display:none !important}';
    document.head.appendChild(style);
    hideEmbeddedVenuePromo();
    removeOrphans();
  });

  // Wrap openPromoModal to always close others first and clean orphans
  const _origOpenPromo = window.openPromoModal;
  window.openPromoModal = function(promo){
    closeAllModals();
    hideEmbeddedVenuePromo();
    removeOrphans();
    if (typeof _origOpenPromo === 'function') _origOpenPromo(promo);
  };

  // Wrap openVenueModal to rewire SeePromoLink safely
  const _origOpenVenue = window.openVenueModal;
  window.openVenueModal = function(v){
    if (typeof _origOpenVenue === 'function') _origOpenVenue(v);
    hideEmbeddedVenuePromo();
    removeOrphans();

    // Rewire #seePromoLink by stripping all existing listeners
    const link = document.getElementById('seePromoLink');
    if (link){
      const clone = link.cloneNode(true);
      link.parentNode.replaceChild(clone, link);
      clone.style.display = 'inline-block';
      clone.addEventListener('click', async (ev)=>{
        ev.preventDefault(); ev.stopPropagation();
        // Attempt to fetch promo by venue
        try{
          const res = await fetch('/api/promotions');
          const promos = res.ok ? await res.json() : [];
          const key = String(v?.name||'').trim().toLowerCase();
          const promo = promos.find(p => String(p.venueName||'').trim().toLowerCase() === key) || null;
          if (promo){
            window.openPromoModal({ ...promo, venueName: v?.name||promo.venueName||'', lat: v?.lat, lng: v?.lng, image: promo.image || v?.image || '' });
          } else {
            // Optional: toast instead of alert
            try{
              const t = document.createElement('div');
              t.textContent = 'No active promotions for this venue right now.';
              t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111318;color:#e5e7eb;border:1px solid var(--line);padding:10px 14px;border-radius:10px;z-index:10000;font-weight:700;';
              document.body.appendChild(t);
              setTimeout(()=>t.remove(), 2200);
            }catch{}
          }
        }catch(err){ console.error('SeePromoLink fetch error:', err); }
      });
    }
  };

  // Global click guard: if a click would reach the venue promo area, block it
  document.addEventListener('click', (ev)=>{
    // If promo modal is open, prevent clicks reaching hidden venue promo area
    const promoOpen = !!document.getElementById('promoModal') && document.getElementById('promoModal').style.display !== 'none';
    if (promoOpen){
      const inVenueModal = ev.target.closest && ev.target.closest('#venueModal');
      if (inVenueModal) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    }
  }, true);
})();


/* ==========================================================================
   Clicks Patch Overlay (non-destructive, vFinal)
   - Keeps original app.js logic intact
   - Fixes duplicate promo modals and legacy See Promotion handlers
   - Ensures venue modal controls (Click/Map/Clickbar) are visible and wired
   - Hides promo modal's Click/clickbar/Open in Map; enlarges Claim button
   - Shows "See promotion" only when a real promo exists; no flicker
   ========================================================================== */
(function ClicksPatchOverlay(){
  if (window.__clicksPatchOverlay) return; window.__clicksPatchOverlay = true;

  /* Helpers */
  function qs(id){ return document.getElementById(id); }
  function closeAllModals(){
    document.querySelectorAll('.modal').forEach(m=>{
      m.style.display = 'none';
      m.setAttribute('aria-hidden','true');
    });
  }
  async function fetchPromotions(){
    try{
      const r = await fetch('/api/promotions'); 
      return r.ok ? (await r.json()) : [];
    }catch{ return []; }
  }
  async function findPromoForVenue(v){
    if (!v) return null;
    const promos = await fetchPromotions();
    const vid = v.id && String(v.id);
    let p = null;
    if (vid){
      p = promos.find(x => String(x.venueId) === vid) || null;
    }
    if (!p && v.name){
      const key = String(v.name).trim().toLowerCase();
      p = promos.find(x => String(x.venueName||'').trim().toLowerCase() === key) || null;
    }
    return p || null;
  }

  /* 1) Make openPromoModal safe-single and style it */
  const _origOpenPromo = window.openPromoModal;
  window.openPromoModal = function(p){
    // Close any other modals first to avoid stacking
    closeAllModals();

    // Call original if present (let it fill content / aesthetics)
    if (typeof _origOpenPromo === 'function'){
      try { _origOpenPromo(p); } catch(e){ console.error('orig openPromoModal error', e); }
    }

    // Hide promo-side clickbar/map controls if they exist in template
    ['promoClickBtn','promoClickMeter','promoClickFill','promoClickCount','promoMapBtn'].forEach(id=>{
      const el = qs(id);
      if (el){ el.style.display = 'none'; el.setAttribute('aria-hidden','true'); }
    });

    // Enlarge + glow Claim button and show confirmation modal when clicked
    const claim = qs('promoClaimBtn');
    if (claim){
      const id = p && p.id ? String(p.id) : '';
      claim.classList.add('glow');
      claim.style.padding = '12px 18px';
      claim.style.fontWeight = '800';
      claim.style.fontSize = '16px';
      claim.style.borderRadius = '14px';
      claim.style.boxShadow = '0 0 16px rgba(159,75,242,.6)';
      claim.style.display = 'inline-flex';
      claim.style.alignItems = 'center';
      claim.style.justifyContent = 'center';

      // Replace default navigation with a confirmation dialog that matches existing aesthetics
      claim.onclick = (ev) => {
        try {
          ev.preventDefault(); ev.stopPropagation();
          const modal = document.getElementById('claimConfirm');
          const text  = document.getElementById('claimConfirmText');
          if (!modal || !text) return;
          // Populate promoId for the global confirm handler
          if (id) modal.dataset.promoId = id;
          // Use venue name if available on the promo object
          const venueLabel = (p && (p.venueName || p.venue)) ? (p.venueName || p.venue) : '';
          // Friendly warning message (HTML allowed for emphasis)
          text.innerHTML = `<b>Warning:</b> Claiming a promotion will <b>CONSUME</b> it. Be sure to claim it at <b>${venueLabel || 'the venue'}</b> and have the bartender ready to scan. Closing the code will result in losing it forever.`;
          modal.style.display = 'flex';
          modal.setAttribute('aria-hidden','false');
        } catch (e) { console.error('promo claim handler error', e); }
      };
    }

    // Finally, ensure promo modal is visible
    const pm = qs('promoModal');
    if (pm){ pm.style.display='flex'; pm.setAttribute('aria-hidden','false'); }
  };

  /* 2) Wrap openVenueModal to (a) hide embedded promo, (b) rewire See Promotion,
        and (c) force venue click/map controls visible + working */
  const _origOpenVenue = window.openVenueModal;
  window.openVenueModal = async function(v){
    // Call original (let it render initial content)
    if (typeof _origOpenVenue === 'function'){
      try { _origOpenVenue(v); } catch(e){ console.error('orig openVenueModal error', e); }
    }

    // Never show inline/embedded promo content inside venue modal
    const embedded = qs('venuePromoContainer');
    if (embedded){
      embedded.style.display = 'none';
      embedded.setAttribute('aria-hidden','true');
    }

    // Force-show venue click UI
    const clickbar = document.querySelector('#venueModal .venue-clickbar');
    const vClickBtn = qs('venueClickBtn');
    const vMapBtn   = qs('venueMapBtn');
    const vFill     = qs('venueClickFill');
    const vCount    = qs('venueClickCount');

    if (clickbar) clickbar.style.display='block';
    [vClickBtn, vMapBtn, vFill, vCount].forEach(el=>{ if(el){ el.style.display=''; el.style.visibility='visible'; }});

    if (vClickBtn){
      vClickBtn.onclick = async (e)=>{
        e.preventDefault();
        e.stopPropagation();
        if(!isAdmin() && getProgressPct(v) < 100) return;
        v.clicks = (v.clicks||0)+1;
        sessionStorage.setItem(cooldownKey(v), Date.now().toString());
        await saveVenue(v);
        updateClickMeters();
        logClickEvent(v);
      };
    }
    if (vMapBtn){
      vMapBtn.onclick = (e)=>{
        e.preventDefault();
        e.stopPropagation();
        if (v.lat && v.lng){
          sessionStorage.setItem("map_focus", JSON.stringify({ 
            lat: parseFloat(v.lat), 
            lng: parseFloat(v.lng),
            name: v.name || ''
          }));
          window.location.href = "map.html";
        } else {
          alert("This venue has no map location set.");
        }
      };
    }

    // Rebuild "See promotion" cleanly (remove all legacy handlers)
    const link = qs('seePromoLink');
    if (link){
      const clone = link.cloneNode(true);
      link.parentNode.replaceChild(clone, link);
      clone.style.display = 'none';
      clone.style.visibility = 'hidden';

      const promo = await findPromoForVenue(v);
      if (promo){
        clone.textContent = 'See promotion';
        clone.style.display = 'inline-block';
        clone.style.visibility = 'visible';
        clone.onclick = (ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          window.openPromoModal({
            ...promo,
            venueName: promo.venueName || v.name || '',
            lat: Number(promo.lat ?? v.lat),
            lng: Number(promo.lng ?? v.lng),
            image: promo.image || v.image || ''
          });
        };
      }
    }

    // Ensure venue modal visible (in case original didn't)
    const vm = qs('venueModal');
    if (vm){ vm.style.display='flex'; vm.setAttribute('aria-hidden','false'); }
  };

  /* 3) Delegate promo-card clicks to unified promo modal, without touching venues */
  document.addEventListener('click', (ev)=>{
    const card = ev.target.closest && ev.target.closest('.promo-card');
    if (!card) return;
    // Ignore admin controls inside card so their handlers run instead
    try {
      if (ev.target.closest('.promo-delete-btn') || ev.target.closest('.promo-toggle-btn') || ev.target.closest('.see-venue-link')) return;
    } catch(_){}
    ev.preventDefault(); ev.stopPropagation();

    const promo = {
      id: card.dataset.promoId || card.getAttribute('data-promo-id'),
      title: card.dataset.title || card.getAttribute('data-title') || card.querySelector('.venue-title')?.textContent || '',
      description: card.dataset.desc || card.getAttribute('data-desc') || card.querySelector('.venue-desc')?.textContent || '',
      image: card.dataset.image || card.getAttribute('data-image') || card.querySelector('img.venue-thumb')?.src || '',
      venueName: (function(){
        const dn = card.dataset.venueName || card.getAttribute('data-venue-name');
        if (dn) return dn;
        const meta = card.querySelector('.venue-meta-line')?.textContent || '';
        if (!meta) return '';
        // meta usually like "@Venue Name • Zone" - remove leading '@' and take left of '•'
        return meta.replace(/^@/, '').split('•')[0].trim();
      })(),
  venueId: card.dataset.venueId || card.getAttribute('data-venue-id') || '',
  lat: Number(card.dataset.lat || card.getAttribute('data-lat')),
  lng: Number(card.dataset.lng || card.getAttribute('data-lng'))
    };
    window.openPromoModal(promo);
  }, true);

})(); // end overlay


function handleClick(v){
  if(!v || !v.id) return;
  v.clicks = (v.clicks||0) + 1;
  // Update all instances (modal + cards)
  document.querySelectorAll(`.venue-clickbar [data-id='${v.id}']`).forEach(btn => {
    const parent = btn.closest('.venue-clickbar');
    if (parent){
      const count = parent.querySelector('.click-count');
      const fill = parent.querySelector('.click-fill');
      if (count) count.textContent = `${v.clicks} clicks`;
      if (fill) fill.style.width = `${Math.min(v.clicks/10*100,100)}%`;
    }
  });
}
