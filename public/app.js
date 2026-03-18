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

function getAdjacentPhotos(photoId) {
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return { prev: null, current: null, next: null };
  return {
    prev: idx > 0 ? photos[idx - 1] : null,
    current: photos[idx],
    next: idx < photos.length - 1 ? photos[idx + 1] : null
  };
}

function buildCarouselHTML(prev, current, next) {
  const slides = [prev, current, next].map((photo, i) => {
    const slide = document.createElement('div');
    slide.className = `carousel-slide${i === 1 ? ' current' : ''}`;
    if (photo) {
      const img = document.createElement('img');
      img.src = `${CONVERTED_BASE}/${photo.converted_filename}`;
      img.alt = `Photo ${photo.id}`;
      slide.appendChild(img);
    } else {
      slide.appendChild(document.createElement('div'));
    }
    return slide;
  });
  const track = document.createElement('div');
  track.className = 'carousel-track';
  slides.forEach((s) => track.appendChild(s));
  return track;
}

function updateCarousel(photoId) {
  const { prev, current, next } = getAdjacentPhotos(photoId);
  const track = buildCarouselHTML(prev, current, next);

  const preview = document.getElementById('photoPreview');
  preview.innerHTML = '';
  const viewport = document.createElement('div');
  viewport.className = 'carousel-viewport';
  viewport.appendChild(track);
  preview.appendChild(viewport);

  const overlay = document.getElementById('fullscreenOverlay');
  if (overlay.classList.contains('visible')) {
    const fsCarousel = document.getElementById('fullscreenCarousel');
    const fsViewport = overlay.querySelector('.carousel-viewport');
    fsCarousel.innerHTML = '';
    const fsTrack = buildCarouselHTML(prev, current, next);
    fsCarousel.replaceChildren(...fsTrack.childNodes);
    fsCarousel.classList.add('dragging');
    requestAnimationFrame(() => {
      setCarouselPosition(fsCarousel, 0, fsViewport?.offsetWidth);
      requestAnimationFrame(() => fsCarousel.classList.remove('dragging'));
    });
  }

  requestAnimationFrame(() => {
    const previewTrack = document.querySelector('#photoPreview .carousel-track');
    const previewViewport = document.querySelector('#photoPreview .carousel-viewport');
    previewTrack?.classList.add('dragging');
    setCarouselPosition(previewTrack, 0, previewViewport?.offsetWidth);
    requestAnimationFrame(() => previewTrack?.classList.remove('dragging'));
  });
}

function setCarouselPosition(track, dragPx, viewportWidth) {
  if (!track) return;
  const offset = viewportWidth ?? track.parentElement?.offsetWidth ?? 0;
  if (offset > 0) {
    track.style.transform = `translateX(calc(-${offset}px + ${dragPx}px))`;
  } else {
    track.style.transform = `translateX(calc(-33.333% + ${dragPx}px))`;
  }
}

function selectPhoto(photoId, opts = {}) {
  selectedPhotoId = photoId;
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return;

  document.querySelectorAll('.timeline-cell').forEach((el) => {
    el.classList.toggle('selected', el.dataset.photoId === String(photoId));
  });

  updateCarousel(photoId);

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

  const cell = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

  if (!opts.skipHashUpdate) updateHash();
}

function toggleFullscreen(opts = {}) {
  const overlay = document.getElementById('fullscreenOverlay');
  if (!selectedPhotoId) return;

  if (overlay.classList.contains('visible')) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  } else {
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    updateCarousel(selectedPhotoId);
  }
  if (!opts.skipHashUpdate) updateHash();
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

async function init() {
  // Prevent pinch-to-zoom on iOS (viewport meta is often ignored)
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  photos = await fetchPhotos();
  renderTimeline();
  setupMap();

  if (photos.length === 0) {
    document.getElementById('photoPreview').innerHTML = '<p class="photo-placeholder">No photos yet</p>';
  }

  function applyHash() {
    const { id, fullscreen } = parseHash();
    if (id != null && photos.some((p) => p.id === id)) {
      selectPhoto(id, { skipHashUpdate: true });
      const overlay = document.getElementById('fullscreenOverlay');
      const isOpen = overlay.classList.contains('visible');
      if (fullscreen !== isOpen) toggleFullscreen({ skipHashUpdate: true });
      updateHash();
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

  const SWIPE_THRESHOLD = 40;
  const SWIPE_VELOCITY = 0.25;
  const SWIPE_MIN_DISTANCE = 15;

  function setupCarouselSwipe(container, getTrack, getViewport) {
    let startX = 0, startY = 0, startTime = 0;

    container.addEventListener('touchstart', (e) => {
      const track = getTrack();
      if (!track) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      track.classList.add('dragging');
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      const track = getTrack();
      if (!track) return;
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
        e.preventDefault();
      }
      const idx = photos.findIndex((p) => p.id === selectedPhotoId);
      const atStart = idx <= 0;
      const atEnd = idx >= photos.length - 1;
      let dragX = deltaX;
      if (deltaX > 0 && atStart) dragX = deltaX * 0.3;
      else if (deltaX < 0 && atEnd) dragX = deltaX * 0.3;
      const viewport = getViewport();
      const vw = viewport?.offsetWidth || container.offsetWidth;
      const maxDrag = vw * 0.6;
      dragX = Math.max(-maxDrag, Math.min(maxDrag, dragX));
      setCarouselPosition(track, dragX, vw);
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
      const track = getTrack();
      if (!track) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaTime = Date.now() - startTime;
      const velocity = deltaTime > 0 ? deltaX / deltaTime : 0;
      const fastFlick = Math.abs(velocity) > SWIPE_VELOCITY && Math.abs(deltaX) > SWIPE_MIN_DISTANCE;
      const pastThreshold = Math.abs(deltaX) > SWIPE_THRESHOLD;
      const idx = photos.findIndex((p) => p.id === selectedPhotoId);
      const atStart = idx <= 0;
      const atEnd = idx >= photos.length - 1;

      track.classList.remove('dragging');

      let targetDir = null;
      if (pastThreshold || fastFlick) {
        if (deltaX > 0 && !atStart) targetDir = 'prev';
        else if (deltaX < 0 && !atEnd) targetDir = 'next';
      }

      const viewport = getViewport();
      const slideWidth = viewport?.offsetWidth || container.offsetWidth;

      if (targetDir) {
        const targetPx = targetDir === 'prev' ? slideWidth : -slideWidth;
        setCarouselPosition(track, targetPx, slideWidth);
        const onTransitionEnd = () => {
          track.removeEventListener('transitionend', onTransitionEnd);
          const nextId = targetDir === 'prev' ? photos[idx - 1].id : photos[idx + 1].id;
          selectPhoto(nextId);
        };
        track.addEventListener('transitionend', onTransitionEnd);
      } else {
        setCarouselPosition(track, 0, slideWidth);
      }
    }, { passive: true });
  }

  const photoPreview = document.querySelector('.photo-preview');
  setupCarouselSwipe(
    photoPreview,
    () => document.querySelector('#photoPreview .carousel-track'),
    () => document.querySelector('#photoPreview .carousel-viewport')
  );

  document.querySelector('.photo-preview').addEventListener('click', (e) => {
    if (e.target.closest('#photoPreview .carousel-slide.current')) {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  document.getElementById('fullscreenOverlay').addEventListener('click', () => {
    if (document.getElementById('fullscreenOverlay').classList.contains('visible')) {
      toggleFullscreen();
    }
  });

  const overlay = document.getElementById('fullscreenOverlay');
  let overlayStartX = 0, overlayStartY = 0, overlayStartTime = 0;

  overlay.addEventListener('touchstart', (e) => {
    if (!overlay.classList.contains('visible')) return;
    overlayStartX = e.touches[0].clientX;
    overlayStartY = e.touches[0].clientY;
    overlayStartTime = Date.now();
    const track = document.getElementById('fullscreenCarousel');
    if (track) track.classList.add('dragging');
  }, { passive: true });

  overlay.addEventListener('touchmove', (e) => {
    if (!overlay.classList.contains('visible')) return;
    const track = document.getElementById('fullscreenCarousel');
    const deltaX = e.touches[0].clientX - overlayStartX;
    const deltaY = e.touches[0].clientY - overlayStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
      e.preventDefault();
      const idx = photos.findIndex((p) => p.id === selectedPhotoId);
      const atStart = idx <= 0;
      const atEnd = idx >= photos.length - 1;
      let dragX = deltaX;
      if (deltaX > 0 && atStart) dragX = deltaX * 0.3;
      else if (deltaX < 0 && atEnd) dragX = deltaX * 0.3;
      const viewport = overlay.querySelector('.carousel-viewport');
      const vw = viewport?.offsetWidth || window.innerWidth;
      const maxDrag = vw * 0.6;
      dragX = Math.max(-maxDrag, Math.min(maxDrag, dragX));
      setCarouselPosition(track, dragX, vw);
    }
  }, { passive: false });

  overlay.addEventListener('touchend', (e) => {
    if (!overlay.classList.contains('visible')) return;
    const track = document.getElementById('fullscreenCarousel');
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - overlayStartX;
    const deltaY = touch.clientY - overlayStartY;
    const deltaTime = Date.now() - overlayStartTime;
    const velocity = deltaTime > 0 ? deltaX / deltaTime : 0;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (track) track.classList.remove('dragging');

    if (absY > SWIPE_THRESHOLD && absY > absX) {
      toggleFullscreen();
    } else {
      const idx = photos.findIndex((p) => p.id === selectedPhotoId);
      const atStart = idx <= 0;
      const atEnd = idx >= photos.length - 1;
      const pastThreshold = absX > SWIPE_THRESHOLD;
      const fastFlick = Math.abs(velocity) > SWIPE_VELOCITY && absX > SWIPE_MIN_DISTANCE;

      let targetDir = null;
      if (pastThreshold || fastFlick) {
        if (deltaX > 0 && !atStart) targetDir = 'prev';
        else if (deltaX < 0 && !atEnd) targetDir = 'next';
      }

      if (targetDir && track) {
        const viewport = overlay.querySelector('.carousel-viewport');
        const width = viewport?.offsetWidth || window.innerWidth;
        const targetPx = targetDir === 'prev' ? width : -width;
        setCarouselPosition(track, targetPx, width);
        const onTransitionEnd = () => {
          track.removeEventListener('transitionend', onTransitionEnd);
          const nextId = targetDir === 'prev' ? photos[idx - 1].id : photos[idx + 1].id;
          selectPhoto(nextId);
        };
        track.addEventListener('transitionend', onTransitionEnd);
      } else if (track) {
        const viewport = overlay.querySelector('.carousel-viewport');
        const width = viewport?.offsetWidth || window.innerWidth;
        setCarouselPosition(track, 0, width);
      }
    }
  }, { passive: true });

}

init().catch((err) => {
  console.error(err);
  document.getElementById('timeline').innerHTML = `<p style="padding: 1rem; color: #f85149;">Failed to load photos: ${err.message}</p>`;
});
