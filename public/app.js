const API_BASE = '';
const PHOTOS_ENDPOINT = `${API_BASE}/api/photos`;
const CONVERTED_BASE = `${API_BASE}/converted`;

let photos = [];
let map = null;
let markers = [];
let selectedPhotoId = null;

function parseHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('photo');
  return {
    id: id ? parseInt(id, 10) : null,
    fullscreen: params.get('fullscreen') === 'true'
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
  const radius = 0.003;
  const nearby = photosWithCoords.filter(
    (p) =>
      p.id !== photo.id &&
      Math.abs(p.latitude - photo.latitude) < radius &&
      Math.abs(p.longitude - photo.longitude) < radius
  );
  const isMobile = window.innerWidth <= 768;
  const offset = isMobile ? -2 : 0;
  if (nearby.length >= 15) return 19 + offset;
  if (nearby.length >= 8) return 18 + offset;
  if (nearby.length >= 4) return 17 + offset;
  return 14 + offset;
}

function updateMarkerStyles() {
  markers.forEach((marker) => {
    const el = marker._icon;
    if (el) {
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
    slide.appendChild(img);
    containerEl.appendChild(slide);
  });
  return containerEl;
}

function scrollToPhoto(scrollEl, photoId, behavior = 'smooth') {
  if (!scrollEl || photos.length === 0) return;
  const slide = scrollEl.querySelector(`[data-photo-id="${photoId}"]`);
  if (!slide) return;
  const slideWidth = scrollEl.offsetWidth;
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return;
  const targetScroll = idx * slideWidth;
  scrollEl.scrollTo({ left: Math.max(0, targetScroll), behavior });
}

function getPhotoAtScrollPosition(scrollEl) {
  if (!scrollEl || photos.length === 0) return null;
  const rect = scrollEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const slides = scrollEl.querySelectorAll('.snap-carousel-slide');
  for (const slide of slides) {
    const slideRect = slide.getBoundingClientRect();
    if (slideRect.left <= centerX && centerX <= slideRect.right) {
      return parseInt(slide.dataset.photoId, 10);
    }
  }
  const first = slides[0];
  const last = slides[slides.length - 1];
  if (first && centerX < first.getBoundingClientRect().left + first.getBoundingClientRect().width / 2) {
    return parseInt(first.dataset.photoId, 10);
  }
  if (last && centerX > last.getBoundingClientRect().left + last.getBoundingClientRect().width / 2) {
    return parseInt(last.dataset.photoId, 10);
  }
  return null;
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
  if (carousel) scrollToPhoto(carousel, photoId, 'smooth');

  if (photo.latitude != null && photo.longitude != null && map) {
    const zoom = getZoomForPhoto(photo);
    const center = map.getCenter();
    const dist = Math.hypot(
      photo.latitude - center.lat,
      photo.longitude - center.lng
    );
    const duration = Math.min(1.5, Math.max(0.25, 0.25 + (dist / 0.1) * 1.25));
    map.flyTo([photo.latitude, photo.longitude], zoom, { duration });
  }

  updateMarkerStyles();

  const cell = document.querySelector(`.timeline-cell[data-photo-id="${photoId}"]`);
  if (cell) {
    cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  if (!opts.skipHashUpdate) updateHash();
}

function toggleFullscreen(opts = {}) {
  const overlay = document.getElementById('fullscreenOverlay');
  const carousel = getCarousel();
  if (!selectedPhotoId || !carousel) return;

  const viewport = overlay?.querySelector('.carousel-viewport');
  const previewContainer = document.getElementById('photoPreview');
  if (!viewport || !previewContainer) return;

  const prevScrollBehavior = carousel.style.scrollBehavior;
  carousel.style.scrollBehavior = 'auto';

  if (overlay.classList.contains('visible')) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (carousel.parentElement === viewport) {
      viewport.removeChild(carousel);
      previewContainer.appendChild(carousel);
      scrollToPhoto(carousel, selectedPhotoId, 'auto');
    }
  } else {
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (carousel.parentElement === previewContainer) {
      previewContainer.removeChild(carousel);
      viewport.appendChild(carousel);
      scrollToPhoto(carousel, selectedPhotoId, 'auto');
    }
  }

  requestAnimationFrame(() => {
    carousel.style.scrollBehavior = prevScrollBehavior || '';
  });
  if (!opts.skipHashUpdate) updateHash();
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
    img.src = `${CONVERTED_BASE}/${photo.converted_filename}`;
    img.alt = `Photo ${photo.id}`;
    img.loading = 'lazy';

    cell.appendChild(img);

    cell.addEventListener('click', () => selectPhoto(photo.id));

    track.appendChild(cell);
  });
}

function setupMap() {
  const photosWithCoords = photos.filter((p) => p.latitude != null && p.longitude != null);

  const center = photosWithCoords.length
    ? [photosWithCoords[0].latitude, photosWithCoords[0].longitude]
    : [37.7749, -122.4194];

  map = L.map('map').setView(center, 3);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abc',
    maxZoom: 19
  }).addTo(map);

  markers = photosWithCoords.map((photo) => {
    const photoUrl = `${CONVERTED_BASE}/${photo.converted_filename}`;
    const marker = L.marker([photo.latitude, photo.longitude], {
      icon: L.divIcon({
        className: 'map-marker',
        html: `<div class="map-marker-pin"><img src="${photoUrl}" alt=""></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
      })
    }).addTo(map);

    marker.photoId = photo.id;
    marker.on('click', () => selectPhoto(photo.id));

    return marker;
  });

  updateMarkerStyles();

  if (photosWithCoords.length > 1) {
    const bounds = L.latLngBounds(photosWithCoords.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  requestAnimationFrame(() => map.invalidateSize());
}

function setupCarouselScrollSync(scrollEl, opts = {}) {
  if (!scrollEl) return;
  let scrollEndTimer = null;

  function syncFromScroll() {
    const photoId = getPhotoAtScrollPosition(scrollEl);
    if (photoId != null && photoId !== selectedPhotoId) {
      selectedPhotoId = photoId;
      document.querySelectorAll('.timeline-cell').forEach((el) => {
        el.classList.toggle('selected', el.dataset.photoId === String(photoId));
      });
      updateMarkerStyles();
      updateHash();
      if (opts.onSync && typeof opts.onSync === 'function') {
        opts.onSync(photoId);
      }
    }
  }

  scrollEl.addEventListener('scroll', () => {
    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(syncFromScroll, 100);
  });

  if ('onscrollend' in scrollEl) {
    scrollEl.addEventListener('scrollend', syncFromScroll);
  }
}

async function init() {
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  photos = await fetchPhotos();
  renderTimeline();
  setupMap();

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
    const { id, fullscreen } = parseHash();
    if (id != null && photos.some((p) => p.id === id)) {
      selectPhoto(id, { skipHashUpdate: true });
      const overlay = document.getElementById('fullscreenOverlay');
      const isOpen = overlay.classList.contains('visible');
      if (fullscreen !== isOpen) toggleFullscreen({ skipHashUpdate: true });
      updateHash();
    } else if (photos.length > 0 && selectedPhotoId == null) {
      selectPhoto(photos[0].id, { skipHashUpdate: true });
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
