// ===== State =====
let map;
let shuttleData = {};
let currentMarkers = [];
let currentPolylines = [];
let centerMarkers = [];
let myLocationMarker = null;

// Per-route storage for highlight/dim
let routeLayerGroups = []; // { name, color, polyline, markers[], listEl, stopsEl }
let activeRouteIndex = -1;
window.activeFCs = [];
window.compareModeEnabled = false;

// ===== Color Palette for Routes =====
const ROUTE_COLORS = [
    '#4F46E5', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1',
    '#A855F7', '#22D3EE', '#FB923C', '#34D399', '#F43F5E'
];

const ALL_VALUE = '__ALL__';

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    await loadData();
    populateFCs();
    setupEventListeners();
    
    // 첫 화면 버벅임 해소: 맵과 UI가 완전히 그려진 후, 0.5초 뒤에 센터 마커들을 천천히 뿌립니다.
    setTimeout(() => {
        if (window.requestIdleCallback) {
            requestIdleCallback(() => showAllCenters());
        } else {
            showAllCenters();
        }
    }, 500);
});

// ===== Map Initialization =====
function initMap() {
    map = L.map('map', {
        center: [36.5, 127.5],
        zoom: 7,
        zoomControl: false,
        preferCanvas: true // Forces Leaflet to use HTML5 Canvas instead of DOM SVGs!
    });

    // Extremely High Performance Custom Canvas Override
    // Directly injects text rendering into the raw web Canvas to avoid creating any DOM nodes.
    // Handles 50,000 dots with 0 lag.
    if (L.Canvas) {
        const originalUpdateCircle = L.Canvas.prototype._updateCircle;
        L.Canvas.prototype._updateCircle = function (layer) {
            originalUpdateCircle.call(this, layer);
            if (layer.options.text && layer._point && this._ctx) {
                this._ctx.font = '800 10px Pretendard, -apple-system, sans-serif';
                // Sync text opacity with vector opacity
                const opacity = layer.options.fillOpacity !== undefined ? layer.options.fillOpacity : 1;
                this._ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                this._ctx.textAlign = 'center';
                this._ctx.textBaseline = 'middle';
                this._ctx.fillText(layer.options.text, layer._point.x, layer._point.y + 0.5);
            }
        };
    }

    // 한국 건물 정보가 잘 보이는 브이월드(Vworld) 지도 사용 (일반 지도)
    L.tileLayer('https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://map.vworld.kr/">Vworld</a>',
        maxZoom: 19
    }).addTo(map);

    // (참고) 다른 지도 옵션
    // 오픈스트리트맵 (표준)
    // L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    //     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    // }).addTo(map);

    // 구글 지도 (일반)
    // L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    //     attribution: '&copy; Google Maps'
    // }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
}

// ===== Load Data =====
async function loadData() {
    try {
        const response = await fetch('./data/shuttle_data.json');
        shuttleData = await response.json();
        document.getElementById('subtitle').textContent =
            `전국 ${Object.keys(shuttleData).length}개 물류센터 셔틀버스 노선 안내`;
    } catch (error) {
        console.error('Failed to load shuttle data:', error);
    }
}

// Helper: Pad numbers in string with zeroes to enable natural sorting (e.g., '인천5센터' -> '인천005센터')
function getSortName(name) {
    if (!name) return '';
    return name.replace(/\d+/g, match => match.padStart(3, '0'));
}

// ===== Populate FC Select =====
function populateFCs() {
    const fcSelect = document.getElementById('fc-select');

    // Sort alphabetically by actual Korean center name instead of raw FC Code, with natural number sorting
    const sortedFCs = Object.keys(shuttleData).sort((a, b) => {
        const nameA = getSortName(shuttleData[a].center?.name || a);
        const nameB = getSortName(shuttleData[b].center?.name || b);
        return nameA.localeCompare(nameB, 'ko-KR');
    });

    sortedFCs.forEach(fc => {
        const option = document.createElement('option');
        option.value = fc;
        const centerName = shuttleData[fc].center?.name || fc;
        option.textContent = `${centerName} [${fc}]`;
        option.dataset.searchText = `${fc} ${centerName}`.toLowerCase();
        fcSelect.appendChild(option);
    });
}

// ===== Event Listeners =====
function setupEventListeners() {
    const fcSelect = document.getElementById('fc-select');
    const shiftSelect = document.getElementById('shift-select');
    const routeSelect = document.getElementById('route-select');
    const btnRecenter = document.getElementById('btn-recenter');
    const btnOverview = document.getElementById('btn-overview');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const fcSearch = document.getElementById('fc-search');
    const searchResults = document.getElementById('search-results');

    // Build search index once, sorted alphabetically by Korean name with natural number sorting
    const searchIndex = Object.keys(shuttleData).map(fc => ({
        code: fc,
        name: shuttleData[fc].center?.name || fc,
        searchText: `${fc} ${shuttleData[fc].center?.name || ''}`.toLowerCase()
    })).sort((a, b) => {
        const nameA = getSortName(a.name);
        const nameB = getSortName(b.name);
        return nameA.localeCompare(nameB, 'ko-KR');
    });



    const compareToggleBtn = document.getElementById('compare-toggle-btn');
    const adModal = document.getElementById('ad-modal');
    const adCloseBtn = document.getElementById('ad-close-btn');
    const adCountdown = document.getElementById('ad-countdown');
    let adWaitTimer = null;

    compareToggleBtn.addEventListener('click', () => {
        // 이미 켜져있는 경우 -> 바로 끕니다
        if (window.compareModeEnabled) {
            window.compareModeEnabled = false;
            compareToggleBtn.classList.remove('active');
            compareToggleBtn.innerHTML = `
                <svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                다중 비교 켜기
            `;
            // 다중 비교 모드를 끌 때, 여러개가 선택되어 있었다면 가장 마지막 것 하나만 남깁니다.
            if (window.activeFCs.length > 1) {
                window.activeFCs = [window.activeFCs[window.activeFCs.length - 1]];
                updateFCSelection();
            }
            return;
        }

        // 다중 비교를 켜려고 하는 경우 -> 광고 팝업 띄우기
        if (adModal) {
            showAdPopup();
        } else {
            // 모달이 주석처리 등으로 없는 경우 그냥 켭니다 (개발 편의성)
            window.compareModeEnabled = true;
            compareToggleBtn.classList.add('active');
            compareToggleBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                다중 비교 켜짐
            `;
        }
    });

    const SHUTTLE_TIPS = [
        "쿠팡 셔틀 앱(Hello)을 미리 설치하시면 탑승권 발권이 훨씬 빨라집니다.",
        "셔틀버스는 정해진 시간보다 5분 일찍 도착해 대기하는 것이 가장 안전합니다.",
        "야간조 퇴근 셔틀은 근무 종료 후 약 20~30분 뒤에 출발하니 서둘러 준비하세요.",
        "탑승 전 본인의 노선 번호와 목적지 센터 이름을 버스 앞 유리에서 꼭 확인하세요.",
        "물류센터 내 보안을 위해 셔틀 내부에서의 사진 촬영은 금지되어 있습니다.",
        "겨울철이나 여름철에는 센터 내 온도가 외부와 다를 수 있으니 여벌 옷을 챙기세요.",
        "신분증을 지참하지 않으면 셔틀 탑승이나 센터 출입이 거절될 수 있습니다.",
        "노선별로 경유지가 다를 수 있으니, 본인이 내릴 정류장 이름을 잘 기억해두세요."
    ];

    function showAdPopup() {
        adModal.style.display = 'flex';
        // 애니메이션을 위해 아주 짧은 딜레이 후 show 클래스 추가
        setTimeout(() => adModal.classList.add('show'), 10);

        // 랜덤 팁 설정
        const randomTip = SHUTTLE_TIPS[Math.floor(Math.random() * SHUTTLE_TIPS.length)];
        document.getElementById('ad-tip-content').textContent = randomTip;

        // 구글 애드센스 등 로드 트리거
        try {
            (adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
            console.log("AdSense load error or ad blocker enabled", e);
        }

        // 닫기 버튼 초기화 및 타이머 카운트다운
        adCloseBtn.disabled = true;
        let secondsLeft = 5;
        adCountdown.textContent = secondsLeft;

        adWaitTimer = setInterval(() => {
            secondsLeft--;
            adCountdown.textContent = secondsLeft;
            if (secondsLeft <= 0) {
                clearInterval(adWaitTimer);
                adCountdown.textContent = '✕';
                adCloseBtn.disabled = false;
            }
        }, 1000);
    }

    adCloseBtn.addEventListener('click', () => {
        // 팝업 닫기
        adModal.classList.remove('show');
        setTimeout(() => {
            adModal.style.display = 'none';
        }, 300);

        // 끄고 나면 보상(다중 비교 기능) 활성화!
        window.compareModeEnabled = true;
        compareToggleBtn.classList.remove('disabled');
        compareToggleBtn.classList.add('active');
        compareToggleBtn.innerHTML = `
            <svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 11V7a5 5 0 0 1 9.9-1"></path><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect></svg>
            다중 비교 켜짐
        `;
    });

    function updateFCSelection() {
        const chipsContainer = document.getElementById('selection-chips');
        chipsContainer.innerHTML = '';

        window.activeFCs.forEach(fc => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.innerHTML = `<span>${fc}</span><div class="chip-close">&times;</div>`;
            chip.querySelector('.chip-close').onclick = () => {
                window.activeFCs = window.activeFCs.filter(c => c !== fc);
                updateFCSelection();
            };
            chipsContainer.appendChild(chip);
        });

        if (window.activeFCs.length > 1) {
            const clearBtn = document.createElement('div');
            clearBtn.className = 'chip';
            clearBtn.style.background = 'var(--bg-card)';
            clearBtn.style.borderColor = '#EF4444';
            clearBtn.style.color = '#EF4444';
            clearBtn.style.cursor = 'pointer';
            clearBtn.innerHTML = `<span>🔄 초기화</span>`;
            clearBtn.onclick = () => {
                window.activeFCs = [];
                updateFCSelection();
            };
            chipsContainer.prepend(clearBtn);
        }

        clearAll();
        shiftSelect.innerHTML = '<option value="">근무조를 선택하세요</option>';
        routeSelect.innerHTML = '<option value="">노선을 선택하세요</option>';
        routeSelect.disabled = true;
        hideCenterInfo();
        updateMiniInfo();

        if (window.activeFCs.length === 0) {
            shiftSelect.disabled = true;
            showAllCenters();
            return;
        }

        shiftSelect.disabled = false;
        const allShifts = new Set();
        window.activeFCs.forEach(fc => {
            if (shuttleData[fc]?.shifts) {
                Object.keys(shuttleData[fc].shifts).forEach(s => allShifts.add(s));
            }
        });

        const allShiftOpt = document.createElement('option');
        allShiftOpt.value = ALL_VALUE;
        allShiftOpt.textContent = '⭐ 전체 근무조';
        shiftSelect.appendChild(allShiftOpt);

        Array.from(allShifts).sort().forEach(shift => {
            const option = document.createElement('option');
            option.value = shift;
            option.textContent = shift;
            shiftSelect.appendChild(option);
        });

        if (window.activeFCs.length === 1) {
            const fcCode = window.activeFCs[0];
            const center = shuttleData[fcCode].center;
            if (center) {
                mapFlyTo([center.lat, center.lng], 12, { duration: 1.2 });
                addCenterMarker(fcCode, center);
            }
        } else {
            const bounds = L.latLngBounds();
            window.activeFCs.forEach(fcCode => {
                const center = shuttleData[fcCode]?.center;
                if (center) {
                    bounds.extend([center.lat, center.lng]);
                    addCenterMarker(fcCode, center);
                }
            });
            mapFlyToBounds(bounds, { padding: [60, 60], duration: 1.2 });
        }

        // Always show center info for the most recently selected center
        if (window.activeFCs.length > 0) {
            const lastFcCode = window.activeFCs[window.activeFCs.length - 1];
            const lastCenter = shuttleData[lastFcCode]?.center;
            if (lastCenter) {
                showCenterInfo(lastFcCode, lastCenter);
            } else {
                hideCenterInfo();
            }
        } else {
            hideCenterInfo();
        }

        // Auto select best state
        shiftSelect.value = ALL_VALUE;
        shiftSelect.dispatchEvent(new Event('change'));
    }

    function showSearchResults(query) {
        searchResults.innerHTML = '';
        if (!query) {
            searchResults.classList.remove('active');
            return;
        }

        const matches = searchIndex.filter(item => item.searchText.includes(query));

        if (matches.length === 0) {
            searchResults.innerHTML = '<div class="search-result-empty">검색 결과가 없습니다</div>';
            searchResults.classList.add('active');
            return;
        }

        matches.forEach(item => {
            const el = document.createElement('div');
            el.className = 'search-result-item';
            el.innerHTML = `
                <span class="search-result-code">${item.code}</span>
                <span class="search-result-name">${item.name}</span>
            `;
            el.addEventListener('click', () => {
                if (window.compareModeEnabled) {
                    if (!window.activeFCs.includes(item.code)) {
                        window.activeFCs.push(item.code);
                        updateFCSelection();
                    }
                } else {
                    window.activeFCs = [item.code];
                    updateFCSelection();
                }
                fcSearch.value = '';
                searchResults.classList.remove('active');
            });
            searchResults.appendChild(el);
        });
        searchResults.classList.add('active');
    }

    fcSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        showSearchResults(query);
    });

    fcSearch.addEventListener('focus', () => {
        const query = fcSearch.value.toLowerCase().trim();
        if (query) showSearchResults(query);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box')) {
            searchResults.classList.remove('active');
        }
    });

    fcSelect.addEventListener('change', () => {
        const fcCode = fcSelect.value;
        if (!fcCode) return;

        if (window.compareModeEnabled) {
            if (!window.activeFCs.includes(fcCode)) {
                window.activeFCs.push(fcCode);
                updateFCSelection();
            }
        } else {
            window.activeFCs = [fcCode];
            updateFCSelection();
        }

        // Reset the select dropdown to prompt next selection
        fcSelect.value = '';
    });

    shiftSelect.addEventListener('change', () => {
        const shift = shiftSelect.value;
        routeSelect.innerHTML = '<option value="">노선을 선택하세요</option>';
        clearRoute();

        if (shift === ALL_VALUE) {
            routeSelect.disabled = true;
            showMultiRoute(window.activeFCs, null);
            return;
        }

        if (shift) {
            routeSelect.disabled = false;
            const allRouteOpt = document.createElement('option');
            allRouteOpt.value = ALL_VALUE;
            allRouteOpt.textContent = '⭐ 전체 노선';
            routeSelect.appendChild(allRouteOpt);

            window.activeFCs.forEach(fc => {
                if (shuttleData[fc]?.shifts[shift]) {
                    Object.keys(shuttleData[fc].shifts[shift]).forEach(route => {
                        const option = document.createElement('option');
                        option.value = `${fc}::${route}`;
                        option.textContent = window.activeFCs.length > 1 ? `[${fc}] ${route}` : route;
                        routeSelect.appendChild(option);
                    });
                }
            });

            routeSelect.value = ALL_VALUE;
            showMultiRoute(window.activeFCs, shift);
        } else {
            routeSelect.disabled = true;
        }
    });

    routeSelect.addEventListener('change', () => {
        const shift = shiftSelect.value;
        const routeVal = routeSelect.value;
        clearRoute();

        if (routeVal === ALL_VALUE) {
            showMultiRoute(window.activeFCs, shift);
            return;
        }

        if (routeVal) {
            const [fcCode, route] = routeVal.split('::');
            const stops = shuttleData[fcCode].shifts[shift][route];
            const center = shuttleData[fcCode].center;
            // Draw route with a specific color
            renderSingleRoute(stops, center, route, '#4F46E5', fcCode);
        }
    });

    btnRecenter.addEventListener('click', () => {
        if (!window.activeFCs || window.activeFCs.length === 0) {
            mapFlyTo([36.5, 127.5], 7, { duration: 1 });
        } else if (window.activeFCs.length === 1) {
            const c = shuttleData[window.activeFCs[0]]?.center;
            if (c) mapFlyTo([c.lat, c.lng], 13, { duration: 0.8 });
        } else {
            const bounds = L.latLngBounds();
            window.activeFCs.forEach(fc => {
                const c = shuttleData[fc]?.center;
                if (c) bounds.extend([c.lat, c.lng]);
            });
            mapFlyToBounds(bounds, { padding: [60, 60], duration: 0.8 });
        }
    });

    btnOverview.addEventListener('click', () => mapFlyTo([36.5, 127.5], 7, { duration: 1 }));

    // Sidebar toggle — different behavior on mobile vs desktop
    sidebarToggle.addEventListener('click', () => {
        if (isMobile()) {
            if (sidebar.classList.contains('minimized')) {
                sidebar.classList.remove('minimized');
            } else {
                sidebar.classList.add('minimized');
                sidebar.classList.remove('expanded');
            }
        } else {
            sidebar.classList.toggle('collapsed');
        }
    });

    // My Location
    document.getElementById('btn-mylocation').addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert('이 브라우저에서는 위치 서비스를 지원하지 않습니다.');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords;
                if (myLocationMarker) map.removeLayer(myLocationMarker);
                const icon = L.divIcon({
                    className: 'my-location-icon',
                    html: '<div class="my-location-dot"><div class="my-location-pulse"></div></div>',
                    iconSize: [20, 20], iconAnchor: [10, 10]
                });
                myLocationMarker = L.marker([lat, lng], { icon, zIndexOffset: 2000 })
                    .addTo(map)
                    .bindPopup('<div class="popup-title">📍 내 현재 위치</div>')
                    .openPopup();
                mapFlyTo([lat, lng], 15, { duration: 1 });
            },
            (err) => {
                alert('위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // ===== Mobile Bottom Sheet Drag =====
    setupMobileBottomSheet();
}

function isMobile() {
    return window.innerWidth <= 768;
}

// Helper: fly to a point, offsetting for the bottom sheet on mobile
function mapFlyTo(latlng, zoom, options = {}) {
    const targetZoom = zoom || map.getZoom();
    if (isMobile()) {
        const sheetPx = window.innerHeight * 0.333; // bottom sheet = 33.3vh (1/3)
        const point = map.project(L.latLng(latlng[0] || latlng.lat, latlng[1] || latlng.lng), targetZoom);
        point.y += sheetPx / 2; // shift center down so target appears in visible area
        const adjusted = map.unproject(point, targetZoom);
        map.flyTo(adjusted, targetZoom, options);
    } else {
        map.flyTo(latlng, targetZoom, options);
    }
}

// Helper: fit bounds with bottom sheet padding on mobile
function mapFlyToBounds(bounds, options = {}) {
    if (isMobile()) {
        const sheetPx = window.innerHeight * 0.333;
        const padding = options.padding || [60, 60];
        map.flyToBounds(bounds, {
            ...options,
            paddingTopLeft: [padding[0], padding[1]],
            paddingBottomRight: [padding[0], sheetPx + padding[1]]
        });
    } else {
        map.flyToBounds(bounds, options);
    }
}

function minimizeMobileSheet() {
    if (!isMobile()) return;
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('minimized');
    sidebar.classList.remove('expanded');
    sidebar.classList.remove('collapsed');
    updateMiniInfo();
}

function updateMiniInfo() {
    const miniInfo = document.getElementById('mini-info');
    if (!miniInfo) return;

    if (window.activeFCs && window.activeFCs.length > 0) {
        if (window.activeFCs.length > 1) {
            miniInfo.textContent = `🚌 ${window.activeFCs.length}개 센터 비교 중 — 탭하여 열기`;
        } else {
            const fcCode = window.activeFCs[0];
            const name = shuttleData[fcCode]?.center?.name || fcCode;
            miniInfo.textContent = `🚌 ${fcCode} ${name} — 탭하여 열기`;
        }
    } else {
        miniInfo.textContent = '위로 밀어 올려 센터를 선택하세요';
    }
}

function setupMobileBottomSheet() {
    const sidebar = document.getElementById('sidebar');
    const dragHandle = document.getElementById('drag-handle');
    let startY = 0;
    let isDragging = false;

    function onStart(e) {
        if (!isMobile()) return;
        isDragging = true;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
    }

    function onEnd(e) {
        if (!isDragging || !isMobile()) return;
        isDragging = false;
        const endY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
        const diff = endY - startY;

        if (diff > 40) {
            // Swipe down → minimize
            sidebar.classList.add('minimized');
            sidebar.classList.remove('expanded');
        } else if (diff < -40) {
            // Swipe up → peek (50vh)
            sidebar.classList.remove('minimized');
            sidebar.classList.remove('collapsed');
        }
    }

    dragHandle.addEventListener('touchstart', onStart, { passive: true });
    dragHandle.addEventListener('mousedown', onStart);
    dragHandle.addEventListener('touchend', onEnd);
    dragHandle.addEventListener('mouseup', onEnd);

    // Tap on drag handle toggles: minimized ↔ peek
    dragHandle.addEventListener('click', () => {
        if (!isMobile()) return;
        if (sidebar.classList.contains('minimized') || sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('minimized');
            sidebar.classList.remove('collapsed');
        } else {
            sidebar.classList.add('minimized');
        }
    });
}

// ===== Show ALL Centers =====
function showAllCenters() {
    clearAll();
    const bounds = L.latLngBounds();
    let count = 0;

    Object.keys(shuttleData).forEach(fcCode => {
        const fc = shuttleData[fcCode];
        if (!fc.center) return;
        const { lat, lng, name, address } = fc.center;
        bounds.extend([lat, lng]);

        const totalStops = Object.values(fc.shifts).flatMap(s => Object.values(s)).flat().length;
        const shiftCount = Object.keys(fc.shifts).length;
        const routeCount = Object.values(fc.shifts).reduce((s, v) => s + Object.keys(v).length, 0);

        const icon = L.divIcon({
            className: 'center-icon',
            html: '<div class="center-marker-inner"></div>',
            iconSize: [24, 24], iconAnchor: [12, 12]
        });

        const infoHtml = `
            <div class="popup-title">📍 ${name}</div>
            <div class="popup-addr">${address}</div>
            <div class="popup-addr" style="margin-top:6px;color:#818CF8;">${shiftCount}개 근무조 · ${routeCount}개 노선 · ${totalStops}개 정류장</div>
        `;

        const marker = L.marker([lat, lng], { icon }).addTo(map)
            .bindPopup(infoHtml)
            .bindTooltip(infoHtml, { direction: 'top', offset: [0, -10], opacity: 0.9 })
            .on('click', () => {
                window.activeFCs = [];
                const fcSelect = document.getElementById('fc-select');
                if (fcSelect) {
                    fcSelect.value = fcCode;
                    fcSelect.dispatchEvent(new Event('change'));
                }
            });

        centerMarkers.push(marker);
        count++;
    });

    mapFlyToBounds(bounds, { padding: [60, 60], duration: 1.2 });
}

// ===== Show Multi-Route (All Shifts or All Routes) =====
function showMultiRoute(fcCodes, shiftFilter) {
    clearRoute();
    if (!fcCodes || fcCodes.length === 0) return;

    const bounds = L.latLngBounds();
    const stopListEl = document.getElementById('stop-list');
    const routeDetailsEl = document.getElementById('route-details');
    stopListEl.innerHTML = '';
    routeDetailsEl.style.display = 'block';

    routeLayerGroups = [];
    activeRouteIndex = -1;
    let colorIndex = 0;
    let totalStops = 0;
    let allTimes = [];

    fcCodes.forEach(fcCode => {
        const fc = shuttleData[fcCode];
        if (!fc) return;

        if (fc.center) bounds.extend([fc.center.lat, fc.center.lng]);

        const shiftsToShow = shiftFilter && fc.shifts[shiftFilter]
            ? { [shiftFilter]: fc.shifts[shiftFilter] }
            : fc.shifts;

        if (Object.keys(shiftsToShow).length === 0) return;

        // If comparing multiple FCs, add a center separator
        if (fcCodes.length > 1) {
            const fcHeader = document.createElement('div');
            fcHeader.className = 'list-section-header';
            fcHeader.style.background = 'rgba(79, 70, 229, 0.15)';
            fcHeader.style.color = 'var(--primary)';
            fcHeader.style.fontWeight = '800';
            fcHeader.style.marginTop = '16px';
            fcHeader.innerHTML = `<span class="section-icon">🏢</span> [${fcCode}] ${fc.center?.name || ''}`;
            stopListEl.appendChild(fcHeader);
        }

        Object.entries(shiftsToShow).forEach(([shiftName, routes]) => {
            // Shift header
            if (!shiftFilter) {
                const shiftHeader = document.createElement('div');
                shiftHeader.className = 'list-section-header';
                shiftHeader.innerHTML = `<span class="section-icon">🕐</span> ${shiftName} <span class="section-badge">${Object.keys(routes).length}개 노선</span>`;
                stopListEl.appendChild(shiftHeader);
            }

            Object.entries(routes).forEach(([routeName, stops]) => {
                const color = ROUTE_COLORS[colorIndex % ROUTE_COLORS.length];
                const routeIdx = routeLayerGroups.length;
                colorIndex++;
                totalStops += stops.length;
                stops.forEach(s => { if (s.Time) allTimes.push(s.Time); });

                // Draw polyline
                const path = stops.map(s => [s.Latitude, s.Longitude]);
                path.forEach(p => bounds.extend(p));

                const polyline = L.polyline(path, {
                    color, weight: 3, opacity: 0.6, dashArray: '10, 6'
                }).addTo(map);

                // We use natively extended Canvas circleMarker for maximum performance
                // Text is rendered directly onto the GPU canvas via our custom L.Canvas override above
                const dotMarkers = stops.map((stop, idx) => {
                    return L.circleMarker([stop.Latitude, stop.Longitude], {
                        radius: 7,
                        fillColor: color,
                        fillOpacity: 1,
                        color: '#ffffff',
                        weight: 1.5,
                        text: String(idx + 1)
                    }).addTo(map)
                        .bindPopup(`
                        <div class="popup-route">🚌 ${fcCodes.length > 1 ? `[${fcCode}] ` : ''}${routeName}</div>
                        <div class="popup-time">🕐 ${stop.Time} · ${shiftName}</div>
                        <div class="popup-title">${stop.Name}</div>
                        <div class="popup-addr">${stop.Address}</div>
                    `);
                });

                // Route header in sidebar (collapsible)
                const routeContainer = document.createElement('div');
                routeContainer.className = 'route-group';

                const routeHeader = document.createElement('div');
                routeHeader.className = 'route-header';
                routeHeader.dataset.routeIdx = routeIdx;
                routeHeader.innerHTML = `
                    <div class="route-color-bar" style="background:${color};"></div>
                    <div class="route-header-content">
                        <div class="route-header-title">🚌 ${routeName}</div>
                        <div class="route-header-meta">${stops.length}개 정류장 · ${stops[0]?.Time || ''} ~ ${stops[stops.length - 1]?.Time || ''}</div>
                    </div>
                    <div class="route-expand-icon">▼</div>
                `;

                // Stops container (hidden by default, LAZY RENDERED for performance)
                const stopsContainer = document.createElement('div');
                stopsContainer.className = 'route-stops-container collapsed';
                stopsContainer.dataset.rendered = "false"; // flag for lazy loading

                routeContainer.appendChild(routeHeader);
                routeContainer.appendChild(stopsContainer);
                stopListEl.appendChild(routeContainer);

                // Store route group data
                routeLayerGroups.push({
                    fcCode: fcCode,
                    center: fc.center,
                    name: routeName,
                    color,
                    polyline,
                    dotMarkers,
                    stops,
                    shiftName,
                    routeHeader,
                    stopsContainer,
                    numberedMarkers: [] // created on highlight
                });

                // Click handler for route header
                routeHeader.addEventListener('click', () => {
                    toggleRouteHighlight(routeIdx);
                });

                // Track for cleanup
                currentPolylines.push(polyline);
                currentMarkers.push(...dotMarkers);
            });
        });
    });

    allTimes.sort();
    if (bounds.isValid()) mapFlyToBounds(bounds, { padding: [60, 60], duration: 1 });
}

// ===== Toggle Route Highlight =====
function toggleRouteHighlight(routeIdx) {
    const isDeselecting = activeRouteIndex === routeIdx;

    // Reset all routes
    routeLayerGroups.forEach((rg, i) => {
        // Reset polyline
        rg.polyline.setStyle({
            opacity: isDeselecting ? 0.6 : 0.12,
            weight: isDeselecting ? 3 : 2
        });

        // Reset dot markers opacity
        rg.dotMarkers.forEach(m => {
            m.setStyle({
                fillOpacity: isDeselecting ? 1 : 0.2,
                opacity: isDeselecting ? 1 : 0.2
            });
        });

        // Remove numbered markers
        rg.numberedMarkers.forEach(m => map.removeLayer(m));
        rg.numberedMarkers = [];

        // Reset header style
        rg.routeHeader.classList.remove('active');

        // Collapse stops
        rg.stopsContainer.classList.add('collapsed');
        rg.routeHeader.querySelector('.route-expand-icon').textContent = '▼';
    });

    if (isDeselecting) {
        activeRouteIndex = -1;
        return;
    }

    // Highlight selected route
    activeRouteIndex = routeIdx;
    const rg = routeLayerGroups[routeIdx];

    // Highlight polyline
    rg.polyline.setStyle({ opacity: 0.9, weight: 5 });
    rg.polyline.bringToFront();

    // Show dot markers fully
    rg.dotMarkers.forEach(m => {
        m.setStyle({ fillOpacity: 1, opacity: 1 });
    });

    // Add numbered markers
    rg.stops.forEach((stop, idx) => {
        const icon = L.divIcon({
            className: 'stop-icon',
            html: `<div class="stop-marker-inner" style="background:${rg.color};">${idx + 1}</div>`,
            iconSize: [28, 28], iconAnchor: [14, 14]
        });
        const marker = L.marker([stop.Latitude, stop.Longitude], { icon, zIndexOffset: 1000 })
            .addTo(map)
            .bindPopup(`
                <div class="popup-route">🚌 ${rg.name}</div>
                <div class="popup-time">🕐 ${stop.Time} 출발 · ${rg.shiftName}</div>
                <div class="popup-title">${idx + 1}. ${stop.Name}</div>
                <div class="popup-addr">${stop.Address}</div>
            `);
        rg.numberedMarkers.push(marker);
    });

    // Highlight header
    rg.routeHeader.classList.add('active');

    // Lazy render DOM stops if not already rendered
    if (rg.stopsContainer.dataset.rendered === "false") {
        rg.stops.forEach((stop, idx) => {
            const stopEl = document.createElement('div');
            stopEl.className = 'stop-item nested';
            stopEl.innerHTML = `
                <div class="stop-number" style="background:${rg.color};">${idx + 1}</div>
                <div class="stop-content">
                    <div class="stop-time">🕐 ${stop.Time}</div>
                    <div class="stop-name">${stop.Name}</div>
                    <div class="stop-addr">${stop.Address}</div>
                </div>
            `;
            stopEl.addEventListener('click', (e) => {
                e.stopPropagation();
                mapFlyTo([stop.Latitude, stop.Longitude], 16, { duration: 0.6 });
                rg.dotMarkers[idx].openPopup();
            });
            rg.stopsContainer.appendChild(stopEl);
        });
        rg.stopsContainer.dataset.rendered = "true";
    }

    // Expand stops
    rg.stopsContainer.classList.remove('collapsed');
    rg.routeHeader.querySelector('.route-expand-icon').textContent = '▲';

    // Scroll into view
    rg.routeHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Zoom to route bounds
    const path = rg.stops.map(s => [s.Latitude, s.Longitude]);
    const routeBounds = L.latLngBounds(path);
    mapFlyToBounds(routeBounds, { padding: [80, 80], duration: 0.8 });
}

// ===== Render Single Route =====
function renderSingleRoute(stops, center, routeName, color, fcCode) {
    const bounds = L.latLngBounds();
    const path = [];
    const stopListEl = document.getElementById('stop-list');
    const routeDetailsEl = document.getElementById('route-details');
    stopListEl.innerHTML = '';
    routeDetailsEl.style.display = 'block';

    if (center) bounds.extend([center.lat, center.lng]);

    // If multiple FCs, show a header so users know which FC this route is for
    if (window.activeFCs && window.activeFCs.length > 1 && fcCode) {
        const fcHeader = document.createElement('div');
        fcHeader.className = 'list-section-header';
        fcHeader.style.background = 'rgba(79, 70, 229, 0.15)';
        fcHeader.style.color = 'var(--primary)';
        fcHeader.style.fontWeight = '800';
        fcHeader.style.marginTop = '16px';
        fcHeader.innerHTML = `<span class="section-icon">🏢</span> [${fcCode}] 정류장 안내`;
        stopListEl.appendChild(fcHeader);
    }

    stops.forEach((stop, index) => {
        const latlng = [stop.Latitude, stop.Longitude];
        path.push(latlng);
        bounds.extend(latlng);

        const icon = L.divIcon({
            className: 'stop-icon',
            html: `<div class="stop-marker-inner" style="background:${color};">${index + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
        });

        const routePrefix = (window.activeFCs && window.activeFCs.length > 1 && fcCode) ? `[${fcCode}] ` : '';

        const marker = L.marker(latlng, { icon }).addTo(map).bindPopup(`
            <div class="popup-route">🚌 ${routePrefix}${routeName}</div>
            <div class="popup-time">🕐 ${stop.Time} 출발</div>
            <div class="popup-title">${index + 1}. ${stop.Name}</div>
            <div class="popup-addr">${stop.Address}</div>
        `);
        currentMarkers.push(marker);

        const stopItem = document.createElement('div');
        stopItem.className = 'stop-item';
        stopItem.innerHTML = `
            <div class="stop-number">${index + 1}</div>
            <div class="stop-content">
                <div class="stop-time">🕐 ${stop.Time}</div>
                <div class="stop-name">${stop.Name}</div>
                <div class="stop-addr">${stop.Address}</div>
            </div>
        `;
        stopItem.addEventListener('click', () => {
            mapFlyTo(latlng, 16, { duration: 0.6 });
            marker.openPopup();
            document.querySelectorAll('.stop-item').forEach(el => el.classList.remove('active'));
            stopItem.classList.add('active');
        });
        stopListEl.appendChild(stopItem);
    });

    const line = L.polyline(path, {
        color, weight: 4, opacity: 0.7, smoothFactor: 1, dashArray: '12, 8'
    }).addTo(map);
    currentPolylines.push(line);

    if (center && path.length > 0) {
        const connLine = L.polyline([[center.lat, center.lng], path[path.length - 1]], {
            color: '#EF4444', weight: 4, opacity: 0.6, dashArray: '6, 10'
        }).addTo(map);
        currentMarkers.push(connLine);

        // Intentionally no longer drawing the red center marker here
        // It is now permanently drawn via addCenterMarker() when the center is selected
    }

    mapFlyToBounds(bounds, { padding: [60, 60], duration: 1 });
}

// ===== Helpers =====
function addCenterMarker(fcCode, center) {
    const centerIcon = L.divIcon({
        className: 'center-icon highlighted-center',
        html: '<div class="center-marker-inner" style="background-color:#EF4444; border-color:white; box-shadow:0 0 0 3px rgba(239, 68, 68, 0.4);"></div>',
        iconSize: [28, 28], iconAnchor: [14, 14]
    });

    const fc = shuttleData[fcCode];
    let statsHtml = '';
    if (fc && fc.shifts) {
        const totalStops = Object.values(fc.shifts).flatMap(s => Object.values(s)).flat().length;
        const shiftCount = Object.keys(fc.shifts).length;
        const routeCount = Object.values(fc.shifts).reduce((s, v) => s + Object.keys(v).length, 0);
        statsHtml = `<div class="popup-addr" style="margin-top:6px;color:#818CF8;">${shiftCount}개 근무조 · ${routeCount}개 노선 · ${totalStops}개 정류장</div>`;
    }

    const centerMarkerName = center.name || fcCode || '도착 센터';
    const marker = L.marker([center.lat, center.lng], { icon: centerIcon, zIndexOffset: 2000 }).addTo(map)
        .bindTooltip(`🏢 ${centerMarkerName}`, {
            permanent: true,
            direction: 'top',
            className: 'center-label-tooltip',
            offset: [0, -14]
        })
        .bindPopup(`
            <div class="popup-title">📍 ${centerMarkerName}</div>
            <div class="popup-addr">${center.address || ''}</div>
            ${statsHtml}
        `).openPopup();
    centerMarkers.push(marker);
}


function clearRoute() {
    currentMarkers.forEach(m => map.removeLayer(m));
    currentMarkers = [];
    currentPolylines.forEach(l => map.removeLayer(l));
    currentPolylines = [];
    routeLayerGroups.forEach(rg => {
        rg.numberedMarkers.forEach(m => map.removeLayer(m));
    });
    routeLayerGroups = [];
    activeRouteIndex = -1;
    document.getElementById('route-details').style.display = 'none';
}

function clearAll() {
    clearRoute();
    centerMarkers.forEach(m => map.removeLayer(m));
    centerMarkers = [];
}

// ===== Center Info Card =====
function showCenterInfo(fcCode, center) {
    const infoCard = document.getElementById('center-info');
    const nameEl = document.getElementById('center-name');
    const addrEl = document.getElementById('center-addr');
    const shuttleLink = document.getElementById('center-shuttle-link');
    const mapLink = document.getElementById('center-map-link');

    nameEl.textContent = center.name || fcCode;
    addrEl.textContent = center.address || '';

    // Coupang shuttle homepage: https://coufc.coupang.com/{fc_code_lowercase}
    const fcLower = fcCode.toLowerCase();
    shuttleLink.href = `https://coufc.coupang.com/${fcLower}`;

    shuttleLink.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
        홈페이지 이동
    `;

    // Naver Maps search
    mapLink.href = `https://map.naver.com/v5/search/${encodeURIComponent(center.address)}`;

    infoCard.style.display = 'block';
}

function hideCenterInfo() {
    document.getElementById('center-info').style.display = 'none';
}
