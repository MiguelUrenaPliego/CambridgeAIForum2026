// CambridgeAI -- Esquivel pilot region (San Jose, Costa Rica) shape-parameters
// map. Single dataset (no city switcher, unlike SevillaConference's maps).
// Frontend-only: every file this page needs lives under CambridgeAI/ --
// data/prepare_data.py pre-baked buildings.geojson (footprint geometry + the
// 15 shape/plan-irregularity metrics from footprint_attributes, roof
// material, year, block position, ground-truth + ML-predicted structural
// system) and capacity_curves.json (one ML- or GEM-derived seismic capacity
// curve per building, precomputed offline from visor/city_risk_visor's own
// vulnerability service -- see that script's own docstring for exactly how).
//
// Video mode cycles ONLY the shape-index/shape-metric attributes (like
// SevillaConference's shape_parameters map), every 2s instead of 10s -- the
// "Color by" dropdown additionally offers roof material, block position,
// ground-truth/ML structural system and year, but those are manual-only,
// not part of the auto-cycle. 2s into the tour it also opens one
// masonry ("M") building with an available ML capacity curve, the same way
// a click would, to spotlight that curve during the tour; it closes itself
// a few seconds later so the tour keeps moving.
const { GeoJsonLayer } = deck;
const { MapboxOverlay } = deck;

const DATA_DIR = "./data";
const BASE_TITLE = document.title;

// ---------------------------------------------------------------------------
// Norm limits -- see code/footprint_attributes/src/footprint_attributes/config.py
// for the source of every limit below. `worseIsHigh: false` marks the 4
// inverted-direction parameters (higher value = better): EC8 radiusRatio,
// EC8 compactness, and the two GNDT-II betas that use an inscribed-circle
// "how well does the building fill its own footprint" construction.
const NORM_INFO = {
  slenderness_bbox: { limit: 4.0, worseIsHigh: true, unit: "", criteria: "EC8: slenderness (bbox) ≤ 4.0" },
  slenderness_inertia: { limit: 4.0, worseIsHigh: true, unit: "", criteria: "EC8: slenderness (inertia) ≤ 4.0" },
  GNDTII_beta1_mainShapeSlenderness: { limit: 0.4, worseIsHigh: false, unit: "", criteria: "GNDT-II β1 ≥ 0.8" },
  GNDTII_beta2_setbackRatio: { limit: 0.3, worseIsHigh: true, unit: "", criteria: "GNDT-II β2 ≤ 0.1" },
  GNDTII_beta4_eccentricityRatio: { limit: 0.4, worseIsHigh: true, unit: "", criteria: "GNDT-II β4 ≤ 0.2" },
  GNDTII_beta6_setbackSlenderness: { limit: 0.25, worseIsHigh: false, unit: "", criteria: "GNDT-II β6 ≥ 0.5" },
  ASCE7_setbackRatio: { limit: 0.2, worseIsHigh: true, unit: "", criteria: "ASCE 7: setback ratio ≤ 0.20" },
  ASCE7_holeRatio: { limit: 0.25, worseIsHigh: true, unit: "", criteria: "ASCE 7: hole ratio ≤ 0.25" },
  ASCE7_parallelityAngle: { limit: 10, worseIsHigh: true, unit: "°", criteria: "ASCE 7: angle ≤ 5°" },
  EC8_eccentricityRatio: { limit: 0.3, worseIsHigh: true, unit: "", criteria: "EC8: eccentricity ≤ 0.30" },
  EC8_radiusRatio: { limit: 1.0, worseIsHigh: true, unit: "", criteria: "EC8: radius ratio ≤ 1.00" },
  EC8_compactness: { limit: 0.95, worseIsHigh: false, unit: "", criteria: "EC8: compactness ≥ 0.95" },
  NTC23_setbackRatio: { limit: 0.4, worseIsHigh: true, unit: "", criteria: "NTC-23: setback ratio ≤ 0.40" },
  NTC23_holeRatio: { limit: 0.4, worseIsHigh: true, unit: "", criteria: "NTC-23: hole ratio ≤ 0.40" },
  CSCR2010_eccentricityRatio: { limit: 0.25, worseIsHigh: true, unit: "", criteria: "CSCR-2010: eccentricity ≤ 0.05" },
};

// Video-cycle order: shape index first, then round-robin across families so
// two columns from the same code never show back to back. This *is* the
// shape-family part of the "Color by" dropdown order too (see
// DROPDOWN_ATTRIBUTES below, which appends the non-cycled extra attributes
// after these).
const SHAPE_ATTRIBUTES = [
  { name: "shape_index", label: "Shape index" },
  { name: "slenderness_bbox", label: "Slenderness (bbox)" },
  { name: "GNDTII_beta1_mainShapeSlenderness", label: "GNDT-II β1 (slenderness)" },
  { name: "ASCE7_setbackRatio", label: "ASCE 7 setback ratio" },
  { name: "EC8_eccentricityRatio", label: "EC8 eccentricity ratio" },
  { name: "NTC23_setbackRatio", label: "NTC-23 setback ratio" },
  { name: "CSCR2010_eccentricityRatio", label: "CSCR-2010 eccentricity ratio" },
  { name: "slenderness_inertia", label: "Slenderness (inertia)" },
  { name: "GNDTII_beta2_setbackRatio", label: "GNDT-II β2 (setback ratio)" },
  { name: "ASCE7_holeRatio", label: "ASCE 7 hole ratio" },
  { name: "EC8_radiusRatio", label: "EC8 radius ratio" },
  { name: "NTC23_holeRatio", label: "NTC-23 hole ratio" },
  { name: "GNDTII_beta4_eccentricityRatio", label: "GNDT-II β4 (eccentricity ratio)" },
  { name: "ASCE7_parallelityAngle", label: "ASCE 7 parallelity angle" },
  { name: "EC8_compactness", label: "EC8 compactness" },
  { name: "GNDTII_beta6_setbackSlenderness", label: "GNDT-II β6 (setback slenderness)" },
];

// ---------------------------------------------------------------------------
// Extra "Color by" options beyond the shape metrics -- categorical (swatch
// legend) and continuous (min-max ramp) dataset attributes. Not part of the
// video-mode cycle (SHAPE_ATTRIBUTES only), manual selection only.
const POSITION_COLORS = { isolated: "#4299e1", lateral: "#e2a33f", corner: "#4fbf8f", confined: "#8744ad", torque: "#c0392b", unlabeled: "#6b7280" };
const POSITION_ORDER = ["isolated", "lateral", "corner", "confined", "torque", "unlabeled"];
const POSITION_LABELS = { isolated: "Isolated", lateral: "Lateral", corner: "Corner", confined: "Confined", torque: "Torque", unlabeled: "Unlabeled" };

const ROOF_COLORS = { metallic: "#8c9bab", bright_concrete: "#e2c23f", dark_shadow: "#4a5568", asphalt: "#c0392b", unlabeled: "#6b7280" };
const ROOF_ORDER = ["metallic", "bright_concrete", "dark_shadow", "asphalt", "unlabeled"];
const ROOF_LABELS = { metallic: "Metallic", bright_concrete: "Bright concrete", dark_shadow: "Dark / shadowed", asphalt: "Asphalt", unlabeled: "Unlabeled" };

const STRUCT_COLORS = { M: "#8744ad", W: "#4fbf8f", CR: "#4299e1", ADO: "#e2793f", S_light: "#e2c23f", S_frame: "#c0392b", unlabeled: "#6b7280" };
const STRUCT_ORDER = ["M", "CR", "W", "ADO", "S_light", "S_frame", "unlabeled"];
const STRUCT_LABELS = { M: "Masonry (M)", W: "Wood (W)", CR: "Reinforced concrete (CR)", ADO: "Adobe (ADO)", S_light: "Steel, light (S_light)", S_frame: "Steel frame (S_frame)", unlabeled: "Unlabeled" };

const QUALITY_COLORS = { pre_code: "#c0392b", low_code: "#e2793f", medium_code: "#e2c23f", high_code: "#4fbf8f", unlabeled: "#6b7280" };
const QUALITY_ORDER = ["pre_code", "low_code", "medium_code", "high_code", "unlabeled"];
const QUALITY_LABELS = { pre_code: "Pre-code", low_code: "Low code", medium_code: "Medium code", high_code: "High code", unlabeled: "Unlabeled" };

function categoricalKeyFactory(propName, colors) {
  return (feature) => {
    const value = feature.properties?.[propName];
    return value && colors[value] ? value : "unlabeled";
  };
}
const CATEGORICAL_INFO = {
  relativePosition: { key: categoricalKeyFactory("relativePosition", POSITION_COLORS), colors: POSITION_COLORS, order: POSITION_ORDER, labels: POSITION_LABELS },
  roof_material: { key: categoricalKeyFactory("roof_material", ROOF_COLORS), colors: ROOF_COLORS, order: ROOF_ORDER, labels: ROOF_LABELS },
  structural_system_survey: { key: categoricalKeyFactory("structural_system_survey", STRUCT_COLORS), colors: STRUCT_COLORS, order: STRUCT_ORDER, labels: STRUCT_LABELS },
  structural_system_ml: { key: categoricalKeyFactory("structural_system_ml", STRUCT_COLORS), colors: STRUCT_COLORS, order: STRUCT_ORDER, labels: STRUCT_LABELS },
  code_quality: { key: categoricalKeyFactory("code_quality", QUALITY_COLORS), colors: QUALITY_COLORS, order: QUALITY_ORDER, labels: QUALITY_LABELS },
};

// Continuous (non-norm, no code limit) numeric attributes: a plain min-max
// blue -> red ramp over the dataset's own range.
const CONTINUOUS_INFO = {
  year: { label: "Construction year", unit: "" },
  height: { label: "Height", unit: " m" },
  n_floors: { label: "Floors", unit: "" },
};

const EXTRA_ATTRIBUTES = [
  { name: "relativePosition", label: "Block position" },
  { name: "roof_material", label: "Roof material" },
  { name: "structural_system_survey", label: "Structural system (survey)" },
  { name: "structural_system_ml", label: "Structural system (ML prediction)" },
  { name: "code_quality", label: "Code quality" },
  { name: "year", label: "Construction year" },
  { name: "height", label: "Height" },
  { name: "n_floors", label: "Floors" },
];
const ALL_ATTRIBUTES = [...SHAPE_ATTRIBUTES, ...EXTRA_ATTRIBUTES];
const DROPDOWN_ATTRIBUTES = ALL_ATTRIBUTES; // dropdown order = declaration order above

// ---------------------------------------------------------------------------
// Shape index (fsi): a 4-category severity classification built from 3 of
// the 15 raw metrics (eccentricity, setback/"shape", slenderness) -- same
// thresholds+override order as SevillaConference's shape_parameters map.
const FSI_COLORS = { regular: "#4fbf8f", shape: "#e2793f", eccentricity: "#e2c23f", slenderness: "#c0392b" };
const FSI_ORDER = ["regular", "shape", "eccentricity", "slenderness"];
const FSI_LABELS = { regular: "Regular", shape: "Irregular: shape", eccentricity: "Irregular: eccentricity", slenderness: "Irregular: slenderness" };
function shapeIndexOf(feature) {
  const p = feature.properties ?? {};
  let key = "regular";
  if (typeof p.EC8_eccentricityRatio === "number" && p.EC8_eccentricityRatio > 0.3) key = "eccentricity";
  if (typeof p.ASCE7_setbackRatio === "number" && p.ASCE7_setbackRatio > 0.2) key = "shape";
  if (typeof p.slenderness_inertia === "number" && p.slenderness_inertia > 4.0) key = "slenderness";
  return key;
}

const DEFAULT_BUILDING_HEIGHT_M = 8;
const METRES_PER_FLOOR = 3;
const HEIGHT_EXAGGERATION = 2;
const SHOWCASE_PITCH = 55;
const SHOWCASE_ATTRIBUTE_CYCLE_MS = 2_000;
const SHOWCASE_IDLE_RESUME_MS = 30_000;
const SHOWCASE_ROTATE_DEG_PER_SEC = 2.2;
// 2s into a fresh tour, open one masonry building with a real ML capacity
// curve (spotlighting the map's whole point), and auto-close it this many
// ms later so the tour keeps moving.
const SHOWCASE_SPOTLIGHT_DELAY_MS = 2_000;
const SHOWCASE_SPOTLIGHT_DURATION_MS = 8_000;

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpColor(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}
const UNLABELED_COLOR = hexToRgb("#9e9d94");
const GREEN = hexToRgb("#2ca02c");
const YELLOW = hexToRgb("#e2c23f");
const RED = hexToRgb("#c0392b");
const DEEP_RED = hexToRgb("#5c1a10");
const CONTINUOUS_LOW = hexToRgb("#4299e1");
const CONTINUOUS_HIGH = hexToRgb("#c0392b");

const state = {
  data: { type: "FeatureCollection", features: [] },
  datasetCenter: null,
  attribute: SHAPE_ATTRIBUTES[0],
  normRanges: {}, // attribute name -> { good, bad, worst } raw values
  continuousRanges: {}, // attribute name -> { min, max }
  is3D: true,
  selectedBuildingId: null,
  showcaseActive: false,
  capacityCurves: {}, // building_uid -> { curve_source, direction_used, sd_mm, sa_g, sa_g_std } | undefined
};

const URL_PARAMS = new URLSearchParams(location.search);
const DARK_THEME = URL_PARAMS.get("theme") === "dark";
if (DARK_THEME) document.body.classList.add("theme-dark");
const MAP_STYLE = DARK_THEME
  ? "https://tiles.openfreemap.org/styles/dark"
  : "https://tiles.openfreemap.org/styles/positron";
const map = new maplibregl.Map({
  container: "map",
  style: MAP_STYLE,
  center: [-84.09, 9.94],
  zoom: 14,
  pitch: SHOWCASE_PITCH,
  bearing: 0,
  attributionControl: false,
});

map.addControl(new maplibregl.AttributionControl({ compact: true }));
// MapLibre's compact attribution starts expanded (<details open>) on
// initial load regardless of the compact flag -- force it closed so the
// "i" button is always collapsed on startup.
(() => {
  const attribEl = document.querySelector(".maplibregl-ctrl-attrib");
  if (!attribEl) return;
  attribEl.removeAttribute("open");
  const observer = new MutationObserver(() => attribEl.removeAttribute("open"));
  observer.observe(attribEl, { attributes: true, attributeFilter: ["open"] });
  setTimeout(() => observer.disconnect(), 5000);
})();

const overlay = new MapboxOverlay({ layers: [] });
map.addControl(overlay);

map.setMaxPitch(85); // MapLibre's default 60 is too flat for a presentation "look straight down the street" shot

// Middle-button drag: does exactly what right-button drag does (MapLibre's
// own dragRotate -- horizontal movement changes bearing, vertical movement
// changes pitch), so rotate/tilt is reachable from either button, not
// right-only. preventDefault stops the browser's auto-scroll on a bare
// middle-click.
map.getCanvas().addEventListener("mousedown", (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  registerUserInteraction();
  let lastX = event.clientX;
  let lastY = event.clientY;
  const onMouseMove = (moveEvent) => {
    const dx = moveEvent.clientX - lastX;
    const dy = moveEvent.clientY - lastY;
    lastX = moveEvent.clientX;
    lastY = moveEvent.clientY;
    map.setBearing((map.getBearing() - dx * 0.5) % 360);
    const nextPitch = Math.min(85, Math.max(0, map.getPitch() - dy * 0.5));
    map.setPitch(nextPitch);
  };
  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
});

function computeBbox(collection) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords) => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(coords)) {
      coords.forEach(visit);
    }
  };
  for (const f of collection.features) {
    if (f.geometry && "coordinates" in f.geometry) visit(f.geometry.coordinates);
  }
  return [[minX, minY], [maxX, maxY]];
}

function isSelected(feature) {
  return feature.properties?.building_uid === state.selectedBuildingId;
}
function rawHeightMetres(feature) {
  const p = feature.properties ?? {};
  if (typeof p.height === "number") return p.height;
  if (typeof p.n_floors === "number") return p.n_floors * METRES_PER_FLOOR;
  return DEFAULT_BUILDING_HEIGHT_M;
}
let elevationClamp = Infinity;
function elevationClampFor(data) {
  if (data.features.length === 0) return Infinity;
  const heights = data.features.map(rawHeightMetres).sort((a, b) => a - b);
  return heights[Math.floor(0.95 * (heights.length - 1))];
}
function getElevation(feature) {
  return Math.min(rawHeightMetres(feature), elevationClamp) * HEIGHT_EXAGGERATION;
}

// ---------------------------------------------------------------------------
// Norm-based good/bad percentiles + coloring (shape metrics only -- see
// SevillaConference/maps/shape_parameters/main.js for the original,
// unmodified version of this whole block and its own comments).
function badnessOf(value, info) {
  return info.worseIsHigh ? value : -value;
}
function valueAtBadness(badness, info) {
  return info.worseIsHigh ? badness : -badness;
}
function percentileOf(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}
function computeNormRange(data, name) {
  const info = NORM_INFO[name];
  const values = data.features.map((f) => f.properties?.[name]).filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (values.length === 0 || !info) return null;
  const limitBadness = badnessOf(info.limit, info);
  const badnesses = values.map((v) => badnessOf(v, info)).sort((a, b) => a - b);
  const compliant = badnesses.filter((b) => b <= limitBadness);
  const failing = badnesses.filter((b) => b > limitBadness);
  const goodBadness = compliant.length > 0 ? percentileOf(compliant, 0.05) : limitBadness;
  const badBadness = failing.length > 0 ? percentileOf(failing, 0.7) : limitBadness;
  const worstBadness = badnesses[badnesses.length - 1];
  const anyExceeds = failing.length > 0;
  const axisEndBadness = anyExceeds ? Math.max(badBadness, limitBadness) : limitBadness;
  return {
    good: valueAtBadness(goodBadness, info),
    bad: valueAtBadness(badBadness, info),
    worst: valueAtBadness(worstBadness, info),
    axisEnd: valueAtBadness(axisEndBadness, info),
    anyExceeds,
  };
}
function computeAllNormRanges(data) {
  for (const name of Object.keys(NORM_INFO)) state.normRanges[name] = computeNormRange(data, name);
}
function computeAllContinuousRanges(data) {
  for (const name of Object.keys(CONTINUOUS_INFO)) {
    const values = data.features.map((f) => f.properties?.[name]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    state.continuousRanges[name] = values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  }
}

function normBreakpoints(info, range) {
  const bGood = badnessOf(range.good, info);
  const bLimit = Math.max(badnessOf(info.limit, info), bGood);
  const bMid = bGood + (bLimit - bGood) / 2;
  const bBad = Math.max(badnessOf(range.bad, info), bLimit + 1e-9);
  return { bGood, bMid, bLimit, bBad };
}
function colorForNormValue(value, info, range) {
  if (typeof value !== "number" || Number.isNaN(value) || !range) return UNLABELED_COLOR;
  const b = badnessOf(value, info);
  const { bGood, bMid, bLimit, bBad } = normBreakpoints(info, range);
  if (b <= bGood) return GREEN;
  if (b <= bMid) return lerpColor(GREEN, YELLOW, (b - bGood) / Math.max(1e-9, bMid - bGood));
  if (b <= bLimit) return lerpColor(YELLOW, RED, (b - bMid) / Math.max(1e-9, bLimit - bMid));
  if (b >= bBad) return DEEP_RED;
  return lerpColor(RED, DEEP_RED, (b - bLimit) / Math.max(1e-9, bBad - bLimit));
}
function colorForContinuousValue(value, range) {
  if (typeof value !== "number" || Number.isNaN(value) || !range || range.max === range.min) return UNLABELED_COLOR;
  const t = Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
  return lerpColor(CONTINUOUS_LOW, CONTINUOUS_HIGH, t);
}

function getFillColor(feature) {
  const name = state.attribute.name;
  if (name === "shape_index") return [...hexToRgb(FSI_COLORS[shapeIndexOf(feature)]), 210];
  const categorical = CATEGORICAL_INFO[name];
  if (categorical) return [...hexToRgb(categorical.colors[categorical.key(feature)]), 210];
  if (CONTINUOUS_INFO[name]) {
    return [...colorForContinuousValue(feature.properties?.[name], state.continuousRanges[name]), 210];
  }
  const info = NORM_INFO[name];
  const range = state.normRanges[name];
  const value = feature.properties?.[name];
  return [...colorForNormValue(value, info, range), 210];
}
function getLineColor(feature) {
  return isSelected(feature) ? [...hexToRgb("#e2a33f"), 255] : [235, 235, 235, 90];
}
function getLineWidth(feature) {
  return isSelected(feature) ? 3 : 1;
}

let onBuildingClick = () => {};

function buildingTooltip({ object, layer }) {
  if (!object || !layer?.id?.startsWith("buildings-")) return null;
  const name = state.attribute.name;
  let shown;
  if (name === "shape_index") shown = FSI_LABELS[shapeIndexOf(object)];
  else if (CATEGORICAL_INFO[name]) shown = CATEGORICAL_INFO[name].labels[CATEGORICAL_INFO[name].key(object)];
  else {
    const value = object.properties?.[name];
    const info = NORM_INFO[name];
    shown = typeof value === "number" ? `${value.toFixed(3)}${info?.unit ?? CONTINUOUS_INFO[name]?.unit ?? ""}` : "n/a";
  }
  return { html: `<div><strong>${state.attribute.label}:</strong> ${shown}</div><div class="hint" style="margin-top:4px">Click for full details</div>`, className: "deck-tooltip" };
}

function renderLayer() {
  const buildings = new GeoJsonLayer({
    id: `buildings-esquivel`,
    data: state.data,
    filled: true,
    stroked: true,
    pickable: true,
    extruded: state.is3D,
    getElevation,
    getFillColor,
    getLineColor,
    getLineWidth,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    updateTriggers: {
      getFillColor: [state.attribute.name],
      getLineColor: [state.selectedBuildingId],
      getLineWidth: [state.selectedBuildingId],
      getElevation: [state.is3D],
    },
    onClick: (info) => {
      const id = info.object?.properties?.building_uid;
      if (id !== undefined && id !== null) onBuildingClick(String(id), info.object.properties);
    },
  });
  overlay.setProps({ layers: [buildings], getTooltip: buildingTooltip });
}

// ---------------------------------------------------------------------------
// Legend -- shape index / categorical: swatch list. Norm params: a
// green-yellow-red gradient bar. Continuous: a plain min-max gradient bar.
function renderLegend() {
  const container = document.getElementById("legend");
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = state.attribute.label;
  container.appendChild(heading);

  const name = state.attribute.name;

  if (name === "shape_index" || CATEGORICAL_INFO[name]) {
    const order = name === "shape_index" ? FSI_ORDER : CATEGORICAL_INFO[name].order;
    const colors = name === "shape_index" ? FSI_COLORS : CATEGORICAL_INFO[name].colors;
    const labels = name === "shape_index" ? FSI_LABELS : CATEGORICAL_INFO[name].labels;
    const keyFn = name === "shape_index" ? shapeIndexOf : CATEGORICAL_INFO[name].key;
    const counts = {};
    for (const f of state.data.features) counts[keyFn(f)] = (counts[keyFn(f)] ?? 0) + 1;
    const list = document.createElement("ul");
    list.className = "legend-list";
    for (const key of order) {
      if (!counts[key]) continue;
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = colors[key];
      const label = document.createElement("span");
      label.textContent = `${labels[key]} (${counts[key]})`;
      item.append(swatch, label);
      list.appendChild(item);
    }
    container.appendChild(list);
    return;
  }

  if (CONTINUOUS_INFO[name]) {
    const range = state.continuousRanges[name];
    const fmt = (v) => (typeof v === "number" ? `${v.toFixed(1)}${CONTINUOUS_INFO[name].unit}` : "–");
    if (!range) {
      container.innerHTML += '<p class="hint">No data.</p>';
      return;
    }
    const gradient = document.createElement("div");
    gradient.className = "norm-gradient";
    gradient.style.background = "linear-gradient(90deg, #4299e1 0%, #c0392b 100%)";
    container.appendChild(gradient);
    const ticks = document.createElement("div");
    ticks.className = "norm-gradient-ticks";
    ticks.innerHTML = `<span>Min: ${fmt(range.min)}</span><span>Max: ${fmt(range.max)}</span>`;
    container.appendChild(ticks);
    return;
  }

  const info = NORM_INFO[name];
  const range = state.normRanges[name];
  const fmt = (v) => (typeof v === "number" ? `${v.toFixed(2)}${info.unit ?? ""}` : "–");
  if (!range) {
    container.innerHTML += '<p class="hint">No data.</p>';
    return;
  }
  const { bGood, bMid, bLimit, bBad } = normBreakpoints(info, range);
  const pct = (b) => (bBad === bGood ? 0 : ((b - bGood) / (bBad - bGood)) * 100);
  const gradient = document.createElement("div");
  gradient.className = "norm-gradient";
  gradient.style.background = `linear-gradient(90deg, #2ca02c 0%, #e2c23f ${pct(bMid).toFixed(0)}%, #c0392b ${pct(bLimit).toFixed(0)}%, #5c1a10 100%)`;
  container.appendChild(gradient);
  const ticks = document.createElement("div");
  ticks.className = "norm-gradient-ticks";
  ticks.innerHTML = `<span>Good: ${fmt(range.good)}</span><span>Limit: ${fmt(info.limit)}</span><span>Bad: ${fmt(range.bad)}</span>`;
  container.appendChild(ticks);
}

// ---------------------------------------------------------------------------
// Norm-exceedance chart (shape metrics only -- unchanged from Sevilla's own
// version, see that file for extended comments).
const CHART_WIDTH = 280;
const CHART_HEIGHT = 165;
const CHART_MARGIN = { top: 14, right: 10, bottom: 26, left: 34 };
const CHART_STEPS = 40;

function renderNormChart() {
  const container = document.getElementById("norm-chart");
  const belowText = document.getElementById("norm-chart-caption");
  const card = document.getElementById("norm-chart-card");
  const info = NORM_INFO[state.attribute.name];
  if (!info) {
    card.classList.add("hidden");
    container.innerHTML = "";
    belowText.textContent = "";
    return;
  }
  card.classList.remove("hidden");
  document.getElementById("chart-title").textContent = state.attribute.label;
  const range = state.normRanges[state.attribute.name];
  const values = state.data.features.map((f) => f.properties?.[state.attribute.name]).filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (!range || values.length === 0) {
    container.innerHTML = '<p class="hint">No data.</p>';
    belowText.textContent = "";
    return;
  }
  const total = values.length;
  const badnesses = values.map((v) => badnessOf(v, info));

  const xStart = range.good;
  const xEnd = range.axisEnd;
  const bStart = badnessOf(xStart, info);
  const bEnd = badnessOf(xEnd, info);

  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const plotBottom = CHART_HEIGHT - CHART_MARGIN.top;

  const points = [];
  for (let i = 0; i <= CHART_STEPS; i++) {
    const t = i / CHART_STEPS;
    const b = lerp(bStart, bEnd, t);
    const worseOrEqualCount = badnesses.filter((bb) => bb >= b).length;
    const pct = (worseOrEqualCount / total) * 100;
    const x = CHART_MARGIN.left + t * plotWidth;
    const y = CHART_MARGIN.top + (1 - pct / 100) * plotHeight;
    points.push([x, y]);
  }

  const bLimitRaw = badnessOf(info.limit, info);
  const bLimit = Math.max(bLimitRaw, bStart);
  const bMid = bStart + (bLimit - bStart) / 2;
  const denom = bEnd - bStart;
  const pct2 = (b) => (denom === 0 ? 0 : Math.max(0, Math.min(100, ((b - bStart) / denom) * 100)));
  const gradId = `normGrad-${state.attribute.name}`;
  const gradientDef = `<linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#2ca02c"></stop>
    <stop offset="${pct2(bMid)}%" stop-color="#e2c23f"></stop>
    <stop offset="${pct2(bLimit)}%" stop-color="#c0392b"></stop>
    <stop offset="100%" stop-color="#5c1a10"></stop>
  </linearGradient>`;

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${plotBottom} L${points[0][0].toFixed(1)},${plotBottom} Z`;

  let limitMarker = "";
  const worseThanLimitCount = badnesses.filter((bb) => bb >= bLimitRaw).length;
  const worseThanLimitPct = ((worseThanLimitCount / total) * 100).toFixed(1);
  if (bLimitRaw >= Math.min(bStart, bEnd) && bLimitRaw <= Math.max(bStart, bEnd)) {
    const t = denom === 0 ? 0 : (bLimitRaw - bStart) / denom;
    const lx = CHART_MARGIN.left + t * plotWidth;
    limitMarker = `<line x1="${lx.toFixed(1)}" y1="${CHART_MARGIN.top}" x2="${lx.toFixed(1)}" y2="${plotBottom}" stroke="#c0392b" stroke-width="3"></line>
      <text x="${lx.toFixed(1)}" y="${CHART_MARGIN.top - 4}" text-anchor="${t > 0.7 ? "end" : "start"}" class="chart-axis-label" fill="#e2938a">${worseThanLimitCount} (${worseThanLimitPct}%) worse</text>`;
  }

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${CHART_MARGIN.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${Math.round(t * 100)}%</text>`;
  }
  const fmt = (v) => `${v.toFixed(2)}${info.unit ?? ""}`;
  let xAxisLabels = "";
  const TICK_COUNT = 5;
  for (let i = 0; i < TICK_COUNT; i++) {
    const t = i / (TICK_COUNT - 1);
    const tickValue = valueAtBadness(lerp(bStart, bEnd, t), info);
    const x = CHART_MARGIN.left + t * plotWidth;
    const anchor = i === 0 ? "start" : i === TICK_COUNT - 1 ? "end" : "middle";
    xAxisLabels += `<text x="${x.toFixed(1)}" y="${plotBottom + 16}" text-anchor="${anchor}" class="chart-axis-label">${fmt(tickValue)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <defs>${gradientDef}</defs>
    <path d="${areaPath}" fill="url(#${gradId})" opacity="0.55"></path>
    <path d="${linePath}" fill="none" stroke="#edf1f3" stroke-width="1.6"></path>
    <line x1="${CHART_MARGIN.left}" y1="${plotBottom}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" x2="${CHART_MARGIN.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${xAxisLabels}
    ${limitMarker}
  </svg>`;

  const compliantCount = total - worseThanLimitCount;
  const compliantPct = (100 - Number(worseThanLimitPct)).toFixed(1);
  belowText.innerHTML = `${info.criteria}<br>Compliance: ${compliantCount} of ${total} (${compliantPct}%)`;
}

// ---------------------------------------------------------------------------
// Shape index chart -- always visible below whatever norm chart is active.
const FSI_CHART_MARGIN = { top: 36, right: 10, bottom: 46, left: 34 };

function renderShapeIndexChart() {
  const container = document.getElementById("shape-index-chart");
  const counts = { regular: 0, shape: 0, eccentricity: 0, slenderness: 0 };
  for (const f of state.data.features) counts[shapeIndexOf(f)] += 1;
  const total = state.data.features.length || 1;

  const plotWidth = CHART_WIDTH - FSI_CHART_MARGIN.left - FSI_CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - FSI_CHART_MARGIN.top - FSI_CHART_MARGIN.bottom;
  const maxCount = Math.max(1, ...FSI_ORDER.map((k) => counts[k]));
  const barGap = 10;
  const barWidth = (plotWidth - barGap * (FSI_ORDER.length - 1)) / FSI_ORDER.length;
  const plotBottom = FSI_CHART_MARGIN.top + plotHeight;

  let bars = "";
  let labels = "";
  FSI_ORDER.forEach((key, i) => {
    const count = counts[key];
    const barHeight = (count / maxCount) * plotHeight;
    const x = FSI_CHART_MARGIN.left + i * (barWidth + barGap);
    const y = plotBottom - barHeight;
    const pct = ((count / total) * 100).toFixed(1);
    const cx = x + barWidth / 2;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${FSI_COLORS[key]}" rx="3"></rect>`;
    bars += `<text x="${cx}" y="${y - 24}" text-anchor="middle" class="chart-bar-label"><tspan x="${cx}" dy="0">${count}</tspan><tspan x="${cx}" dy="14">${pct}%</tspan></text>`;
    labels += `<text x="${cx + 4}" y="${plotBottom + 12}" text-anchor="end" class="chart-axis-label" transform="rotate(-40 ${cx + 4} ${plotBottom + 12})">${FSI_LABELS[key].replace("Irregular: ", "")}</text>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.5, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${FSI_CHART_MARGIN.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${Math.round(maxCount * t)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <line x1="${FSI_CHART_MARGIN.left}" y1="${plotBottom}" x2="${CHART_WIDTH - FSI_CHART_MARGIN.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${FSI_CHART_MARGIN.left}" y1="${FSI_CHART_MARGIN.top}" x2="${FSI_CHART_MARGIN.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${bars}
    ${labels}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Capacity-curve chart -- spectral acceleration (Sa, g) vs spectral
// displacement (Sd, mm), the same axes visor/city_risk_visor's own
// vulnerabilityPanel.ts plots. A plain inline SVG line + shaded uncertainty
// band (no chart library), mirroring the style already used for this map's
// other SVG charts above.
const CAP_CHART_WIDTH = 280;
const CAP_CHART_HEIGHT = 190;
const CAP_CHART_MARGIN = { top: 16, right: 14, bottom: 32, left: 40 };
const CURVE_SOURCE_LABELS = {
  ml_capacity_model: "ML capacity model (GPR)",
  gem_global_vulnerability: "GEM published curve",
  published_fallback: "Published typology fallback",
};

function renderCapacityChart(buildingUid) {
  const card = document.getElementById("capacity-chart-card");
  const container = document.getElementById("capacity-chart");
  const caption = document.getElementById("capacity-chart-caption");
  const curve = state.capacityCurves[buildingUid];
  if (!curve) {
    card.classList.add("hidden");
    container.innerHTML = "";
    caption.textContent = "";
    return;
  }
  card.classList.remove("hidden");

  const sdMm = curve.sd_mm;
  const saG = curve.sa_g;
  const saStd = curve.sa_g_std;
  const n = sdMm.length;
  const xMax = Math.max(...sdMm) * 1.05 || 1;
  const yMax = Math.max(...saG.map((v, i) => v + (saStd ? saStd[i] : 0))) * 1.15 || 1;

  const plotWidth = CAP_CHART_WIDTH - CAP_CHART_MARGIN.left - CAP_CHART_MARGIN.right;
  const plotHeight = CAP_CHART_HEIGHT - CAP_CHART_MARGIN.top - CAP_CHART_MARGIN.bottom;
  const X = (sd) => CAP_CHART_MARGIN.left + (sd / xMax) * plotWidth;
  const Y = (sa) => CAP_CHART_MARGIN.top + (1 - sa / yMax) * plotHeight;
  const plotBottom = CAP_CHART_MARGIN.top + plotHeight;

  const linePath = sdMm.map((sd, i) => `${i === 0 ? "M" : "L"}${X(sd).toFixed(1)},${Y(saG[i]).toFixed(1)}`).join(" ");

  let band = "";
  if (saStd) {
    const upper = sdMm.map((sd, i) => `${X(sd).toFixed(1)},${Y(saG[i] + saStd[i]).toFixed(1)}`);
    const lower = sdMm.map((sd, i) => `${X(sd).toFixed(1)},${Y(Math.max(0, saG[i] - saStd[i])).toFixed(1)}`).reverse();
    band = `<polygon points="${upper.concat(lower).join(" ")}" fill="#e2a33f" opacity="0.22"></polygon>`;
  }

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${CAP_CHART_MARGIN.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${(t * yMax).toFixed(2)}</text>`;
  }
  let xAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const x = CAP_CHART_MARGIN.left + t * plotWidth;
    xAxisLabels += `<text x="${x.toFixed(1)}" y="${plotBottom + 16}" text-anchor="middle" class="chart-axis-label">${(t * xMax).toFixed(0)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CAP_CHART_WIDTH} ${CAP_CHART_HEIGHT}">
    ${band}
    <path d="${linePath}" fill="none" stroke="#e2a33f" stroke-width="2"></path>
    <line x1="${CAP_CHART_MARGIN.left}" y1="${plotBottom}" x2="${CAP_CHART_WIDTH - CAP_CHART_MARGIN.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${CAP_CHART_MARGIN.left}" y1="${CAP_CHART_MARGIN.top}" x2="${CAP_CHART_MARGIN.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${xAxisLabels}
    <text x="${CAP_CHART_WIDTH / 2}" y="${CAP_CHART_HEIGHT - 4}" text-anchor="middle" class="chart-axis-label">Spectral displacement Sd (mm)</text>
    <text x="10" y="${CAP_CHART_HEIGHT / 2}" text-anchor="middle" class="chart-axis-label" transform="rotate(-90 10 ${CAP_CHART_HEIGHT / 2})">Spectral accel. Sa (g)</text>
  </svg>`;

  const sourceLabel = CURVE_SOURCE_LABELS[curve.curve_source] ?? curve.curve_source;
  const dirText = curve.direction_used ? ` · direction ${curve.direction_used}` : "";
  caption.innerHTML = `${sourceLabel}${dirText}<br>Precomputed from visor/city_risk_visor's own vulnerability service (see CambridgeAI/data/prepare_data.py).`;
}

// ---------------------------------------------------------------------------
// Building popup -- structural system (survey + ML), roof, year, block
// position, every shape metric, and the capacity-curve chart.
function fmtVal(v, unit = "") {
  return typeof v === "number" ? `${v}${unit}` : v || "n/a";
}
function renderBuildingPanel(id, properties) {
  const panel = document.getElementById("building-panel");
  const content = document.getElementById("building-panel-content");
  content.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = `Building ${id}`;
  content.appendChild(heading);

  const table = document.createElement("table");
  table.className = "building-summary";
  const tbody = document.createElement("tbody");

  const basics = [
    ["Structural system (survey)", STRUCT_LABELS[properties.structural_system_survey] ?? "Not surveyed"],
    ["Structural system (ML prediction)", STRUCT_LABELS[properties.structural_system_ml] ?? "n/a"],
    ["ML prediction (XGBoost)", STRUCT_LABELS[properties.structural_system_ml_xgboost] ?? "n/a"],
    ["Roof material", ROOF_LABELS[properties.roof_material] ?? "n/a"],
    ["Block position", POSITION_LABELS[properties.relativePosition] ?? "n/a"],
    ["Code quality", QUALITY_LABELS[properties.code_quality] ?? "n/a"],
    ["Construction year", fmtVal(properties.year)],
    ["Floors", fmtVal(properties.n_floors)],
    ["Height", fmtVal(properties.height, " m")],
  ];
  for (const [label, value] of basics) {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    row.append(th, td);
    tbody.appendChild(row);
  }

  const fsiRow = document.createElement("tr");
  const fsiTh = document.createElement("th");
  fsiTh.textContent = "Shape index";
  const fsiTd = document.createElement("td");
  fsiTd.textContent = FSI_LABELS[shapeIndexOf({ properties })];
  fsiRow.append(fsiTh, fsiTd);
  tbody.appendChild(fsiRow);

  for (const { name, label } of SHAPE_ATTRIBUTES) {
    if (name === "shape_index") continue;
    const value = properties[name];
    if (typeof value !== "number") continue;
    const info = NORM_INFO[name];
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = `${value.toFixed(3)}${info?.unit ?? ""}`;
    const isNonCompliant = info && badnessOf(value, info) > badnessOf(info.limit, info);
    if (isNonCompliant) {
      th.classList.add("non-compliant");
      td.classList.add("non-compliant");
    }
    row.append(th, td);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  content.appendChild(table);
  panel.classList.remove("hidden");

  renderCapacityChart(id);
}
function closeBuildingPanel() {
  document.getElementById("building-panel").classList.add("hidden");
  state.selectedBuildingId = null;
  renderLayer();
}
function selectBuilding(id, properties) {
  state.selectedBuildingId = id;
  renderLayer();
  renderBuildingPanel(id, properties);
}
onBuildingClick = selectBuilding;

// ---------------------------------------------------------------------------
// Attribute (color-by) switching.
let attributeDropdown = null;
function setAttribute(attribute, { fromShowcase = false } = {}) {
  state.attribute = attribute;
  attributeDropdown?.setValue(attribute.name);
  renderLegend();
  renderNormChart();
  renderLayer();
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

// ---------------------------------------------------------------------------
// Data loading -- single dataset, no city switcher.
async function loadDataset() {
  const [buildings, capacityCurves] = await Promise.all([
    fetch(`${DATA_DIR}/buildings.geojson`).then((r) => r.json()),
    fetch(`${DATA_DIR}/capacity_curves.json`).then((r) => r.json()),
  ]);
  state.data = buildings;
  state.capacityCurves = capacityCurves;
  elevationClamp = elevationClampFor(buildings);
  computeAllNormRanges(buildings);
  computeAllContinuousRanges(buildings);

  const [[minX, minY], [maxX, maxY]] = computeBbox(buildings);
  state.datasetCenter = { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };

  renderLegend();
  renderNormChart();
  renderShapeIndexChart();
  renderLayer();
}

function createDropdown(container, options, onChange) {
  container.innerHTML = "";
  container.classList.add("dropdown");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dropdown-toggle";
  const valueEl = document.createElement("span");
  valueEl.className = "dropdown-value";
  toggle.appendChild(valueEl);
  const caret = document.createElement("span");
  caret.className = "dropdown-caret";
  caret.textContent = "▾";
  toggle.appendChild(caret);

  const list = document.createElement("ul");
  list.className = "dropdown-list";
  list.hidden = true;

  function renderOptions(current) {
    list.innerHTML = "";
    for (const option of options) {
      const item = document.createElement("li");
      item.textContent = option.label;
      if (option.value === current) item.classList.add("selected");
      item.addEventListener("click", () => {
        onChange(option.value);
        close();
      });
      list.appendChild(item);
    }
  }
  function close() {
    list.hidden = true;
    container.removeAttribute("data-open");
  }
  function open() {
    list.hidden = false;
    container.setAttribute("data-open", "");
  }
  toggle.addEventListener("click", () => (list.hidden ? open() : close()));
  document.addEventListener("click", (event) => {
    if (!container.contains(event.target)) close();
  });

  container.append(toggle, list);
  renderOptions(options[0]?.value);

  return {
    setValue(value) {
      const option = options.find((o) => o.value === value);
      if (option) valueEl.textContent = option.label;
      renderOptions(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Showcase mode: orbit the dataset center in 3D; every 2s advance to the
// next SHAPE attribute (shape index first, then family-interleaved -- the
// extra categorical/continuous attributes are manual-only, not cycled). 2s
// into a fresh tour, spotlight one masonry building with a real ML capacity
// curve, then close it again a few seconds later.
let showcaseRotateFrame = null;
let showcaseAttributeTimer = null;
let showcaseIdleTimer = null;
let showcaseSpotlightTimer = null;
let showcaseAttributeIndex = 0;

function pickSpotlightBuilding() {
  // Every building with a known floor count gets an ML capacity curve
  // (computed as if it were masonry, see CambridgeAI/data/prepare_data.py),
  // so any building with one is a valid spotlight pick, not just ones
  // actually predicted as masonry.
  const candidates = state.data.features.filter(
    (f) => state.capacityCurves[f.properties?.building_uid]?.curve_source === "ml_capacity_model",
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function scheduleSpotlight() {
  showcaseSpotlightTimer = setTimeout(() => {
    if (!state.showcaseActive) return;
    const feature = pickSpotlightBuilding();
    if (feature) {
      selectBuilding(String(feature.properties.building_uid), feature.properties);
      showcaseSpotlightTimer = setTimeout(() => {
        if (state.showcaseActive) closeBuildingPanel();
      }, SHOWCASE_SPOTLIGHT_DURATION_MS);
    }
  }, SHOWCASE_SPOTLIGHT_DELAY_MS);
}
function stopSpotlight() {
  if (showcaseSpotlightTimer !== null) clearTimeout(showcaseSpotlightTimer);
  showcaseSpotlightTimer = null;
}

function startShowcase() {
  if (state.showcaseActive) return;
  state.showcaseActive = true;

  if (state.is3D) {
    const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
    map.jumpTo({ center: [(minX + maxX) / 2, (minY + maxY) / 2] });
    let lastFrameTime = performance.now();
    const rotate = (now) => {
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      map.setBearing((map.getBearing() + SHOWCASE_ROTATE_DEG_PER_SEC * dt) % 360);
      showcaseRotateFrame = requestAnimationFrame(rotate);
    };
    showcaseRotateFrame = requestAnimationFrame(rotate);
  }

  setAttribute(SHAPE_ATTRIBUTES[showcaseAttributeIndex], { fromShowcase: true });
  showcaseAttributeTimer = setInterval(() => {
    showcaseAttributeIndex = (showcaseAttributeIndex + 1) % SHAPE_ATTRIBUTES.length;
    setAttribute(SHAPE_ATTRIBUTES[showcaseAttributeIndex], { fromShowcase: true });
  }, SHOWCASE_ATTRIBUTE_CYCLE_MS);

  scheduleSpotlight();
}

function stopShowcase({ resumeAfterIdle = true } = {}) {
  if (showcaseRotateFrame !== null) cancelAnimationFrame(showcaseRotateFrame);
  if (showcaseAttributeTimer !== null) clearInterval(showcaseAttributeTimer);
  showcaseRotateFrame = null;
  showcaseAttributeTimer = null;
  stopSpotlight();
  state.showcaseActive = false;

  if (showcaseIdleTimer !== null) clearTimeout(showcaseIdleTimer);
  if (resumeAfterIdle) showcaseIdleTimer = setTimeout(startShowcase, SHOWCASE_IDLE_RESUME_MS);
}
function registerUserInteraction() {
  stopShowcase({ resumeAfterIdle: true });
}
["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach((event) => {
  map.on(event, (e) => {
    if (e.originalEvent) registerUserInteraction();
  });
});
map.on("click", () => registerUserInteraction());

function toggle3D(forceOn) {
  state.is3D = forceOn ?? !state.is3D;
  const nextPitch = state.is3D ? (map.getPitch() > 0 ? map.getPitch() : SHOWCASE_PITCH) : 0;
  map.easeTo({ pitch: nextPitch, duration: 500 });
  document.getElementById("view-3d-toggle").classList.toggle("active", state.is3D);
  renderLayer();
}
function resetOrientation() {
  map.easeTo({ bearing: 0, pitch: state.is3D ? SHOWCASE_PITCH : 0, duration: 500 });
}

async function bootstrap() {
  attributeDropdown = createDropdown(
    document.getElementById("attribute-select"),
    DROPDOWN_ATTRIBUTES.map((a) => ({ value: a.name, label: a.label })),
    (value) => setAttribute(ALL_ATTRIBUTES.find((a) => a.name === value)),
  );
  attributeDropdown.setValue(state.attribute.name);

  await loadDataset();
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 0 });

  document.getElementById("controls-toggle").addEventListener("click", (event) => {
    document.getElementById("controls-fields").classList.toggle("hidden");
    event.currentTarget.classList.toggle("collapsed");
  });
  document.getElementById("legend-toggle").addEventListener("click", (event) => {
    document.getElementById("legend").classList.toggle("hidden");
    event.currentTarget.classList.toggle("active");
  });
  document.getElementById("charts-toggle").addEventListener("click", (event) => {
    document.getElementById("charts-panel").classList.toggle("hidden");
    event.currentTarget.classList.toggle("active");
  });
  document.getElementById("view-3d-toggle").addEventListener("click", () => {
    toggle3D();
    registerUserInteraction();
  });
  document.getElementById("reorient-toggle").addEventListener("click", () => {
    resetOrientation();
    registerUserInteraction();
  });
  document.getElementById("resume-showcase-toggle").addEventListener("click", () => {
    if (state.showcaseActive) stopShowcase({ resumeAfterIdle: false });
    else startShowcase();
  });
  document.getElementById("settings-toggle").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.toggle("hidden");
  });
  document.getElementById("settings-panel-close").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.add("hidden");
  });
  document.getElementById("building-panel-close").addEventListener("click", closeBuildingPanel);

  startShowcase();
}

map.on("load", () => {
  bootstrap().catch((error) => {
    console.error(error);
    const controls = document.getElementById("controls-body");
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = `Failed to load: ${error.message}. Serve this folder over HTTP so fetch() can read the data files.`;
    controls.appendChild(message);
  });
});
