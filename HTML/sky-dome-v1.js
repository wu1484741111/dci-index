// sky-dome-v1.js（純瀏覽器版：星空 + 衛星，無需任何伺服器）

const state = {
  lat: 53.5511,
  lon: 9.9937,
  layers: { stars: true, sats: true },
  rotation: 0,        // 使用者拖曳旋轉穹頂的角度（度）
  satRecords: [],      // 已解析的 TLE 衛星記錄
  sun: null,
  moon: null,
};

const SETTINGS_KEY_FALLBACK = {}; // 不使用 localStorage（環境限制），改用記憶體變數

// ============== 天文計算工具 ==============

function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function gmstHours(date) {
  const jd = julianDate(date);
  const T = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) +
             0.000387933 * T * T - (T * T * T) / 38710000.0;
  gmst = gmst % 360;
  if (gmst < 0) gmst += 360;
  return gmst / 15.0;
}

// 赤經(小時)/赤緯(度) -> 地平座標 高度角alt / 方位角az（皆為度）
function raDecToAltAz(raHours, decDeg, latDeg, lonDeg, date) {
  const gmst = gmstHours(date);
  let lst = gmst + lonDeg / 15.0;
  lst = ((lst % 24) + 24) % 24;
  let ha = (lst - raHours) * 15;
  ha = ((ha + 180) % 360 + 360) % 360 - 180;
  const haRad = ha * Math.PI / 180;
  const decRad = decDeg * Math.PI / 180;
  const latRad = latDeg * Math.PI / 180;

  const sinAlt = Math.sin(decRad) * Math.sin(latRad) + Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const alt = altRad * 180 / Math.PI;

  const cosAz = (Math.sin(decRad) - Math.sin(altRad) * Math.sin(latRad)) /
                (Math.cos(altRad) * Math.cos(latRad) + 1e-12);
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
  if (Math.sin(haRad) > 0) az = 360 - az;

  return { alt, az };
}

// 簡化版太陽位置（精度足夠顯示用途，誤差通常 < 0.5 度）
function sunRaDec(date) {
  const jd = julianDate(date);
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  const epsilon = (23.439 - 0.0000004 * n) * Math.PI / 180;

  const raRad = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const decRad = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  let ra = raRad * 12 / Math.PI;
  if (ra < 0) ra += 24;
  const dec = decRad * 180 / Math.PI;
  return { ra, dec };
}

// 簡化版月球位置（精度約 1-2 度，足夠顯示用途）
function moonRaDec(date) {
  const jd = julianDate(date);
  const d = jd - 2451545.0;
  const L = (218.316 + 13.176396 * d) % 360;
  const M = (134.963 + 13.064993 * d) % 360;
  const F = (93.272 + 13.229350 * d) % 360;
  const Lrad = L * Math.PI / 180, Mrad = M * Math.PI / 180, Frad = F * Math.PI / 180;

  const lon = L + 6.289 * Math.sin(Mrad);
  const lat = 5.128 * Math.sin(Frad);
  const lonRad = lon * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const epsilon = 23.439 * Math.PI / 180;

  const raRad = Math.atan2(
    Math.sin(lonRad) * Math.cos(epsilon) - Math.tan(latRad) * Math.sin(epsilon),
    Math.cos(lonRad)
  );
  const decRad = Math.asin(
    Math.sin(latRad) * Math.cos(epsilon) + Math.cos(latRad) * Math.sin(epsilon) * Math.sin(lonRad)
  );
  let ra = raRad * 12 / Math.PI;
  if (ra < 0) ra += 24;
  const dec = decRad * 180 / Math.PI;
  return { ra, dec };
}

function computeSunTimes(lat, lon, date) {
  // 粗略估算日出日落（用簡化太陽方程式逐步搜尋）
  const d0 = new Date(date);
  d0.setHours(0, 0, 0, 0);
  let sunrise = null, sunset = null;
  let prevAlt = null;
  for (let m = 0; m <= 24 * 60; m += 2) {
    const t = new Date(d0.getTime() + m * 60000);
    const { ra, dec } = sunRaDec(t);
    const { alt } = raDecToAltAz(ra, dec, lat, lon, t);
    if (prevAlt !== null) {
      if (prevAlt < 0 && alt >= 0 && !sunrise) sunrise = t;
      if (prevAlt >= 0 && alt < 0 && !sunset) sunset = t;
    }
    prevAlt = alt;
  }
  return { sunrise, sunset };
}

function fmtTime(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

// ============== 地理位置 ==============

function initLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        updateLocDisplay();
        refreshSatellites();
      },
      () => { updateLocDisplay(); },
      { timeout: 6000 }
    );
  }
  updateLocDisplay();
}

function updateLocDisplay() {
  document.getElementById("locCoord").textContent =
    `${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`;
}

// ============== 衛星（CelesTrak TLE + satellite.js） ==============

const SAT_GROUPS = [
  { name: "stations", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle" },
  { name: "active", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle" },
];
// 註：active 群組筆數龐大，正式使用時只取前 N 顆做效能控制

async function loadSatelliteCatalog() {
  setDot("satDot", "pending");
  try {
    const res = await fetch(SAT_GROUPS[0].url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split("\n").map(l => l.replace(/\r/, ""));
    const records = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i].trim();
      const l1 = lines[i + 1];
      const l2 = lines[i + 2];
      if (!name || !l1 || !l2 || !l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
      try {
        const satrec = satellite.twoline2satrec(l1, l2);
        records.push({ name, satrec });
      } catch (e) { /* 略過解析失敗的單顆 */ }
    }
    state.satRecords = records;
    setDot("satDot", "ok");
    document.getElementById("satCount").textContent = `衛星 ${records.length} 顆目錄`;
  } catch (e) {
    setDot("satDot", "err");
    document.getElementById("satCount").textContent = "衛星 載入失敗";
    console.error("衛星目錄載入失敗：", e);
  }
}

function computeVisibleSatellites(date) {
  if (!state.satRecords.length) return [];
  const gmst = satellite.gstime(date);
  const observerGd = {
    longitude: satellite.degreesToRadians(state.lon),
    latitude: satellite.degreesToRadians(state.lat),
    height: 0.05,
  };

  const visible = [];
  for (const rec of state.satRecords) {
    try {
      const pv = satellite.propagate(rec.satrec, date);
      if (!pv.position) continue;
      const gdPos = satellite.eciToGeodetic(pv.position, gmst);
      const lookAngles = satellite.ecfToLookAngles(observerGd, satellite.eciToEcf(pv.position, gmst));
      const altDeg = satellite.radiansToDegrees(lookAngles.elevation);
      const azDeg = satellite.radiansToDegrees(lookAngles.azimuth);
      if (altDeg > 0) {
        visible.push({ name: rec.name, alt: altDeg, az: azDeg, heightKm: gdPos.height });
      }
    } catch (e) { /* 略過單顆計算錯誤，避免中斷整批渲染 */ }
  }
  return visible;
}

function refreshSatellites() {
  if (!state.satRecords.length) loadSatelliteCatalog();
}

// ============== Canvas 穹頂投影渲染 ==============

const canvas = document.getElementById("domeCanvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, cx = 0, cy = 0, domeR = 0;

function resizeCanvas() {
  W = canvas.width = window.innerWidth * devicePixelRatio;
  H = canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  cx = W / 2;
  cy = H / 2;
  domeR = Math.min(W, H) * 0.46;
}
window.addEventListener("resize", resizeCanvas);

// 把 alt/az 投影到畫面座標（azimuthal equidistant，從正上方往下看的穹頂圖）
// alt=90（正頭頂）-> 圓心；alt=0（地平線）-> 圓周
// 回傳值為 canvas 實際像素座標（已含 devicePixelRatio），所有繪圖函式統一用這套座標
function projectToScreen(altDeg, azDeg) {
  const altClamped = Math.max(0, altDeg);
  const r = domeR * (1 - altClamped / 90);
  const azRad = (azDeg + state.rotation) * Math.PI / 180;
  // 方位角：北=0 在畫面上方，順時針增加（東在右）
  const x = cx + r * Math.sin(azRad);
  const y = cy - r * Math.cos(azRad);
  return { x, y, r };
}

function clearAndDrawHorizon() {
  ctx.clearRect(0, 0, W, H);

  // 背景輻射感（天頂偏深藍，地平線偏暗）
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, domeR * 1.05);
  grad.addColorStop(0, "rgba(10,18,40,0)");
  grad.addColorStop(1, "rgba(2,4,10,0.4)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, domeR * 1.05, 0, Math.PI * 2);
  ctx.fill();

  // 地平線圈
  ctx.strokeStyle = "rgba(120,150,200,0.35)";
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath();
  ctx.arc(cx, cy, domeR, 0, Math.PI * 2);
  ctx.stroke();

  // 方位刻度（N/E/S/W）
  const dirs = [["北", 0], ["東", 90], ["南", 180], ["西", 270]];
  ctx.font = `${13 * devicePixelRatio}px sans-serif`;
  ctx.fillStyle = "rgba(160,180,220,0.6)";
  ctx.textAlign = "center";
  for (const [label, az] of dirs) {
    const azRad = (az + state.rotation) * Math.PI / 180;
    const lx = cx + (domeR + 18 * devicePixelRatio) * Math.sin(azRad);
    const ly = cy - (domeR + 18 * devicePixelRatio) * Math.cos(azRad);
    ctx.fillText(label, lx, ly);
  }

  // 高度角輔助圈（30度、60度）
  ctx.strokeStyle = "rgba(100,130,180,0.15)";
  ctx.lineWidth = 1 * devicePixelRatio;
  for (const alt of [30, 60]) {
    const r = domeR * (1 - alt / 90);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function starColorByMag(mag) {
  const brightness = Math.max(0.35, Math.min(1, 1 - (mag + 1.5) / 6));
  return `rgba(253,246,227,${brightness.toFixed(2)})`;
}

function drawStars(now) {
  if (!state.layers.stars) return;

  // 太陽 / 月亮
  const sun = sunRaDec(now);
  const sunPos = raDecToAltAz(sun.ra, sun.dec, state.lat, state.lon, now);
  const moon = moonRaDec(now);
  const moonPos = raDecToAltAz(moon.ra, moon.dec, state.lat, state.lon, now);

  const isNight = sunPos.alt < -6;
  const starAlpha = isNight ? 1 : Math.max(0.08, 1 - (sunPos.alt + 6) / 30);

  // 星座連線
  ctx.save();
  ctx.globalAlpha = starAlpha * 0.5;
  ctx.strokeStyle = "rgba(120,160,220,0.5)";
  ctx.lineWidth = 1 * devicePixelRatio;
  for (const key in CONSTELLATION_LINES) {
    const names = CONSTELLATION_LINES[key];
    ctx.beginPath();
    let started = false;
    for (const name of names) {
      const star = BRIGHT_STARS.find(s => s[0] === name);
      if (!star) continue;
      const pos = raDecToAltAz(star[1], star[2], state.lat, state.lon, now);
      if (pos.alt < -2) { started = false; continue; }
      const { x, y } = projectToScreen(pos.alt, pos.az);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 星點
  ctx.save();
  ctx.globalAlpha = starAlpha;
  for (const [name, ra, dec, mag] of BRIGHT_STARS) {
    const pos = raDecToAltAz(ra, dec, state.lat, state.lon, now);
    if (pos.alt < 0) continue;
    const { x, y } = projectToScreen(pos.alt, pos.az);
    const size = Math.max(1, (3 - mag) * 0.9) * devicePixelRatio;
    ctx.fillStyle = starColorByMag(mag);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 太陽
  if (sunPos.alt > -2) {
    const { x, y } = projectToScreen(sunPos.alt, sunPos.az);
    ctx.save();
    ctx.fillStyle = "#ffd56b";
    ctx.shadowColor = "#ffd56b";
    ctx.shadowBlur = 20 * devicePixelRatio;
    ctx.beginPath();
    ctx.arc(x, y, 9 * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 月亮
  if (moonPos.alt > 0) {
    const { x, y } = projectToScreen(moonPos.alt, moonPos.az);
    ctx.save();
    ctx.fillStyle = "#cfd8e3";
    ctx.shadowColor = "#cfd8e3";
    ctx.shadowBlur = 10 * devicePixelRatio;
    ctx.beginPath();
    ctx.arc(x, y, 7 * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawSatellites(now) {
  if (!state.layers.sats) return;
  const visibleSats = computeVisibleSatellites(now);
  ctx.save();
  for (const sat of visibleSats) {
    const { x, y } = projectToScreen(sat.alt, sat.az);
    ctx.fillStyle = "#5ee6ff";
    ctx.shadowColor = "#5ee6ff";
    ctx.shadowBlur = 6 * devicePixelRatio;
    ctx.beginPath();
    ctx.arc(x, y, 2.5 * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (visibleSats.length < 25) {
      ctx.font = `${10 * devicePixelRatio}px sans-serif`;
      ctx.fillStyle = "rgba(150,230,255,0.85)";
      ctx.textAlign = "left";
      ctx.fillText(sat.name, x + 6 * devicePixelRatio, y - 4 * devicePixelRatio);
    }
  }
  ctx.restore();
  if (visibleSats.length) {
    document.getElementById("satCount").textContent = `衛星 ${visibleSats.length} 顆可見`;
  }
}

function render() {
  resizeIfNeeded();
  const now = new Date();
  clearAndDrawHorizon();
  drawStars(now);
  drawSatellites(now);

  document.getElementById("locTime").textContent =
    now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  requestAnimationFrame(render);
}

let lastW = 0, lastH = 0;
function resizeIfNeeded() {
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
    resizeCanvas();
    lastW = window.innerWidth;
    lastH = window.innerHeight;
  }
}

// ============== 拖曳旋轉穹頂 ==============

let dragging = false, lastX = 0;
canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; });
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  state.rotation = (state.rotation + dx * 0.4) % 360;
});

// ============== UI 互動 ==============

function setDot(id, statusClass) {
  const el = document.getElementById(id);
  if (el) el.className = `dot ${statusClass}`;
}

function setupToggles() {
  document.querySelectorAll(".toggleBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const layer = btn.dataset.layer;
      state.layers[layer] = !state.layers[layer];
      btn.classList.toggle("off", !state.layers[layer]);
    });
  });
}

function setupSettingsModal() {
  const modal = document.getElementById("settingsModal");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("inputCoord").value = `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`;
    modal.classList.add("show");
  });
  document.getElementById("closeSettingsBtn").addEventListener("click", () => {
    modal.classList.remove("show");
  });
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    const coordStr = document.getElementById("inputCoord").value.trim();
    const parts = coordStr.split(",").map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      state.lat = parts[0];
      state.lon = parts[1];
    }

    updateLocDisplay();
    modal.classList.remove("show");
    refreshSatellites();
  });
}

function updateSunTimesDisplay() {
  const { sunrise, sunset } = computeSunTimes(state.lat, state.lon, new Date());
  document.getElementById("locSunTimes").textContent = `${fmtTime(sunrise)} / ${fmtTime(sunset)}`;
}

// ============== 啟動 ==============

function init() {
  resizeCanvas();
  lastW = window.innerWidth;
  lastH = window.innerHeight;

  initLocation();
  setupToggles();
  setupSettingsModal();
  updateSunTimesDisplay();
  setInterval(updateSunTimesDisplay, 5 * 60 * 1000);

  loadSatelliteCatalog();
  setInterval(refreshSatellites, 6 * 60 * 60 * 1000); // 衛星目錄每 6 小時更新

  requestAnimationFrame(render);
}

init();
