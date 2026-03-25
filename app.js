// ===== State =====
let map;
let shuttleData = {};
let currentMarkers = [];
let currentPolylines = [];
let centerMarkers = [];
let nationalLayerGroup = null; 
let focusMarker = null; 
let currentRightTab = 'national'; // 'national', 'qa', 'error'
window.activeFCs = [];

const ROUTE_COLORS = [
    '#4F46E5', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1'
];

const KOREA_BOUNDS = {
    minLat: 33.0,
    maxLat: 39.0,
    minLng: 124.0,
    maxLng: 132.0
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    await loadData();
    populateFCs();
    setupEventListeners();
    
    setTimeout(() => {
        showAllCenters();
    }, 1000);
});

// ===== Map Initialization =====
function initMap() {
    map = L.map('map', {
        center: [36.5, 127.5],
        zoom: 7,
        zoomControl: false,
        preferCanvas: true 
    });

    L.tileLayer('https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://map.vworld.kr/">Vworld</a>',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    
    nationalLayerGroup = L.layerGroup().addTo(map);
}

// ===== Load Data =====
async function loadData() {
    try {
        const response = await fetch('./data/shuttle_data.json');
        shuttleData = await response.json();
    } catch (error) {
        console.error('데이터 로드 실패:', error);
    }
}

// ===== Helpers =====
function isWithinKorea(lat, lng) {
    if (!lat || !lng) return false;
    const nLat = parseFloat(lat);
    const nLng = parseFloat(lng);
    return nLat >= KOREA_BOUNDS.minLat && nLat <= KOREA_BOUNDS.maxLat &&
           nLng >= KOREA_BOUNDS.minLng && nLng <= KOREA_BOUNDS.maxLng;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// ===== Right Sidebar Controller =====

function refreshRightSidebar() {
    const listEl = document.getElementById('national-route-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (currentRightTab === 'national') {
        renderNationalRoutesList(listEl);
    } else if (currentRightTab === 'qa') {
        renderQAAnalysis(listEl);
    } else if (currentRightTab === 'error') {
        renderCoordinateErrors(listEl);
    }
}

function renderNationalRoutesList(listEl) {
    let colorIdx = 0;
    Object.keys(shuttleData).sort().forEach(fcCode => {
        const fc = shuttleData[fcCode];
        const shifts = fc.shifts || {};
        const fcGroup = document.createElement('div');
        fcGroup.className = 'national-group';
        fcGroup.innerHTML = `<div class="national-fc-header">🏢 ${fc.center?.name || fcCode}</div>`;
        const fcRoutesList = document.createElement('div');
        fcGroup.appendChild(fcRoutesList);

        Object.keys(shifts).forEach(shiftName => {
            const routes = shifts[shiftName];
            Object.keys(routes).forEach(routeName => {
                const stops = routes[routeName];
                const validStops = stops.filter(s => isWithinKorea(s.Latitude, s.Longitude));
                if (validStops.length > 0) {
                    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length]; colorIdx++;
                    const routeItem = document.createElement('div');
                    routeItem.className = 'national-route-item';
                    routeItem.innerHTML = `
                        <div class="national-route-name" style="color:${color};">🚌 ${routeName}</div>
                        <div class="national-route-meta">${shiftName} · ${validStops.length}개 <span class="toggle-stops">▼</span></div>
                        <div class="nested-stop-list" style="display:none;"></div>
                    `;
                    const nestedList = routeItem.querySelector('.nested-stop-list');
                    validStops.forEach((stop, idx) => {
                        const stopEl = document.createElement('div');
                        stopEl.className = 'nested-stop-item';
                        stopEl.innerHTML = `<span class="n-idx">${idx+1}</span> ${stop.Name}`;
                        stopEl.onclick = (e) => { e.stopPropagation(); focusStopOnMap(stop, routeName, fcCode, idx, color); };
                        nestedList.appendChild(stopEl);
                    });
                    routeItem.onclick = () => {
                        const isExpanded = nestedList.style.display === 'block';
                        nestedList.style.display = isExpanded ? 'none' : 'block';
                        routeItem.querySelector('.toggle-stops').textContent = isExpanded ? '▼' : '▲';
                        if (!isExpanded) {
                            const path = validStops.map(s => [s.Latitude, s.Longitude]);
                            const routeBounds = L.latLngBounds(path);
                            if (routeBounds.isValid()) map.flyToBounds(routeBounds, { padding: [100, 100], duration: 1 });
                        }
                    };
                    fcRoutesList.appendChild(routeItem);
                }
            });
        });
        if (fcRoutesList.children.length > 0) listEl.appendChild(fcGroup);
    });
}

function renderQAAnalysis(listEl) {
    let suspects = [];
    Object.keys(shuttleData).forEach(fcCode => {
        const shifts = shuttleData[fcCode].shifts || {};
        Object.keys(shifts).forEach(shiftName => {
            const routes = shifts[shiftName];
            Object.keys(routes).forEach(routeName => {
                const stops = routes[routeName];
                for (let i = 0; i < stops.length; i++) {
                    const stop = stops[i];
                    if (!isWithinKorea(stop.Latitude, stop.Longitude)) continue;
                    if (i > 0) {
                        const prev = stops[i - 1];
                        if (isWithinKorea(prev.Latitude, prev.Longitude)) {
                            const dist = getDistance(stop.Latitude, stop.Longitude, prev.Latitude, prev.Longitude);
                            if (dist > 30) suspects.push({ fcCode, routeName, stop, reason: `급격한 경로 이탈 (${dist.toFixed(1)}km)`, color: 'var(--danger)' });
                        }
                    }
                }
            });
        });
    });

    if (suspects.length === 0) {
        listEl.innerHTML = '<div class="empty-qa">✅ 발견된 데이터 오류가 없습니다.</div>';
    } else {
        const grouped = {};
        suspects.forEach(s => { if (!grouped[s.fcCode]) grouped[s.fcCode] = []; grouped[s.fcCode].push(s); });
        Object.keys(grouped).sort().forEach(fcCode => {
            const groupEl = document.createElement('div');
            groupEl.className = 'national-group';
            groupEl.innerHTML = `<div class="national-fc-header">🏢 [${fcCode}] 의심 정류장 ${grouped[fcCode].length}개</div>`;
            grouped[fcCode].forEach((item, idx) => {
                const itemEl = document.createElement('div');
                itemEl.className = 'national-route-item qa-item';
                itemEl.style.borderLeft = `4px solid ${item.color}`;
                itemEl.innerHTML = `
                    <div class="national-route-name">${item.routeName}</div>
                    <div class="qa-stop-name">${item.stop.Name}</div>
                    <div class="qa-reason" style="color:${item.color}">${item.reason}</div>
                    <div class="qa-meta">${item.stop.Address || '주소 정보 없음'}</div>
                `;
                itemEl.onclick = () => focusStopOnMap(item.stop, item.routeName, item.fcCode, idx, item.color === 'var(--danger)' ? '#ef4444' : '#f59e0b');
                groupEl.appendChild(itemEl);
            });
            listEl.appendChild(groupEl);
        });
    }
}

function renderCoordinateErrors(listEl) {
    let errors = [];
    Object.keys(shuttleData).forEach(fcCode => {
        const shifts = shuttleData[fcCode].shifts || {};
        Object.keys(shifts).forEach(shiftName => {
            Object.keys(shifts[shiftName]).forEach(routeName => {
                const stops = shifts[shiftName][routeName];
                const invalid = stops.filter(s => !isWithinKorea(s.Latitude, s.Longitude));
                invalid.forEach(stop => errors.push({ fcCode, routeName, stop }));
            });
        });
    });

    if (errors.length === 0) {
        listEl.innerHTML = '<div class="empty-qa">✅ 한국 외 좌표 데이터가 없습니다.</div>';
    } else {
        const grouped = {};
        errors.forEach(e => { if (!grouped[e.fcCode]) grouped[e.fcCode] = []; grouped[e.fcCode].push(e); });
        Object.keys(grouped).sort().forEach(fcCode => {
            const groupEl = document.createElement('div');
            groupEl.className = 'national-group';
            groupEl.innerHTML = `<div class="national-fc-header" style="color:var(--danger)">❌ [${fcCode}] 좌표 오류 ${grouped[fcCode].length}개</div>`;
            grouped[fcCode].forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'national-route-item';
                itemEl.style.borderLeft = "3px solid var(--danger)";
                itemEl.innerHTML = `
                    <div class="national-route-name">🚫 ${item.routeName} - ${item.stop.Name}</div>
                    <div class="qa-meta">좌표: ${item.stop.Latitude || 'N/A'}, ${item.stop.Longitude || 'N/A'}</div>
                `;
                groupEl.appendChild(itemEl);
            });
            listEl.appendChild(groupEl);
        });
    }
}

// ===== UI Logic =====

function setupEventListeners() {
    const fcSelect = document.getElementById('fc-select');
    const shiftSelect = document.getElementById('shift-select');
    const routeSelect = document.getElementById('route-select');
    const compareAllBtn = document.getElementById('compare-all-btn');
    const closeRightSidebar = document.getElementById('close-right-sidebar');
    const tabs = document.querySelectorAll('.s-tab');

    if (fcSelect) {
        fcSelect.addEventListener('change', (e) => {
            const fc = e.target.value;
            shiftSelect.innerHTML = '<option value="">근무조를 선택하세요</option>';
            shiftSelect.disabled = !fc;
            if (fc && shuttleData[fc]?.shifts) {
                Object.keys(shuttleData[fc].shifts).sort().forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s; opt.textContent = s;
                    shiftSelect.appendChild(opt);
                });
            }
            clearNational();
            toggleRightSidebar(false);
        });
    }

    if (shiftSelect) {
        shiftSelect.addEventListener('change', (e) => {
            const fc = fcSelect.value;
            const shift = e.target.value;
            routeSelect.innerHTML = '<option value="">노선을 선택하세요</option>';
            routeSelect.disabled = !shift;
            if (fc && shift && shuttleData[fc]?.shifts[shift]) {
                Object.keys(shuttleData[fc].shifts[shift]).sort().forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r; opt.textContent = r;
                    routeSelect.appendChild(opt);
                });
            }
        });
    }

    if (routeSelect) {
        routeSelect.addEventListener('change', (e) => {
            const fc = fcSelect.value;
            const shift = shiftSelect.value;
            const route = e.target.value;
            if (fc && shift && route) {
                clearNational();
                toggleRightSidebar(false);
                const stops = shuttleData[fc].shifts[shift][route];
                renderSingleRoute(stops, shuttleData[fc].center, route, '#4F46E5', fc);
            }
        });
    }

    if (compareAllBtn) {
        compareAllBtn.addEventListener('click', () => {
            showNationalRoutesOnMap();
            currentRightTab = 'national';
            updateTabs();
            refreshRightSidebar();
            toggleRightSidebar(true);
        });
    }

    if (closeRightSidebar) {
        closeRightSidebar.addEventListener('click', () => toggleRightSidebar(false));
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            currentRightTab = tab.dataset.tab;
            updateTabs();
            refreshRightSidebar();
        });
    });

    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.onclick = () => sidebar.classList.toggle('collapsed');
    }
}

function updateTabs() {
    document.querySelectorAll('.s-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === currentRightTab);
    });
}

function toggleRightSidebar(show) {
    const sidebar = document.getElementById('sidebar-right');
    if (sidebar) sidebar.style.display = show ? 'flex' : 'none';
}

function clearNational() {
    if (nationalLayerGroup) nationalLayerGroup.clearLayers();
    if (focusMarker) { map.removeLayer(focusMarker); focusMarker = null; }
}

// ===== Map Rendering =====

function showNationalRoutesOnMap() {
    clearRoute();
    clearNational();
    const bounds = L.latLngBounds();
    let colorIdx = 0;

    Object.keys(shuttleData).forEach(fcCode => {
        const shifts = shuttleData[fcCode].shifts || {};
        Object.keys(shifts).forEach(shiftName => {
            Object.keys(shifts[shiftName]).forEach(routeName => {
                const stops = shifts[shiftName][routeName];
                const validStops = stops.filter(s => isWithinKorea(s.Latitude, s.Longitude));
                if (validStops.length > 0) {
                    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length]; colorIdx++;
                    const path = [];
                    validStops.forEach((stop, idx) => {
                        const latlng = [stop.Latitude, stop.Longitude];
                        path.push(latlng);
                        bounds.extend(latlng);
                        const dotMarker = L.circleMarker(latlng, { radius: 5, fillColor: color, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.8 })
                            .bindPopup(createStopPopup(stop, routeName, fcCode, idx), { minWidth: 600 });
                        nationalLayerGroup.addLayer(dotMarker);
                    });
                    nationalLayerGroup.addLayer(L.polyline(path, { color, weight: 2, opacity: 0.5, smoothFactor: 2 }));
                }
            });
        });
    });
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
}

function createStopPopup(stop, routeName, fcCode, index) {
    const imageUrl = stop["Image URL"];
    const imgHtml = imageUrl ? `
        <div class="popup-photo-container">
            <div class="photo-label">📸 센터 등록 정류장 공식 사진</div>
            <img src="${imageUrl}" class="popup-photo-balanced" alt="${stop.Name}" onclick="window.open('${imageUrl}', '_blank')">
            <div class="photo-hint">* 지도의 상세 위치를 사진과 대조해 보세요.</div>
        </div>
    ` : '<div class="popup-no-photo">등록된 사진이 없습니다.</div>';

    return `
        <div class="custom-popup balanced">
            <div class="popup-header-group">
                <div class="popup-route">🏢 [${fcCode}] ${routeName}</div>
                <div class="popup-time">🕐 ${stop.Time}</div>
                <div class="popup-title">${index + 1}. ${stop.Name}</div>
                <div class="popup-addr">${stop.Address || ''}</div>
            </div>
            ${imgHtml}
            <div class="popup-links-balanced">
                <a href="https://map.naver.com/v5/search/${stop.Latitude},${stop.Longitude}" target="_blank">네이버 지도</a>
                <a href="https://map.kakao.com/link/map/${stop.Name},${stop.Latitude},${stop.Longitude}" target="_blank">카카오 맵</a>
            </div>
        </div>
    `;
}

function focusStopOnMap(stop, routeName, fcCode, index, color) {
    const latlng = [parseFloat(stop.Latitude), parseFloat(stop.Longitude)];
    if (focusMarker) map.removeLayer(focusMarker);
    focusMarker = L.circleMarker(latlng, { radius: 12, fillColor: color, color: '#fff', weight: 3, opacity: 1, fillOpacity: 0.9, className: 'focus-ping' }).addTo(map);
    map.flyTo(latlng, 17, { duration: 1 });
    setTimeout(() => {
        focusMarker.bindPopup(createStopPopup(stop, routeName, fcCode, index), { minWidth: 600, maxWidth: 600, className: 'comparison-popup-balanced' }).openPopup();
    }, 1000);
}

function renderSingleRoute(stops, center, routeName, color, fcCode) {
    clearRoute();
    clearNational();
    const bounds = L.latLngBounds();
    const path = [];
    const stopListEl = document.getElementById('stop-list');
    const routeDetailsEl = document.getElementById('route-details');
    const routeTitleEl = document.getElementById('route-title');

    if (stopListEl) stopListEl.innerHTML = '';
    if (routeDetailsEl) routeDetailsEl.style.display = 'block';
    if (routeTitleEl) routeTitleEl.textContent = "📍 노선 정류장";

    if (center && isWithinKorea(center.lat, center.lng)) bounds.extend([center.lat, center.lng]);

    stops.forEach((stop, index) => {
        if (!isWithinKorea(stop.Latitude, stop.Longitude)) return;
        const latlng = [stop.Latitude, stop.Longitude];
        path.push(latlng);
        bounds.extend(latlng);
        const marker = L.marker(latlng, { icon: L.divIcon({ className: 'stop-icon', html: `<div class="stop-marker-inner" style="background:${color};">${index + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
            .addTo(map).bindPopup(createStopPopup(stop, routeName, fcCode, index), { minWidth: 600, maxWidth: 600, className: 'comparison-popup-balanced' });
        currentMarkers.push(marker);
        if (stopListEl) {
            const item = document.createElement('div');
            item.className = 'stop-item';
            item.innerHTML = `<div class="stop-number">${index + 1}</div><div class="stop-content"><div class="stop-time">🕐 ${stop.Time}</div><div class="stop-name">${stop.Name}</div></div>`;
            item.onclick = () => focusStopOnMap(stop, routeName, fcCode, index, color);
            stopListEl.appendChild(item);
        }
    });

    currentPolylines.push(L.polyline(path, { color, weight: 4, opacity: 0.7, dashArray: '10, 8' }).addTo(map));
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50] });
}

function clearRoute() {
    currentMarkers.forEach(m => map.removeLayer(m));
    currentPolylines.forEach(l => map.removeLayer(l));
    currentMarkers = []; currentPolylines = [];
    if (document.getElementById('route-details')) document.getElementById('route-details').style.display = 'none';
}

function showAllCenters() {
    centerMarkers.forEach(m => map.removeLayer(m));
    centerMarkers = [];
    const bounds = L.latLngBounds();
    Object.keys(shuttleData).forEach(fcCode => {
        const center = shuttleData[fcCode].center;
        if (!center || !isWithinKorea(center.lat, center.lng)) return;
        bounds.extend([center.lat, center.lng]);
        centerMarkers.push(L.marker([center.lat, center.lng]).addTo(map).bindPopup(`<b>${center.name}</b><br>${center.address || ''}`));
    });
    if (bounds.isValid() && centerMarkers.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
}
