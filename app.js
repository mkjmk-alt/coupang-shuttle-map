// ===== State =====
let map;
let shuttleData = {};
let currentMarkers = [];
let currentPolylines = [];
let centerMarkers = [];
let nationalLayerGroup = null; 
let focusMarker = null; 
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
    }, 500);
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

// ===== Populate UI =====
function populateFCs() {
    const fcSelect = document.getElementById('fc-select');
    if (!fcSelect) return;

    Object.keys(shuttleData).sort().forEach(fc => {
        const option = document.createElement('option');
        option.value = fc;
        const centerName = shuttleData[fc].center?.name || fc;
        option.textContent = `${centerName} [${fc}]`;
        fcSelect.appendChild(option);
    });
}

function setupEventListeners() {
    const fcSelect = document.getElementById('fc-select');
    const shiftSelect = document.getElementById('shift-select');
    const routeSelect = document.getElementById('route-select');
    const compareAllBtn = document.getElementById('compare-all-btn');
    const closeRightSidebar = document.getElementById('close-right-sidebar');

    if (fcSelect) {
        fcSelect.addEventListener('change', (e) => {
            const fc = e.target.value;
            shiftSelect.innerHTML = '<option value="">근무조를 선택하세요</option>';
            shiftSelect.disabled = !fc;
            routeSelect.innerHTML = '<option value="">노선을 선택하세요</option>';
            routeSelect.disabled = true;

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
                const center = shuttleData[fc].center;
                renderSingleRoute(stops, center, route, '#4F46E5', fc);
            }
        });
    }

    if (compareAllBtn) {
        compareAllBtn.addEventListener('click', () => {
            showNationalRoutes();
        });
    }

    if (closeRightSidebar) {
        closeRightSidebar.addEventListener('click', () => {
            toggleRightSidebar(false);
        });
    }

    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.onclick = () => {
            sidebar.classList.toggle('collapsed');
        };
    }
}

function toggleRightSidebar(show) {
    const sidebar = document.getElementById('sidebar-right');
    const title = sidebar?.querySelector('h3');
    if (title) title.textContent = "⚠️ 좌표 오류 데이터 (한국 외)";
    
    if (sidebar) {
        sidebar.style.display = show ? 'flex' : 'none';
    }
}

function clearNational() {
    if (nationalLayerGroup) nationalLayerGroup.clearLayers();
    if (focusMarker) {
        map.removeLayer(focusMarker);
        focusMarker = null;
    }
}

// ===== Rendering =====

function showNationalRoutes() {
    clearRoute();
    clearNational();
    
    const bounds = L.latLngBounds();
    let colorIdx = 0;
    
    const leftListEl = document.getElementById('stop-list');
    const rightListEl = document.getElementById('national-route-list');
    const routeDetailsEl = document.getElementById('route-details');
    const routeTitleEl = document.getElementById('route-title');

    if (leftListEl) leftListEl.innerHTML = '';
    if (rightListEl) rightListEl.innerHTML = '';
    if (routeDetailsEl) routeDetailsEl.style.display = 'block';
    if (routeTitleEl) routeTitleEl.textContent = "📑 전국 노선 현황";
    
    let hasInvalidData = false;

    Object.keys(shuttleData).sort().forEach(fcCode => {
        const fc = shuttleData[fcCode];
        const shifts = fc.shifts;
        if (!shifts) return;

        const leftFcGroup = document.createElement('div');
        leftFcGroup.className = 'national-group';
        leftFcGroup.innerHTML = `<div class="national-fc-header">🏢 ${fc.center?.name || fcCode}</div>`;
        const leftFcRoutesList = document.createElement('div');
        leftFcGroup.appendChild(leftFcRoutesList);

        const rightFcGroup = document.createElement('div');
        rightFcGroup.className = 'national-group';
        rightFcGroup.innerHTML = `<div class="national-fc-header" style="background:rgba(239, 68, 68, 0.1); color:var(--danger);">❌ ${fcCode} 오류 데이터</div>`;
        const rightFcRoutesList = document.createElement('div');
        rightFcGroup.appendChild(rightFcRoutesList);

        Object.keys(shifts).forEach(shiftName => {
            const routes = shifts[shiftName];
            Object.keys(routes).forEach(routeName => {
                const stops = routes[routeName];
                
                const validStops = stops.filter(s => isWithinKorea(s.Latitude, s.Longitude));
                const invalidStops = stops.filter(s => !isWithinKorea(s.Latitude, s.Longitude));

                if (validStops.length > 0) {
                    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
                    colorIdx++;

                    const path = [];
                    validStops.forEach((stop, idx) => {
                        const latlng = [stop.Latitude, stop.Longitude];
                        path.push(latlng);
                        bounds.extend(latlng);

                        const dotMarker = L.circleMarker(latlng, {
                            radius: 5, fillColor: color, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.8
                        }).bindPopup(createStopPopup(stop, routeName, fcCode, idx), {
                            minWidth: 640 // minWidth를 강제로 설정
                        });
                        
                        nationalLayerGroup.addLayer(dotMarker);
                    });

                    const line = L.polyline(path, { color, weight: 2, opacity: 0.5, smoothFactor: 2 });
                    nationalLayerGroup.addLayer(line);

                    const routeItem = document.createElement('div');
                    routeItem.className = 'national-route-item';
                    routeItem.innerHTML = `
                        <div class="national-route-name" style="color:${color};">🚌 ${routeName}</div>
                        <div class="national-route-meta">${shiftName} · ${validStops.length}개 정류장 <span class="toggle-stops">▼</span></div>
                        <div class="nested-stop-list" style="display:none;"></div>
                    `;
                    
                    const nestedList = routeItem.querySelector('.nested-stop-list');
                    validStops.forEach((stop, idx) => {
                        const stopEl = document.createElement('div');
                        stopEl.className = 'nested-stop-item';
                        stopEl.innerHTML = `<span class="n-idx">${idx+1}</span> ${stop.Name} <span class="n-time">${stop.Time}</span>`;
                        stopEl.onclick = (e) => {
                            e.stopPropagation();
                            focusStopOnMap(stop, routeName, fcCode, idx, color);
                        };
                        nestedList.appendChild(stopEl);
                    });

                    routeItem.onclick = () => {
                        const isExpanded = nestedList.style.display === 'block';
                        nestedList.style.display = isExpanded ? 'none' : 'block';
                        routeItem.querySelector('.toggle-stops').textContent = isExpanded ? '▼' : '▲';
                        
                        if (!isExpanded) {
                            const routeBounds = L.latLngBounds(path);
                            if (routeBounds.isValid()) map.flyToBounds(routeBounds, { padding: [100, 100], duration: 1 });
                        }
                    };
                    leftFcRoutesList.appendChild(routeItem);
                }

                if (invalidStops.length > 0) {
                    hasInvalidData = true;
                    invalidStops.forEach(stop => {
                        const errorItem = document.createElement('div');
                        errorItem.className = 'national-route-item';
                        errorItem.style.borderLeft = "3px solid var(--danger)";
                        errorItem.innerHTML = `
                            <div class="national-route-name">🚫 ${routeName} - ${stop.Name}</div>
                            <div class="national-route-meta">좌표: ${stop.Latitude || 'N/A'}, ${stop.Longitude || 'N/A'}</div>
                        `;
                        rightFcRoutesList.appendChild(errorItem);
                    });
                }
            });
        });
        
        if (leftFcRoutesList.children.length > 0) if (leftListEl) leftListEl.appendChild(leftFcGroup);
        if (rightFcRoutesList.children.length > 0) if (rightListEl) rightListEl.appendChild(rightFcGroup);
    });

    if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
    }
    
    toggleRightSidebar(hasInvalidData);
}

function createStopPopup(stop, routeName, fcCode, index) {
    const imageUrl = stop["Image URL"];
    const imgHtml = imageUrl ? `
        <div class="popup-photo-container">
            <div class="photo-label">📸 센터 등록 정류장 사진</div>
            <img src="${imageUrl}" class="popup-photo" alt="${stop.Name}" onclick="window.open('${imageUrl}', '_blank')">
            <div class="photo-hint">* 사진을 클릭하면 크게 볼 수 있습니다</div>
        </div>
    ` : '<div class="popup-no-photo">등록된 사진이 없습니다.</div>';

    return `
        <div class="custom-popup large">
            <div class="popup-route">🏢 [${fcCode}] ${routeName}</div>
            <div class="popup-time">🕐 ${stop.Time}</div>
            <div class="popup-title">${index + 1}. ${stop.Name}</div>
            <div class="popup-addr">${stop.Address || ''}</div>
            ${imgHtml}
            <div class="popup-links">
                <a href="https://map.naver.com/v5/search/${stop.Latitude},${stop.Longitude}" target="_blank">네이버 지도</a>
                <a href="https://map.kakao.com/link/map/${stop.Name},${stop.Latitude},${stop.Longitude}" target="_blank">카카오 맵</a>
            </div>
        </div>
    `;
}

function focusStopOnMap(stop, routeName, fcCode, index, color) {
    const latlng = [parseFloat(stop.Latitude), parseFloat(stop.Longitude)];
    
    if (focusMarker) {
        map.removeLayer(focusMarker);
    }

    focusMarker = L.circleMarker(latlng, {
        radius: 12,
        fillColor: color || '#ff3e00',
        color: '#fff',
        weight: 3, opacity: 1, fillOpacity: 0.9, className: 'focus-ping'
    }).addTo(map);

    map.flyTo(latlng, 17, { duration: 1 });
    
    setTimeout(() => {
        focusMarker.bindPopup(createStopPopup(stop, routeName, fcCode, index), {
            minWidth: 640,
            maxWidth: 640,
            className: 'comparison-popup'
        }).openPopup();
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

    if (center && isWithinKorea(center.lat, center.lng)) {
        bounds.extend([center.lat, center.lng]);
    }

    stops.forEach((stop, index) => {
        if (!isWithinKorea(stop.Latitude, stop.Longitude)) return;

        const latlng = [stop.Latitude, stop.Longitude];
        path.push(latlng);
        bounds.extend(latlng);

        const icon = L.divIcon({
            className: 'stop-icon',
            html: `<div class="stop-marker-inner" style="background:${color};">${index + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
        });

        const marker = L.marker(latlng, { icon }).addTo(map).bindPopup(createStopPopup(stop, routeName, fcCode, index), {
            minWidth: 640,
            maxWidth: 640
        });
        currentMarkers.push(marker);

        if (stopListEl) {
            const item = document.createElement('div');
            item.className = 'stop-item';
            item.innerHTML = `
                <div class="stop-number">${index + 1}</div>
                <div class="stop-content">
                    <div class="stop-time">🕐 ${stop.Time}</div>
                    <div class="stop-name">${stop.Name}</div>
                </div>
            `;
            item.onclick = () => {
                focusStopOnMap(stop, routeName, fcCode, index, color);
            };
            stopListEl.appendChild(item);
        }
    });

    const line = L.polyline(path, {
        color, weight: 4, opacity: 0.7, dashArray: '10, 8'
    }).addTo(map);
    currentPolylines.push(line);

    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [50, 50] });
}

function clearRoute() {
    currentMarkers.forEach(m => map.removeLayer(m));
    currentPolylines.forEach(l => map.removeLayer(l));
    currentMarkers = [];
    currentPolylines = [];
    const details = document.getElementById('route-details');
    if (details) details.style.display = 'none';
}

function showAllCenters() {
    centerMarkers.forEach(m => map.removeLayer(m));
    centerMarkers = [];
    const bounds = L.latLngBounds();

    Object.keys(shuttleData).forEach(fcCode => {
        const center = shuttleData[fcCode].center;
        if (!center || !isWithinKorea(center.lat, center.lng)) return;
        bounds.extend([center.lat, center.lng]);

        const marker = L.marker([center.lat, center.lng]).addTo(map)
            .bindPopup(`<b>${center.name}</b><br>${center.address || ''}`);
        centerMarkers.push(marker);
    });

    if (bounds.isValid() && centerMarkers.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}
