const API_BASE = '';
const PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;
const CONVERTED_BASE = `${API_BASE}/converted`;

let photos = [];
let map = null;
let markers = [];
let selectedPhotoId = null;
let isTogglingFullscreen = false;
let isScrollingToSelection = false;
let isScrollingTimeline = false;
let recentlyScrolledTimeline = false;
let currentMapStyle = 'map';
let setMapStyleFn = null;

function parseHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('photo');
  const map = params.get('map') === 'satellite' ? 'satellite' : 'map';
  return {
    id: id ? parseInt(id, 10) : null,
    fullscreen: params.get('fullscreen') === 'true',
    map
  };
}

function updateHash() {
  const overlay = document.getElementById('fullscreenOverlay');
  const isFullscreen = overlay && overlay.classList.contains('visible');
  const params = new URLSearchParams();
  if (selectedPhotoId != null) {
    params.set('photo', selectedPhotoId);
    if (isFullscreen) params.set('fullscreen', 'true');
  }
  if (currentMapStyle === 'satellite') params.set('map', 'satellite');
  const newHash = params.toString() ? '#' + params.toString() : '';
  if (location.hash !== newHash) {
    location.hash = newHash;
  }
}

async function fetchPhotos() {
  const res = await fetch(PHOTOS_ENDPOINT);
  if (!res.ok) throw new Error('Failed to fetch photos');
  return res.json();
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
    img.src = `${CONVERTED_BASE}/${photo.converted_filename}`;
    img.alt = `Photo ${photo.id}`;
    img.loading = 'lazy';
    img.addEventListener('load', () => {
      const portrait = img.naturalHeight > img.naturalWidth;
      slide.classList.toggle('photo-portrait', portrait);
      slide.classList.toggle('photo-landscape', !portrait);
    });
    slide.appendChild(img);
    containerEl.appendChild(slide);
  });
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

  if (photo.latitude != null && photo.longitude != null && map) {
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

  updateMarkerStyles();

  const cell = document.querySelector(`.timeline-cell[data-photo-id="${photoId}"]`);
  if (cell) {
    const scrollBehavior = opts.instant ? 'auto' : 'smooth';
    cell.scrollIntoView({ behavior: scrollBehavior, block: 'nearest', inline: 'center' });
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
  selectPhoto(photos[nextIdx].id);
}

function renderTimeline() {
  const track = document.getElementById('timeline');
  track.innerHTML = '';

  photos.forEach((photo) => {
    const cell = document.createElement('div');
    cell.className = 'timeline-cell';
    cell.dataset.photoId = photo.id;

    const img = document.createElement('img');
    img.src = `${CONVERTED_BASE}/${photo.thumbnail_filename || photo.converted_filename}`;
    img.alt = `Photo ${photo.id}`;
    img.loading = 'lazy';

    cell.appendChild(img);

    cell.addEventListener('click', () => selectPhoto(photo.id));

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
    layerControl.querySelectorAll('.map-layer-btn').forEach((b) => b.classList.toggle('active', b.dataset.style === style));
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

  const layerControl = document.createElement('div');
  layerControl.className = 'map-layer-control maplibregl-ctrl maplibregl-ctrl-group';
  layerControl.innerHTML = `
    <button type="button" class="map-layer-btn" data-style="map" title="Map view">🗺️</button>
    <button type="button" class="map-layer-btn" data-style="satellite" title="Satellite view">🛰️</button>
  `;
  layerControl.querySelectorAll('.map-layer-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.style === currentMapStyle);
    btn.addEventListener('click', () => {
      setMapStyle(btn.dataset.style);
    });
  });
  const layerControlObj = { onAdd: () => layerControl, onRemove: () => {} };
  const updateLayerControlPosition = () => {
    const pos = window.innerWidth <= 768 ? 'top-left' : 'top-right';
    if (map.getContainer().contains(layerControl)) {
      map.removeControl(layerControlObj);
    }
    map.addControl(layerControlObj, pos);
  };
  updateLayerControlPosition();

  setMapStyleFn = setMapStyle;
  window.addEventListener('resize', () => {
    map?.resize();
    const newPos = window.innerWidth <= 768 ? 'top-left' : 'top-right';
    const currentParent = layerControl.parentElement;
    const inTopLeft = currentParent?.classList.contains('maplibregl-ctrl-top-left');
    const wantTopLeft = newPos === 'top-left';
    if (inTopLeft !== wantTopLeft) updateLayerControlPosition();
  });
  const mapContainer = document.querySelector('.map-container');
  if (mapContainer) {
    new ResizeObserver(() => map?.resize()).observe(mapContainer);
  }
}

const TIMELINE_CELL_WIDTH = 80;
const TIMELINE_CELL_GAP = 8;
const TIMELINE_PADDING = 8;

function syncTimelineToCarousel(carousel) {
  if (isScrollingTimeline || recentlyScrolledTimeline) return;
  const timeline = document.querySelector('.timeline');
  if (!timeline || !carousel || photos.length <= 1) return;
  const slideWidth = carousel.offsetWidth;
  if (slideWidth <= 0) return;
  const f = getCarouselFractionalIndex(carousel);
  const cellCenter = TIMELINE_PADDING + f * (TIMELINE_CELL_WIDTH + TIMELINE_CELL_GAP) + TIMELINE_CELL_WIDTH / 2;
  const targetScroll = cellCenter - timeline.offsetWidth / 2;
  const maxScroll = Math.max(0, timeline.scrollWidth - timeline.offsetWidth);
  timeline.scrollLeft = Math.max(0, Math.min(maxScroll, targetScroll));
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
    const photoId = getPhotoAtScrollPosition(scrollEl);
    syncTimelineToCarousel(scrollEl);
    syncSelection(photoId, false);
  }

  function onCarouselScrollEnd() {
    isScrollingToSelection = false;
    if (isTogglingFullscreen) return;
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

async function init() {
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  photos = await fetchPhotos();
  renderTimeline();
  setupMap();

  const timeline = document.querySelector('.timeline');
  if (timeline) {
    const startTimelineScroll = () => {
      isScrollingTimeline = true;
      recentlyScrolledTimeline = true;
    };
    const endTimelineScroll = () => {
      isScrollingTimeline = false;
      setTimeout(() => {
        recentlyScrolledTimeline = false;
      }, 3500)
    };
    timeline.addEventListener('touchstart', startTimelineScroll, { passive: true });
    timeline.addEventListener('touchend', endTimelineScroll, { passive: true });
  }

  if (photos.length === 0) {
    document.getElementById('photoPreview').innerHTML = '<p class="photo-placeholder">No photos yet</p>';
  } else {
    const previewContainer = document.getElementById('photoPreview');
    previewContainer.innerHTML = '';
    const carousel = document.createElement('div');
    carousel.id = 'photoCarousel';
    carousel.className = 'snap-carousel';
    previewContainer.appendChild(carousel);
    buildSnapCarousel(carousel);

    setupCarouselScrollSync(carousel);
  }

  function applyHash() {
    const { id, fullscreen, map: hashMap } = parseHash();
    if (hashMap && hashMap !== currentMapStyle && setMapStyleFn) setMapStyleFn(hashMap);
    if (id != null && photos.some((p) => p.id === id)) {
      if (id !== selectedPhotoId) selectPhoto(id, { skipHashUpdate: true, instant: true });
      const overlay = document.getElementById('fullscreenOverlay');
      const isOpen = overlay.classList.contains('visible');
      if (fullscreen !== isOpen) toggleFullscreen({ skipHashUpdate: true });
      updateHash();
    } else if (photos.length > 0 && selectedPhotoId == null) {
      selectPhoto(photos[0].id, { skipHashUpdate: true, instant: true });
    }
  }

  applyHash();
  window.addEventListener('hashchange', applyHash);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (document.getElementById('fullscreenOverlay').classList.contains('visible') && e.key === 'Escape') {
      toggleFullscreen();
      return;
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
