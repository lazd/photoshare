const CONVERTED_BASE = 'images';
const STATIC_CACHE_BUST = 'e02db7ed02b1';

let photos = [];
let albums = [];
let journalByDate = {};
let journalTabActive = false;
let currentAlbum = null;
let map = null;
let markers = [];
let selectedPhotoId = null;
let isTogglingFullscreen = false;
let isScrollingToSelection = false;
let isScrollingTimeline = false;
let isKeyboardNavigating = false;
let recentlySelectedFromTimeline = false;
let currentMapStyle = 'map';
let setMapStyleFn = null;
let mapMinimized = false;

function parseHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('photo');
  const mapParam = params.get('map');
  const mapVisible = mapParam !== 'false';
  const mapStyle = mapParam === 'satellite' ? 'satellite' : 'map';
  const album = params.get('album');
  return {
    id: id ? parseInt(id, 10) : null,
    fullscreen: params.get('fullscreen') === 'true',
    map: mapStyle,
    mapVisible,
    view: params.get('view') === 'journal' ? 'journal' : 'map',
    album: album !== null ? decodeURIComponent(album) : null
  };
}

function updateHash() {
  const overlay = document.getElementById('fullscreenOverlay');
  const isFullscreen = overlay && overlay.classList.contains('visible');
  const params = new URLSearchParams();
  if (currentAlbum != null && currentAlbum !== '') {
    params.set('album', encodeURIComponent(currentAlbum));
  }
  if (selectedPhotoId != null) {
    params.set('photo', selectedPhotoId);
    if (isFullscreen) params.set('fullscreen', 'true');
  }
  if (mapMinimized) {
    params.set('map', 'false');
  } else if (currentMapStyle === 'satellite') {
    params.set('map', 'satellite');
  }
  if (journalTabActive) {
    params.set('view', 'journal');
  }
  const newHash = params.toString() ? '#' + params.toString() : '';
  if (location.hash !== newHash) {
    location.hash = newHash;
  }
}

function setMapMinimized(minimized) {
  mapMinimized = minimized;
  const main = document.querySelector('.main-content');
  if (main) main.classList.toggle('map-minimized', mapMinimized);
  map?.resize();
  updateHash();
  const minimizeBtn = document.getElementById('mapMinimizeBtn');
  if (minimizeBtn) {
    minimizeBtn.classList.toggle('map-minimized', mapMinimized);
    minimizeBtn.title = mapMinimized ? 'Maximize map' : 'Minimize map';
    minimizeBtn.setAttribute('aria-label', mapMinimized ? 'Maximize map' : 'Minimize map');
  }
  const menuToggleMap = document.getElementById('menuToggleMap');
  if (menuToggleMap) menuToggleMap.checked = !mapMinimized;
}

function openMenu() {
  const menuToggleMap = document.getElementById('menuToggleMap');
  if (menuToggleMap) menuToggleMap.checked = !mapMinimized;
  const mapTileMap = document.querySelector('input[name="mapTiles"][value="map"]');
  const mapTileSatellite = document.querySelector('input[name="mapTiles"][value="satellite"]');
  if (mapTileMap) mapTileMap.checked = currentMapStyle === 'map';
  if (mapTileSatellite) mapTileSatellite.checked = currentMapStyle === 'satellite';
  const menuAlbumName = document.getElementById('menuAlbumName');
  if (menuAlbumName) menuAlbumName.textContent = formatAlbumName(currentAlbum ?? '');
  document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'true');
  document.getElementById('menuOverlay')?.classList.add('visible');
  document.getElementById('menuOverlay')?.setAttribute('aria-hidden', 'false');
  document.getElementById('menuDrawer')?.classList.add('open');
}

function closeMenu() {
  document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'false');
  document.getElementById('menuOverlay')?.classList.remove('visible');
  document.getElementById('menuOverlay')?.setAttribute('aria-hidden', 'true');
  document.getElementById('menuDrawer')?.classList.remove('open');
}

function formatAlbumName(name) {
  if (!name) return 'Photos';
  return name.replace(/([A-Z])/g, ' $1').trim();
}

async function fetchAlbums() {
  const res = await fetch(`albums.json?v=${STATIC_CACHE_BUST}`);
  if (!res.ok) throw new Error('Failed to fetch albums');
  return res.json();
}

let _allPhotos = null;
async function fetchPhotos(album = null) {
  if (!_allPhotos) {
    const res = await fetch(`photos.json?v=${STATIC_CACHE_BUST}`);
    if (!res.ok) throw new Error('Failed to fetch photos');
    _allPhotos = await res.json();
  }
  if (album == null || album === '') {
    return _allPhotos.filter((p) => !(p.album || ''));
  }
  return _allPhotos.filter((p) => (p.album || '') === album);
}

let _allJournal = null;
async function fetchJournal(album = null) {
  if (!_allJournal) {
    const res = await fetch(`journal.json?v=${STATIC_CACHE_BUST}`);
    _allJournal = res.ok ? await res.json() : [];
  }
  const a = album || '';
  return _allJournal.filter((e) => (e.album || '') === a);
}

function getZoomForPhoto(photo) {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);
  const radius = 0.010;
  const nearby = photosWithCoords.filter(
    (p) =>
      p.id !== photo.id &&
      Math.abs(p.latitude - photo.latitude) < radius &&
      Math.abs(p.longitude - photo.longitude) < radius
  );
  const isMobile = window.innerWidth <= 768;
  const offset = isMobile ? -1 : 0;
  let zoom;
  if (nearby.length >= 15) zoom = 16 + offset;
  else if (nearby.length >= 8) zoom = 15 + offset;
  else if (nearby.length >= 4) zoom = 14 + offset;
  else zoom = 12 + offset;
  if (currentMapStyle === 'satellite') zoom = Math.max(10, zoom - 2);
  return zoom;
}

function updateMarkerStyles() {
  markers.forEach((marker) => {
    const el = marker.getElement();
    if (el) {
      const idx = photos.findIndex((p) => p.id === marker.photoId);
      const baseZ = idx >= 0 ? idx + 1 : 1;
      el.style.zIndex = marker.photoId === selectedPhotoId ? 1000 : String(baseZ);
      el.classList.toggle('map-marker-selected', marker.photoId === selectedPhotoId);
    }
  });
}

function buildSnapCarousel(containerEl) {
  containerEl.innerHTML = '';
  photos.forEach((photo) => {
    const slide = document.createElement('div');
    slide.className = 'snap-carousel-slide';
    slide.dataset.photoId = photo.id;
    const img = document.createElement('img');
    const thumbSrc = photo.thumbnail_filename
      ? `${CONVERTED_BASE}/${photo.thumbnail_filename}`
      : null;
    const fullSrc = `${CONVERTED_BASE}/${photo.converted_filename}`;
    img.dataset.fullsrc = fullSrc;
    img.src = thumbSrc || fullSrc;
    if (!thumbSrc) img.dataset.loaded = '1';
    img.alt = `Photo ${photo.id}`;
    img.addEventListener('load', function onLoad() {
      if (this.dataset.loaded) {
        const portrait = this.naturalHeight > this.naturalWidth;
        slide.classList.toggle('photo-portrait', portrait);
        slide.classList.toggle('photo-landscape', !portrait);
      }
    });
    slide.appendChild(img);
    containerEl.appendChild(slide);
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slide = entry.target;
        const img = slide.querySelector('img');
        if (!img || img.dataset.loaded) continue;
        const fullSrc = img.dataset.fullsrc;
        if (fullSrc) {
          img.dataset.loaded = '1';
          img.src = fullSrc;
        }
      }
    },
    { root: containerEl, rootMargin: '100%', threshold: 0 }
  );

  containerEl.querySelectorAll('.snap-carousel-slide').forEach((slide) => io.observe(slide));

  return containerEl;
}

function getCarouselGap(scrollEl) {
  if (!scrollEl) return 0;
  const gap = getComputedStyle(scrollEl).gap;
  return gap ? parseFloat(gap) || 0 : 0;
}

function scrollToPhoto(scrollEl, photoId, behavior = 'smooth') {
  if (!scrollEl || photos.length === 0) return;
  const slide = scrollEl.querySelector(`[data-photo-id="${photoId}"]`);
  if (!slide) return;
  const slideWidth = scrollEl.offsetWidth;
  const gap = getCarouselGap(scrollEl);
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return;
  const targetScroll = idx * (slideWidth + gap);
  if (behavior === 'auto') {
    const prev = scrollEl.style.scrollBehavior;
    scrollEl.style.scrollBehavior = 'auto';
    scrollEl.scrollTo({ left: Math.max(0, targetScroll), behavior: 'auto' });
    requestAnimationFrame(() => {
      scrollEl.style.scrollBehavior = prev || '';
    });
  } else {
    scrollEl.scrollTo({ left: Math.max(0, targetScroll), behavior });
  }
}

function getCarouselFractionalIndex(scrollEl) {
  if (!scrollEl || photos.length === 0) return 0;
  const slideWidth = scrollEl.offsetWidth;
  const gap = getCarouselGap(scrollEl);
  const slotWidth = slideWidth + gap;
  if (slotWidth <= 0) return 0;
  const idx = scrollEl.scrollLeft / slotWidth;
  return Math.max(0, Math.min(photos.length - 1, idx));
}

function getPhotoAtScrollPosition(scrollEl) {
  if (!scrollEl || photos.length === 0) return null;
  const idx = Math.round(getCarouselFractionalIndex(scrollEl));
  return photos[idx]?.id ?? null;
}

function getCarousel() {
  return document.getElementById('photoCarousel');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

let currentJournalEntry = null;
let journalEditing = false;

// True only in the static (deployed) build, which has no backend to save to.
function isStaticBuild() {
  return typeof STATIC_CACHE_BUST !== 'undefined';
}

function buildJournalIndex(entries) {
  journalByDate = {};
  currentJournalEntry = null;
  journalEditing = false;
  (entries || []).forEach((e) => {
    if (e.month == null || e.day == null) return;
    journalByDate[`${pad2(e.month)}-${pad2(e.day)}`] = e;
  });
}

function getJournalEntryForPhoto(photoId) {
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return null;
  const dateKey = getPhotoDateKey(photo); // YYYY-MM-DD
  if (!dateKey) return null;
  return journalByDate[dateKey.slice(5)] || null; // keyed by MM-DD
}

function makeJournalBtn(action, label, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'journal-tool-btn' + (primary ? ' primary' : '');
  b.dataset.action = action;
  b.textContent = label;
  return b;
}

function renderJournalEntry(entry) {
  const container = document.getElementById('journalEntry');
  if (!container) return;
  container.innerHTML = '';
  container.classList.toggle('editable', !journalEditing && !isStaticBuild());

  // Date headline, with the Save/Cancel buttons inline (only while editing).
  // Keeping them in the header — which is present in both modes — avoids any
  // layout shift when entering edit mode.
  const header = document.createElement('div');
  header.className = 'journal-entry-header';
  const title = document.createElement('h2');
  title.className = 'journal-entry-title';
  title.textContent = entry.title;
  header.appendChild(title);
  if (journalEditing) {
    const actions = document.createElement('div');
    actions.className = 'journal-entry-actions';
    actions.appendChild(makeJournalBtn('cancel', 'Cancel'));
    actions.appendChild(makeJournalBtn('save', 'Save', true));
    header.appendChild(actions);
  }
  container.appendChild(header);

  if (journalEditing) {
    const editor = document.createElement('textarea');
    editor.className = 'journal-editor';
    editor.id = 'journalEditor';
    editor.value = entry.body;
    container.appendChild(editor);
    requestAnimationFrame(() => editor.focus());
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelJournalEdit(); }
    });
  } else {
    entry.body.split(/\n{2,}/).forEach((para) => {
      const p = document.createElement('p');
      p.className = 'journal-entry-para';
      p.textContent = para;
      container.appendChild(p);
    });
  }
  container.scrollTop = 0;
}

function enterJournalEdit() {
  if (!currentJournalEntry || isStaticBuild()) return;
  journalEditing = true;
  renderJournalEntry(currentJournalEntry);
}

function cancelJournalEdit() {
  if (!journalEditing) return;
  journalEditing = false;
  if (currentJournalEntry) renderJournalEntry(currentJournalEntry);
}

async function saveJournalEdit() {
  const editor = document.getElementById('journalEditor');
  const entry = currentJournalEntry;
  if (!editor || !entry) return;
  const body = editor.value.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  const saveBtn = document.querySelector('.journal-tool-btn[data-action="save"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  try {
    const res = await fetch(JOURNAL_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: currentAlbum ?? '', month: entry.month, day: entry.day, body })
    });
    if (!res.ok) throw new Error('server returned ' + res.status);
    entry.body = body; // reflect the saved text in the in-memory index
    journalEditing = false;
    renderJournalEntry(entry);
  } catch (err) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    alert('Could not save journal entry: ' + err.message);
  }
}

function updateJournalTabButtons(showJournal) {
  const mapBtn = document.getElementById('mapTabMap');
  const journalBtn = document.getElementById('mapTabJournal');
  if (mapBtn) {
    mapBtn.classList.toggle('active', !showJournal);
    mapBtn.setAttribute('aria-selected', String(!showJournal));
  }
  if (journalBtn) {
    journalBtn.classList.toggle('active', showJournal);
    journalBtn.setAttribute('aria-selected', String(showJournal));
  }
}

// Reflects the current selection's journal availability: tabs appear only when
// the selected photo's day has an entry, and the journal panel is shown when
// the user has the journal tab active.
function updateJournalPanel() {
  const tabs = document.getElementById('mapTabs');
  const panel = document.getElementById('journalPanel');
  const mapContainer = document.querySelector('.map-container');
  const entry = getJournalEntryForPhoto(selectedPhotoId);

  if (tabs) tabs.hidden = !entry;

  if (!entry) {
    currentJournalEntry = null;
    mapContainer?.classList.remove('show-journal');
    panel?.setAttribute('aria-hidden', 'true');
    updateJournalTabButtons(false);
    return;
  }

  // Only rebuild the journal DOM when the entry actually changes (e.g. crossing
  // to a new day), not on every selection within the same day.
  if (entry !== currentJournalEntry) {
    journalEditing = false; // discard any unsaved edit when moving to another day
    currentJournalEntry = entry;
    renderJournalEntry(entry);
  }
  const showJournal = journalTabActive;
  mapContainer?.classList.toggle('show-journal', showJournal);
  panel?.setAttribute('aria-hidden', String(!showJournal));
  updateJournalTabButtons(showJournal);
}

function setJournalTab(active) {
  journalTabActive = active;
  updateJournalPanel();
  updateHash();
}

function flyMapToPhotoObj(photo) {
  if (!photo || photo.latitude == null || photo.longitude == null || !map) return;
  const zoom = getZoomForPhoto(photo);
  const center = map.getCenter();
  const dist = Math.hypot(photo.latitude - center.lat, photo.longitude - center.lng);
  const duration = Math.min(1.5, Math.max(0.25, 0.25 + (dist / 0.1) * 1.25));
  map.flyTo({
    center: [photo.longitude, photo.latitude],
    zoom,
    duration: duration * 1000,
    essential: true
  });
}

// Keyboard navigation can fire faster than the carousel finishes scrolling, so
// the expensive per-step work (map fly + hash update) is deferred until the
// user pauses. Only the lightweight carousel/timeline glide runs on each press.
let navSettleTimer = null;
function scheduleNavSettle() {
  clearTimeout(navSettleTimer);
  navSettleTimer = setTimeout(() => {
    isKeyboardNavigating = false;
    flyMapToPhotoObj(photos.find((p) => p.id === selectedPhotoId));
    updateHash();
  }, 150);
}

function selectPhoto(photoId, opts = {}) {
  selectedPhotoId = photoId;
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return;

  document.querySelectorAll('.timeline-cell').forEach((el) => {
    el.classList.toggle('selected', el.dataset.photoId === String(photoId));
  });

  const carousel = getCarousel();
  const scrollBehavior = opts.instant ? 'auto' : 'smooth';
  if (carousel) {
    isScrollingToSelection = true;
    scrollToPhoto(carousel, photoId, scrollBehavior);
    setTimeout(() => { isScrollingToSelection = false; }, 800);
  }

  if (!opts.skipMapFly) flyMapToPhotoObj(photo);

  updateMarkerStyles();
  updateJournalPanel();

  if (!opts.skipTimelineScroll) {
    const cell = document.querySelector(`.timeline-cell[data-photo-id="${photoId}"]`);
    if (cell) {
      const scrollBehavior = opts.instant ? 'auto' : 'smooth';
      cell.scrollIntoView({ behavior: scrollBehavior, block: 'nearest', inline: 'center' });
    }
  } else {
    recentlySelectedFromTimeline = true;
    setTimeout(() => { recentlySelectedFromTimeline = false; }, 500);
  }

  if (!opts.skipHashUpdate) updateHash();
}

function toggleFullscreen(opts = {}) {
  const overlay = document.getElementById('fullscreenOverlay');
  const carousel = getCarousel();
  if (!carousel) return;

  const viewport = overlay?.querySelector('.carousel-viewport');
  const previewContainer = document.getElementById('photoPreview');
  if (!viewport || !previewContainer) return;

  const photoId = getPhotoAtScrollPosition(carousel) ?? selectedPhotoId;
  if (!photoId) return;

  isTogglingFullscreen = true;
  selectedPhotoId = photoId;
  document.querySelectorAll('.timeline-cell').forEach((el) => {
    el.classList.toggle('selected', el.dataset.photoId === String(photoId));
  });
  updateMarkerStyles();

  const prevScrollBehavior = carousel.style.scrollBehavior;
  carousel.style.scrollBehavior = 'auto';

  if (overlay.classList.contains('visible')) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    if (carousel.parentElement === viewport) {
      viewport.removeChild(carousel);
      previewContainer.appendChild(carousel);
      scrollToPhoto(carousel, photoId, 'auto');
    }
  } else {
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (carousel.parentElement === previewContainer) {
      previewContainer.removeChild(carousel);
      viewport.appendChild(carousel);
      scrollToPhoto(carousel, photoId, 'auto');
    }
  }

  requestAnimationFrame(() => {
    carousel.style.scrollBehavior = prevScrollBehavior || '';
  });
  if (!opts.skipHashUpdate) updateHash();
  setTimeout(() => { isTogglingFullscreen = false; }, 100);
}

function navigatePhoto(direction) {
  if (photos.length === 0) return;
  const idx = photos.findIndex((p) => p.id === selectedPhotoId);
  if (idx === -1) return;
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= photos.length) return;
  // Jump instantly to the target: with CSS scroll-snap, repeated smooth scrolls
  // fight the snap and get pulled back to the current photo when pressing fast.
  // Map fly + hash are deferred to when the user pauses (scheduleNavSettle).
  isKeyboardNavigating = true;
  selectPhoto(photos[nextIdx].id, { instant: true, skipMapFly: true, skipHashUpdate: true });
  scheduleNavSettle();
}

function getPhotoDateKey(photo) {
  const raw = photo.taken_at || photo.created_at;
  if (!raw) return null;
  return raw.slice(0, 10);
}

function formatTimelineDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const sameYear = year === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric'
  });
}

function renderTimeline() {
  const track = document.getElementById('timeline');
  track.innerHTML = '';

  let prevDateKey = undefined;

  photos.forEach((photo) => {
    const cell = document.createElement('div');
    cell.className = 'timeline-cell';
    cell.dataset.photoId = photo.id;

    const dateKey = getPhotoDateKey(photo);
    const isNewGroup = dateKey !== prevDateKey;
    if (isNewGroup && prevDateKey !== undefined) cell.classList.add('timeline-cell-group-start');
    prevDateKey = dateKey;

    const thumb = document.createElement('div');
    thumb.className = 'timeline-cell-thumb';

    const img = document.createElement('img');
    img.src = `${CONVERTED_BASE}/${photo.thumbnail_filename || photo.converted_filename}`;
    img.alt = `Photo ${photo.id}`;
    img.loading = 'lazy';

    thumb.appendChild(img);
    cell.appendChild(thumb);

    if (isNewGroup && dateKey) {
      const label = document.createElement('span');
      label.className = 'timeline-date-label';
      label.textContent = formatTimelineDate(dateKey);
      cell.appendChild(label);
    }

    cell.addEventListener('click', () => selectPhoto(photo.id, { instant: true, skipTimelineScroll: true }));

    track.appendChild(cell);
  });
}

const MAP_STYLE_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_STYLE_SATELLITE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      attribution: '&copy; <a href="https://s2maps.eu">EOX Sentinel-2 cloudless</a>'
    }
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }]
};

function setupMap() {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);
  const { map: hashMap } = parseHash();
  currentMapStyle = hashMap === 'satellite' ? 'satellite' : 'map';
  const initialStyle = currentMapStyle === 'satellite' ? MAP_STYLE_SATELLITE : MAP_STYLE_LIBERTY;

  const center = photosWithCoords.length
    ? [photosWithCoords[0].longitude, photosWithCoords[0].latitude]
    : [-122.4194, 37.7749];

  map = new maplibregl.Map({
    container: 'map',
    style: initialStyle,
    center,
    zoom: 3
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  const sortedByTimeline = [...photosWithCoords].sort(
    (a, b) => photos.findIndex((p) => p.id === a.id) - photos.findIndex((p) => p.id === b.id)
  );

  function addMapMarkers() {
    markers.forEach((m) => m.remove());
    markers = sortedByTimeline.map((photo) => {
      const photoUrl = `${CONVERTED_BASE}/${photo.thumbnail_filename || photo.converted_filename}`;
      const el = document.createElement('div');
      el.className = 'map-marker';
      el.innerHTML = `<div class="map-marker-pin"><img src="${photoUrl}" alt=""></div>`;
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([photo.longitude, photo.latitude])
        .addTo(map);
      marker.photoId = photo.id;
      marker.getElement().addEventListener('click', () => selectPhoto(photo.id));
      return marker;
    });
    updateMarkerStyles();
  }

  let isFirstLoad = true;
  map.on('load', () => {
    map.resize();
    addMapMarkers();
    if (isFirstLoad && photosWithCoords.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      photosWithCoords.forEach((p) => bounds.extend([p.longitude, p.latitude]));
      map.fitBounds(bounds, { padding: 40 });
      isFirstLoad = false;
    }
    // Collapse attribution on load
    document.querySelector('.maplibregl-ctrl-attrib-button')?.click();
  });

  function setMapStyle(style) {
    currentMapStyle = style;
    const savedCenter = map.getCenter();
    const savedZoom = map.getZoom();
    map.setStyle(style === 'satellite' ? MAP_STYLE_SATELLITE : MAP_STYLE_LIBERTY);
    map.once('style.load', () => {
      map.setCenter(savedCenter);
      map.setZoom(savedZoom);
      addMapMarkers();
      document.querySelector('.maplibregl-ctrl-attrib-button')?.click();
    });
    updateHash();
  }

  setMapStyleFn = setMapStyle;
  window.addEventListener('resize', () => map?.resize());
  const mapContainer = document.querySelector('.map-container');
  if (mapContainer) {
    new ResizeObserver(() => map?.resize()).observe(mapContainer);
  }

  const minimizeBtn = document.getElementById('mapMinimizeBtn');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => setMapMinimized(!mapMinimized));
  }
}

// Content-space center of a timeline cell (its offset within the scrollable
// track), measured from the live layout so it accounts for per-group margins,
// padding, and variable label widths rather than assuming a uniform grid.
function timelineCellCenter(timeline, cell) {
  const tRect = timeline.getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  return timeline.scrollLeft + (cRect.left - tRect.left) + cRect.width / 2;
}

function syncTimelineToCarousel(carousel) {
  if (isScrollingTimeline || recentlySelectedFromTimeline) return;
  const timeline = document.querySelector('.timeline');
  if (!timeline || !carousel || photos.length <= 1) return;
  const slideWidth = carousel.offsetWidth;
  if (slideWidth <= 0) return;
  const cells = timeline.querySelectorAll('.timeline-cell');
  if (cells.length === 0) return;
  const f = getCarouselFractionalIndex(carousel);
  const i0 = Math.max(0, Math.min(cells.length - 1, Math.floor(f)));
  const i1 = Math.min(cells.length - 1, i0 + 1);
  const c0 = timelineCellCenter(timeline, cells[i0]);
  const c1 = timelineCellCenter(timeline, cells[i1]);
  const cellCenter = c0 + (c1 - c0) * (f - i0); // interpolate as we scroll between photos
  const targetScroll = Math.max(0, Math.min(
    Math.max(0, timeline.scrollWidth - timeline.offsetWidth),
    cellCenter - timeline.offsetWidth / 2
  ));
  timeline.scrollTo({ left: targetScroll, behavior: 'auto' });
}

function setupCarouselScrollSync(scrollEl, opts = {}) {
  if (!scrollEl) return;

  function syncSelection(photoId, updateHashNow = false) {
    if (isScrollingToSelection || (photoId == null || photoId === selectedPhotoId)) return;
    selectedPhotoId = photoId;
    document.querySelectorAll('.timeline-cell').forEach((el) => {
      el.classList.toggle('selected', el.dataset.photoId === String(photoId));
    });
    updateMarkerStyles();
    updateJournalPanel();
    if (updateHashNow) updateHash();
    if (opts.onSync && typeof opts.onSync === 'function') opts.onSync(photoId);
  }

  function flyMapToPhoto(photoId) {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo || photo.latitude == null || photo.longitude == null || !map) return;
    const lnglat = [photo.longitude, photo.latitude];
    const bounds = map.getBounds();
    const center = bounds.getCenter();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const paddedSw = [center.lng + (sw.lng - center.lng) * 0.9, center.lat + (sw.lat - center.lat) * 0.9];
    const paddedNe = [center.lng + (ne.lng - center.lng) * 0.9, center.lat + (ne.lat - center.lat) * 0.9];
    const paddedBounds = new maplibregl.LngLatBounds(paddedSw, paddedNe);
    if (paddedBounds.contains(lnglat)) return;
    const zoom = getZoomForPhoto(photo);
    const mapCenter = map.getCenter();
    const dist = Math.hypot(photo.latitude - mapCenter.lat, photo.longitude - mapCenter.lng);
    const duration = Math.min(1.5, Math.max(0.25, 0.25 + (dist / 0.1) * 1.25));
    map.flyTo({
      center: lnglat,
      zoom,
      duration: duration * 1000,
      essential: true
    });
  }

  function onCarouselScroll() {
    // While selectPhoto is animating the carousel, it also owns the timeline
    // position (via scrollIntoView). Syncing the timeline from these scroll
    // events here would fight that animation and make navigation jerky.
    if (isScrollingToSelection) return;
    const photoId = getPhotoAtScrollPosition(scrollEl);
    syncTimelineToCarousel(scrollEl);
    syncSelection(photoId, false);
  }

  function onCarouselScrollEnd() {
    isScrollingToSelection = false;
    if (isTogglingFullscreen) return;
    // Keyboard nav owns the selection and defers map/hash to scheduleNavSettle;
    // the instant per-press scrolls each fire scrollend, so don't act on them.
    if (isKeyboardNavigating) return;
    const photoId = getPhotoAtScrollPosition(scrollEl);
    syncTimelineToCarousel(scrollEl);
    syncSelection(photoId, false);
    if (photoId != null) {
      flyMapToPhoto(photoId);
      updateHash();
    }
  }

  scrollEl.addEventListener('scroll', onCarouselScroll, { passive: true });
  if ('onscrollend' in scrollEl) {
    scrollEl.addEventListener('scrollend', onCarouselScrollEnd);
  }
}

function renderAlbumPicker() {
  const grid = document.getElementById('albumGrid');
  if (!grid) return;
  grid.innerHTML = '';
  albums.forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'album-card';
    btn.dataset.album = a.album;
    const polaroid = document.createElement('div');
    polaroid.className = 'album-card-polaroid';
    const stack = document.createElement('div');
    stack.className = 'polaroid-stack';
    (a.thumbnails || []).forEach((t) => {
      const img = document.createElement('img');
      img.className = 'polaroid-img';
      img.src = t.thumbnail;
      img.alt = '';
      stack.appendChild(img);
    });
    polaroid.appendChild(stack);
    const name = document.createElement('p');
    name.className = 'album-card-name';
    name.textContent = formatAlbumName(a.album);
    const count = document.createElement('p');
    count.className = 'album-card-count';
    count.textContent = `${a.count} photo${a.count !== 1 ? 's' : ''}`;
    btn.appendChild(polaroid);
    btn.appendChild(name);
    btn.appendChild(count);
    btn.addEventListener('click', () => selectAlbum(a.album));
    grid.appendChild(btn);
  });
}

function showAlbumPicker() {
  document.getElementById('albumPicker')?.classList.remove('hidden');
  document.getElementById('albumView')?.classList.add('hidden');
}

function showAlbumView() {
  document.getElementById('albumPicker')?.classList.add('hidden');
  document.getElementById('albumView')?.classList.remove('hidden');
}

function applyHash() {
  const { id, fullscreen, map: hashMap, mapVisible, view, album: hashAlbum } = parseHash();

  if (hashAlbum != null && albums.some((a) => a.album === hashAlbum)) {
    if (hashAlbum !== currentAlbum) {
      currentAlbum = hashAlbum;
      showAlbumView();
      loadAlbum(hashAlbum);
      return;
    }
  } else if (hashAlbum === null || hashAlbum === '') {
    if (currentAlbum != null) {
      currentAlbum = null;
      renderAlbumPicker();
      showAlbumPicker();
      return;
    }
  }

  if (hashMap && hashMap !== currentMapStyle && setMapStyleFn) setMapStyleFn(hashMap);
  if (mapVisible !== !mapMinimized) {
    setMapMinimized(!mapVisible);
  }
  if (photos.length > 0 && id != null && photos.some((p) => p.id === id)) {
    if (id !== selectedPhotoId) selectPhoto(id, { skipHashUpdate: true, instant: true });
    const overlay = document.getElementById('fullscreenOverlay');
    const isOpen = overlay.classList.contains('visible');
    if (fullscreen !== isOpen) toggleFullscreen({ skipHashUpdate: true });
    updateHash();
  } else if (photos.length > 0 && selectedPhotoId == null) {
    selectPhoto(photos[0].id, { skipHashUpdate: true, instant: true });
  }

  if ((view === 'journal') !== journalTabActive) {
    setJournalTab(view === 'journal');
  }
}

async function selectAlbum(album) {
  currentAlbum = album;
  updateHash();
  showAlbumView();
  await loadAlbum(album);
}

async function loadAlbum(album) {
  const [albumPhotos, journalEntries] = await Promise.all([
    fetchPhotos(album),
    fetchJournal(album)
  ]);
  photos = albumPhotos;
  journalTabActive = false;
  buildJournalIndex(journalEntries);
  renderTimeline();
  setupMap();
  updateJournalPanel();

  const previewContainer = document.getElementById('photoPreview');
  if (photos.length === 0) {
    previewContainer.innerHTML = '<p class="photo-placeholder">No photos in this album</p>';
  } else {
    previewContainer.innerHTML = '';
    const carousel = document.createElement('div');
    carousel.id = 'photoCarousel';
    carousel.className = 'snap-carousel';
    previewContainer.appendChild(carousel);
    buildSnapCarousel(carousel);
    setupCarouselScrollSync(carousel);
  }
  applyHash();
}

async function init() {
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  albums = await fetchAlbums();
  const { album: hashAlbum } = parseHash();

  if (albums.length === 0) {
    document.getElementById('albumPicker').innerHTML = '<h1 class="album-picker-title">Photoshare</h1><hr class="album-picker-divider"><p class="photo-placeholder">No albums yet. Add photos to subfolders in the photos/ folder.</p>';
    document.getElementById('albumPicker').classList.remove('hidden');
    document.getElementById('albumView').classList.add('hidden');
    return;
  }

  const albumExists = hashAlbum != null && albums.some((a) => a.album === hashAlbum);
  if (albumExists) {
    // Route through applyHash (not selectAlbum) so the photo param is applied
    // before the hash is rewritten — selectAlbum's early updateHash() would drop
    // photo=<id> because nothing is selected yet.
    applyHash();
  } else {
    renderAlbumPicker();
    showAlbumPicker();
    document.getElementById('albumView').classList.add('hidden');
  }

  const menuToggle = document.getElementById('menuToggle');
  const menuOverlay = document.getElementById('menuOverlay');
  const menuDrawer = document.getElementById('menuDrawer');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      const open = menuDrawer?.classList.contains('open');
      if (open) closeMenu();
      else openMenu();
    });
  }
  menuOverlay?.addEventListener('click', closeMenu);
  document.getElementById('menuBackToAlbums')?.addEventListener('click', () => {
    closeMenu();
    location.hash = '';
  });
  document.getElementById('menuToggleMap')?.addEventListener('change', (e) => {
    setMapMinimized(!e.target.checked);
  });
  document.querySelectorAll('input[name="mapTiles"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (setMapStyleFn && e.target.value) setMapStyleFn(e.target.value);
    });
  });

  document.getElementById('mapTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.map-tab');
    if (!btn) return;
    setJournalTab(btn.dataset.tab === 'journal');
  });

  // Save/Cancel live in the date header; clicking the text elsewhere edits.
  document.getElementById('journalEntry')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.journal-tool-btn');
    if (btn) {
      if (btn.dataset.action === 'save') saveJournalEdit();
      else if (btn.dataset.action === 'cancel') cancelJournalEdit();
      return;
    }
    if (!journalEditing) enterJournalEdit();
  });

  const timeline = document.querySelector('.timeline');
  if (timeline) {
    const startTimelineScroll = () => {
      isScrollingTimeline = true;
    };
    const onTimelineScrollEnd = () => {
      requestAnimationFrame(() => {
        isScrollingTimeline = false;
      });
    };
    timeline.addEventListener('scroll', startTimelineScroll, { passive: true });
    timeline.addEventListener('scrollend', onTimelineScrollEnd);
  }

  window.addEventListener('hashchange', applyHash);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') {
      if (document.getElementById('menuDrawer')?.classList.contains('open')) {
        closeMenu();
        return;
      }
      if (document.getElementById('fullscreenOverlay').classList.contains('visible')) {
        toggleFullscreen();
        return;
      }
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigatePhoto('prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigatePhoto('next');
    }
  });

  document.querySelector('.photo-preview')?.addEventListener('click', (e) => {
    if (e.target.closest('.snap-carousel')) {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  document.getElementById('fullscreenOverlay')?.addEventListener('click', () => {
    if (document.getElementById('fullscreenOverlay').classList.contains('visible')) {
      toggleFullscreen();
    }
  });

  const overlay = document.getElementById('fullscreenOverlay');
  let overlayStartY = 0;

  overlay?.addEventListener('touchstart', (e) => {
    if (!overlay.classList.contains('visible')) return;
    overlayStartY = e.touches[0].clientY;
  }, { passive: true });

  overlay?.addEventListener('touchend', (e) => {
    if (!overlay.classList.contains('visible')) return;
    const deltaY = e.changedTouches[0].clientY - overlayStartY;
    if (Math.abs(deltaY) > 80) {
      toggleFullscreen();
    }
  }, { passive: true });
}

init().catch((err) => {
  console.error(err);
  document.getElementById('timeline').innerHTML = `<p style="padding: 1rem; color: #f85149;">Failed to load photos: ${err.message}</p>`;
});
