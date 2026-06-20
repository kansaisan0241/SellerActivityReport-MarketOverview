const HEADERS = [
  "物件名",
  "所在地",
  "緯度",
  "経度",
  "価格",
  "土地面積",
  "建物面積",
  "専有面積",
  "築年数",
  "登録日",
  "物件URL",
  "取引状況",
  "前回価格",
  "今回価格",
  "建物減価償却年数",
  "建物坪単価",
  "リフォーム費用",
  "備考",
  "自社媒介フラグ"
];

const TYPE_LABELS = {
  land: "土地",
  house: "中古戸建て",
  mansion: "マンション"
};

const CHART_OPTIONS = {
  land: [
    ["landArea", "price", "土地面積 × 価格"],
    ["landArea", "unitPrice", "土地面積 × 坪単価"]
  ],
  house: [
    ["landArea", "price", "土地面積 × 価格"],
    ["buildingArea", "price", "建物面積 × 価格"],
    ["age", "price", "築年数 × 価格"],
    ["landArea", "unitPrice", "土地面積 × 坪単価"],
    ["buildingArea", "unitPrice", "建物面積 × 坪単価"],
    ["age", "unitPrice", "築年数 × 坪単価"]
  ],
  mansion: [
    ["exclusiveArea", "price", "専有面積 × 価格"],
    ["age", "price", "築年数 × 価格"],
    ["exclusiveArea", "unitPrice", "専有面積 × 坪単価"],
    ["age", "unitPrice", "築年数 × 坪単価"]
  ]
};

const state = {
  propertyType: "land",
  current: [],
  previous: [],
  compared: [],
  adjustments: {},
  positionAdjustments: {},
  selectedAdjustmentKey: "",
  map: null,
  markers: [],
  chart: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  setDefaultPaste();
  refreshChartMode();
  processData();
});

function bindEvents() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $("#propertyType").addEventListener("change", () => {
    state.propertyType = $("#propertyType").value;
    refreshChartMode();
    processData();
  });

  $("#parseButton").addEventListener("click", () => {
    processData();
    showView("reportView");
  });
  $("#clearButton").addEventListener("click", () => {
    $("#pasteArea").value = "";
    processData();
  });
  $("#loadSampleButton").addEventListener("click", () => {
    setDefaultPaste();
    processData();
    showView("inputView");
  });
  $("#printButton").addEventListener("click", () => {
    processData();
    showView("reportView");
    setTimeout(() => window.print(), 150);
  });
  $("#exportButton").addEventListener("click", exportJson);
  $("#downloadButton").addEventListener("click", downloadJson);
  $("#importButton").addEventListener("click", importPreviousJson);
  $("#restoreButton")?.addEventListener("click", restoreCurrentJson);
  $("#resetPreviousButton").addEventListener("click", () => {
    state.previous = [];
    $("#importArea").value = "";
    $("#importStatus").textContent = "前回データ未読込";
    processData();
  });
  $("#chartMode").addEventListener("change", () => renderChart());
  $("#adjustmentProperty")?.addEventListener("change", () => {
    state.selectedAdjustmentKey = $("#adjustmentProperty").value;
    syncAdjustmentInputs();
  });
  ["#adjustmentBuildingUnitPrice", "#adjustmentRenovationCost", "#adjustmentDepreciationYears"].forEach((selector) => {
    $(selector)?.addEventListener("input", updateSelectedAdjustment);
  });
  $$("[data-block]").forEach((checkbox) => checkbox.addEventListener("change", syncBlocks));
}

function showView(viewId) {
  $$(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  if (viewId === "reportView") {
    setTimeout(() => {
      renderMap();
      renderChart();
    }, 80);
  }
}

function setDefaultPaste() {
  $("#pasteArea").value = [
    HEADERS.join("\t"),
    "自社媒介 中央町土地\t東京都千代田区丸の内1-1\t35.681236\t139.767125\t7800\t42.3\t\t\t\t2026-05-01\thttps://example.com/a\t販売中\t7800\t7800\t25\t66\t0\t駅徒歩圏の整形地\t1",
    "南町売地\t東京都中央区銀座4-1\t35.671989\t139.765794\t6980\t39.4\t\t\t\t2026-05-12\thttps://example.com/b\t販売中\t7280\t6980\t25\t66\t0\t価格改定あり\t0",
    "東町土地\t東京都港区芝公園4-2\t35.658581\t139.745433\t6200\t36.1\t\t\t\t2026-04-18\thttps://example.com/c\t成約\t6200\t6200\t25\t66\t0\t成約比較用\t0",
    "西町土地\t東京都新宿区西新宿2-8\t35.689634\t139.692101\t8200\t45.8\t\t\t\t2026-05-20\thttps://example.com/d\t販売中\t8200\t8200\t25\t66\t0\t競合物件\t0"
  ].join("\n");
}

function refreshChartMode() {
  const select = $("#chartMode");
  select.innerHTML = "";
  CHART_OPTIONS[state.propertyType].forEach(([x, y, label]) => {
    const option = document.createElement("option");
    option.value = `${x}:${y}`;
    option.textContent = label;
    select.appendChild(option);
  });
}

function processData() {
  state.propertyType = $("#propertyType").value;
  state.current = parsePastedData($("#pasteArea").value)
    .map(normalizeRecord)
    .map(applyRecordAdjustment)
    .map(applyRecordPosition);
  state.compared = compareRecords(state.current, state.previous);
  renderAdjustmentControls();
  renderPreview();
  renderReport();
  syncBlocks();
}

function getRecordKey(record) {
  return record.matchKeys[0] || `${record.address}|${record.name}`;
}

function applyRecordAdjustment(record) {
  const key = getRecordKey(record);
  const adjustment = state.adjustments[key];
  if (!adjustment) return record;
  const adjusted = {
    ...record,
    buildingUnitPrice: numberValue(adjustment.buildingUnitPrice) || record.buildingUnitPrice,
    renovationCost: numberValue(adjustment.renovationCost),
    depreciationYears: numberValue(adjustment.depreciationYears) || record.depreciationYears
  };
  adjusted.unitPrice = calculateUnitPrice(adjusted);
  return adjusted;
}

function applyRecordPosition(record) {
  const position = state.positionAdjustments[getRecordKey(record)];
  return position ? { ...record, lat: position.lat, lng: position.lng } : record;
}

function renderAdjustmentControls() {
  const select = $("#adjustmentProperty");
  if (!select) return;
  const currentKeys = state.current.map(getRecordKey);
  if (!state.selectedAdjustmentKey || !currentKeys.includes(state.selectedAdjustmentKey)) {
    state.selectedAdjustmentKey = currentKeys[0] || "";
  }
  select.innerHTML = state.current.map((record) => {
    const key = getRecordKey(record);
    const label = record.name || record.address || "名称未入力";
    return `<option value="${escapeHtml(key)}"${key === state.selectedAdjustmentKey ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  syncAdjustmentInputs();
}

function syncAdjustmentInputs() {
  const record = state.current.find((item) => getRecordKey(item) === state.selectedAdjustmentKey);
  const buildingInput = $("#adjustmentBuildingUnitPrice");
  const renovationInput = $("#adjustmentRenovationCost");
  const depreciationInput = $("#adjustmentDepreciationYears");
  if (!buildingInput || !renovationInput || !depreciationInput) return;
  const disabled = !record;
  [buildingInput, renovationInput, depreciationInput].forEach((input) => {
    input.disabled = disabled;
  });
  if (!record) {
    buildingInput.value = "";
    renovationInput.value = "";
    depreciationInput.value = "";
    return;
  }
  buildingInput.value = record.buildingUnitPrice || "";
  renovationInput.value = record.renovationCost || 0;
  depreciationInput.value = record.depreciationYears || "";
}

function updateSelectedAdjustment() {
  if (!state.selectedAdjustmentKey) return;
  state.adjustments[state.selectedAdjustmentKey] = {
    buildingUnitPrice: $("#adjustmentBuildingUnitPrice").value,
    renovationCost: $("#adjustmentRenovationCost").value,
    depreciationYears: $("#adjustmentDepreciationYears").value
  };
  processData();
}

function parsePastedData(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows = trimmed.split(/\r?\n/).filter(Boolean).map(splitRow);
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.trim());
  const hasHeader = header.some((cell) => HEADERS.includes(cell));
  if (!hasHeader && rows.every((row) => row.length <= 2)) {
    return parseLabeledTextData(trimmed);
  }
  const fields = hasHeader ? header : HEADERS;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.map((row) => {
    const record = {};
    fields.forEach((field, index) => {
      if (HEADERS.includes(field)) record[field] = row[index] || "";
    });
    return record;
  });
}

function parseLabeledTextData(text) {
  const blocks = text.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  const candidates = blocks.length > 1 ? blocks : [text.trim()];
  const records = candidates.map(parseLabeledTextBlock).filter((record) => {
    return record["物件名"] || record["所在地"] || record["価格"] || record["今回価格"];
  });
  return records.length ? records : [parseLabeledTextBlock(text)];
}

function parseLabeledTextBlock(block) {
  const record = {};
  const text = block.replace(/\r/g, "\n");
  const get = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return cleanExtractedValue(match[1]);
    }
    return "";
  };

  record["物件名"] = get([/(?:物件名|名称|建物名|マンション名)\s*[:：]?\s*([^\n]+)/]);
  record["所在地"] = get([/(?:所在地|住所|物件所在地)\s*[:：]?\s*([^\n]+)/]);
  record["価格"] = get([/(?:販売価格|価格|物件価格)\s*[:：]?\s*([0-9,\.]+)\s*(?:万円|円)?/]);
  record["土地面積"] = areaValue(get([/(?:土地面積|敷地面積)\s*[:：]?\s*([0-9,\.]+\s*(?:㎡|m2|平米|坪)?)/]));
  record["建物面積"] = areaValue(get([/(?:建物面積|延床面積)\s*[:：]?\s*([0-9,\.]+\s*(?:㎡|m2|平米|坪)?)/]));
  record["専有面積"] = areaValue(get([/(?:専有面積|専有)\s*[:：]?\s*([0-9,\.]+\s*(?:㎡|m2|平米|坪)?)/]));
  record["築年数"] = ageValue(get([/(?:築年数|築後年数)\s*[:：]?\s*([0-9,\.]+)\s*年?/, /築\s*([0-9,\.]+)\s*年/]));
  record["登録日"] = get([/(?:登録日|掲載日|情報登録日|公開日)\s*[:：]?\s*([0-9\/\-.年月日]+)/]);
  record["物件URL"] = get([/(https?:\/\/[^\s]+)/]);
  record["取引状況"] = get([/(?:取引状況|状態|販売状況)\s*[:：]?\s*([^\n]+)/]) || "販売中";
  record["前回価格"] = get([/(?:前回価格)\s*[:：]?\s*([0-9,\.]+)\s*(?:万円|円)?/]);
  record["今回価格"] = get([/(?:今回価格)\s*[:：]?\s*([0-9,\.]+)\s*(?:万円|円)?/]);
  record["建物減価償却年数"] = get([/(?:建物減価償却年数|減価償却年数)\s*[:：]?\s*([0-9,\.]+)/]);
  record["建物坪単価"] = get([/(?:建物坪単価)\s*[:：]?\s*([0-9,\.]+)/]);
  record["リフォーム費用"] = get([/(?:リフォーム費用)\s*[:：]?\s*([0-9,\.]+)/]);
  record["備考"] = get([/(?:備考|コメント|メモ)\s*[:：]?\s*([^\n]+)/]);
  record["自社媒介フラグ"] = /自社媒介|自社/.test(text) ? "1" : "";
  return record;
}

function cleanExtractedValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function areaValue(value) {
  const raw = String(value ?? "");
  const number = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(number)) return "";
  return /㎡|m2|平米/.test(raw) ? String(number / 3.305785) : String(number);
}

function ageValue(value) {
  return String(value ?? "").replace(/[^0-9.]/g, "");
}

function splitRow(row) {
  if (row.includes("\t")) return row.split("\t");
  return parseCsvLine(row);
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function normalizeRecord(raw) {
  const defaults = getDefaults();
  const record = {
    name: textValue(raw["物件名"]),
    address: textValue(raw["所在地"]),
    lat: numberValue(raw["緯度"]),
    lng: numberValue(raw["経度"]),
    price: numberValue(raw["今回価格"]) || numberValue(raw["価格"]),
    landArea: numberValue(raw["土地面積"]),
    buildingArea: numberValue(raw["建物面積"]),
    exclusiveArea: numberValue(raw["専有面積"]),
    age: numberValue(raw["築年数"]),
    registeredDate: textValue(raw["登録日"]),
    url: textValue(raw["物件URL"]),
    status: textValue(raw["取引状況"]) || "販売中",
    previousPrice: numberValue(raw["前回価格"]),
    currentPrice: numberValue(raw["今回価格"]) || numberValue(raw["価格"]),
    depreciationYears: numberValue(raw["建物減価償却年数"]) || defaults.depreciationYears,
    buildingUnitPrice: numberValue(raw["建物坪単価"]) || defaults.buildingUnitPrice,
    renovationCost: numberValue(raw["リフォーム費用"]) || defaults.renovationCost,
    note: textValue(raw["備考"]),
    ownBrokerage: isTruthy(raw["自社媒介フラグ"])
  };
  record.unitPrice = calculateUnitPrice(record);
  record.matchKeys = createMatchKeys(record);
  return record;
}

function getDefaults() {
  return {
    buildingUnitPrice: numberValue($("#defaultBuildingUnitPrice").value) || 66,
    renovationCost: numberValue($("#defaultRenovationCost").value) || 0,
    depreciationYears: numberValue($("#defaultDepreciationYears").value) || 25
  };
}

function numberValue(value) {
  const normalized = String(value ?? "").replace(/[,\s万円㎡坪円]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return String(value ?? "").trim();
}

function isTruthy(value) {
  return ["1", "true", "TRUE", "有", "あり", "自社", "○", "〇", "yes"].includes(String(value ?? "").trim());
}

function calculateUnitPrice(record) {
  if (state.propertyType === "land") {
    return divide(record.price, record.landArea);
  }
  if (state.propertyType === "mansion") {
    const basePrice = Math.max(0, record.price - record.renovationCost);
    return divide(basePrice, record.exclusiveArea);
  }
  const newBuildingPrice = record.buildingUnitPrice * record.buildingArea;
  const remainingRate = record.age >= record.depreciationYears ? 0 : (record.depreciationYears - record.age) / record.depreciationYears;
  const currentBuildingPrice = Math.max(0, newBuildingPrice * remainingRate) + record.renovationCost;
  const landPrice = Math.max(0, record.price - currentBuildingPrice);
  return divide(landPrice, record.landArea);
}

function divide(a, b) {
  return b > 0 ? a / b : 0;
}

function createMatchKeys(record) {
  const address = record.address.replace(/\s/g, "");
  return [
    record.landArea ? `${address}|land|${record.landArea}` : "",
    record.exclusiveArea ? `${address}|exclusive|${record.exclusiveArea}` : "",
    record.buildingArea ? `${address}|building|${record.buildingArea}` : ""
  ].filter(Boolean);
}

function compareRecords(current, previous) {
  const previousByKey = new Map();
  previous.forEach((record) => {
    record.matchKeys.forEach((key) => previousByKey.set(key, record));
  });

  const matchedPrevious = new Set();
  const compared = current.map((record) => {
    const previousRecord = record.matchKeys.map((key) => previousByKey.get(key)).find(Boolean);
    if (previousRecord) matchedPrevious.add(previousRecord);
    const priceChanged = previousRecord && previousRecord.price !== record.price;
    return {
      ...record,
      registeredDate: previousRecord?.registeredDate || record.registeredDate,
      previousMatchedPrice: previousRecord?.price || record.previousPrice,
      comparisonStatus: previousRecord ? (priceChanged ? "changed" : "same") : "new"
    };
  });

  previous.forEach((record) => {
    if (!matchedPrevious.has(record)) {
      compared.push({ ...record, comparisonStatus: "ended" });
    }
  });
  return compared;
}

function renderPreview() {
  $("#currentCount").textContent = `${state.current.length}件`;
  renderTable("#previewTable", state.compared.filter((record) => record.comparisonStatus !== "ended"));
}

function renderReport() {
  $("#reportType").textContent = TYPE_LABELS[state.propertyType];
  $("#reportDate").textContent = new Date().toLocaleDateString("ja-JP");
  $("#reportCount").textContent = `${state.current.length}件`;
  renderMetrics();
  renderTable("#reportTable", state.compared);
  renderMap();
  renderChart();
}

function renderMetrics() {
  const newCount = state.compared.filter((record) => record.comparisonStatus === "new").length;
  const endedCount = state.compared.filter((record) => record.comparisonStatus === "ended").length;
  const changedCount = state.compared.filter((record) => record.comparisonStatus === "changed").length;
  const competitors = state.compared.filter((record) => !record.ownBrokerage);
  const competitorCount = competitors.length;
  const competitorNewCount = competitors.filter((record) => record.comparisonStatus === "new").length;
  const competitorEndedCount = competitors.filter((record) => record.comparisonStatus === "ended").length;
  const competitorChangedCount = competitors.filter((record) => record.comparisonStatus === "changed").length;
  $("#metrics").innerHTML = [
    metricHtml("競合物件数", `${competitorCount}件`, [
      `新規 ${competitorNewCount}件`,
      `終了・成約 ${competitorEndedCount}件`,
      `価格変更 ${competitorChangedCount}件`
    ]),
    metricHtml("新規物件数", `${newCount}件`),
    metricHtml("終了・成約候補", `${endedCount}件`),
    metricHtml("価格変更数", `${changedCount}件`)
  ].join("");
}

function metricHtml(label, value, details = []) {
  const detailHtml = details.length ? `<small>${details.join(" / ")}</small>` : "";
  return `<div class="metric"><span>${label}</span><strong>${value}</strong>${detailHtml}</div>`;
}

function renderComments() {
  const newCount = state.compared.filter((record) => record.comparisonStatus === "new").length;
  const changedCount = state.compared.filter((record) => record.comparisonStatus === "changed").length;
  const active = state.compared.filter((record) => record.comparisonStatus !== "ended");
  const own = active.find((record) => record.ownBrokerage);
  const avgUnit = average(active.filter((record) => !record.ownBrokerage).map((record) => record.unitPrice));
  const comments = [];

  if (newCount > 0) comments.push("前回報告時より、周辺で新規売出物件が増加しています。");
  if (changedCount > 0) comments.push("競合物件で価格変更の動きが見られます。");
  if (own && own.unitPrice > avgUnit * 1.05) comments.push("同条件帯の物件と比較すると、坪単価が高めに出ています。");
  comments.push("成約事例の分布と比較すると、現在価格は高めの位置にあります。");
  comments.push("市場内での競争力を高めるため、価格変更の検討余地があります。");

  $("#autoComments").innerHTML = comments.map((comment) => `<li>${comment}</li>`).join("");
}

function renderMiniLists() {
  renderMiniList("#newList", state.compared.filter((record) => record.comparisonStatus === "new"), "new");
  renderMiniList("#endedList", state.compared.filter((record) => record.comparisonStatus === "ended"), "ended");
  renderMiniList("#changedList", state.compared.filter((record) => record.comparisonStatus === "changed"), "changed");
}

function renderMiniList(selector, records, type) {
  const target = $(selector);
  if (!records.length) {
    target.innerHTML = `<p class="hint">該当物件はありません。</p>`;
    return;
  }
  target.innerHTML = records.map((record) => `
    <div class="mini-card ${type}">
      <strong>${escapeHtml(record.name || record.address || "名称未入力")}</strong>
      <span>${escapeHtml(record.address)}</span>
      <span>${formatNumber(record.price)}万円 / 坪単価 ${formatNumber(record.unitPrice)}万円</span>
      ${type === "changed" ? `<span>前回 ${formatNumber(record.previousMatchedPrice)}万円 → 今回 ${formatNumber(record.price)}万円</span>` : ""}
    </div>
  `).join("");
}

function renderTable(selector, records) {
  const table = $(selector);
  const columns = [
    ["判定", "comparisonStatus"],
    ["物件名", "name"],
    ["所在地", "address"],
    ["価格", "price", "num"],
    ["土地面積", "landArea", "num"],
    ["建物面積", "buildingArea", "num"],
    ["専有面積", "exclusiveArea", "num"],
    ["築年数", "age", "num"],
    ["坪単価", "unitPrice", "num"],
    ["取引状況", "status"],
    ["登録日", "registeredDate"],
    ["備考", "note"]
  ];
  table.querySelector("thead").innerHTML = `<tr>${columns.map(([label, , cls]) => `<th class="${cls || ""}">${label}</th>`).join("")}</tr>`;
  table.querySelector("tbody").innerHTML = records.map((record) => {
    const rowClass = record.comparisonStatus === "new" ? "status-new" : record.comparisonStatus === "changed" ? "status-changed" : record.comparisonStatus === "ended" ? "status-ended" : "";
    return `<tr class="${rowClass}">${columns.map(([, key, cls]) => {
      if (key === "comparisonStatus") return `<td>${statusBadge(record.comparisonStatus)}</td>`;
      const value = record[key];
      return `<td class="${cls || ""}">${formatCell(key, value)}</td>`;
    }).join("")}</tr>`;
  }).join("");
}

function statusBadge(status) {
  const labels = { new: "新規", changed: "価格変更", ended: "掲載終了候補", same: "継続" };
  return `<span class="badge ${status}">${labels[status] || status}</span>`;
}

function formatCell(key, value) {
  if (["price", "unitPrice"].includes(key)) return `${formatNumber(value)}万円`;
  if (["landArea", "buildingArea", "exclusiveArea"].includes(key)) return value ? `${formatNumber(value)}坪` : "";
  if (key === "age") return value ? `${formatNumber(value)}年` : "";
  return escapeHtml(value || "");
}

function renderMap() {
  const mapElement = $("#map");
  if (!mapElement) return;
  if (!window.L) {
    mapElement.innerHTML = '<div class="empty-visual">Leafletを読み込めませんでした。インターネット接続またはCDNの読み込み設定を確認してください。</div>';
    return;
  }
  const points = state.compared.filter((record) => record.lat && record.lng && record.comparisonStatus !== "ended");
  if (!state.map) {
    state.map = L.map("map", { scrollWheelZoom: false }).setView([35.681236, 139.767125], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(state.map);
  }
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
  points.forEach((record) => {
    const color = record.ownBrokerage ? "#111111" : record.comparisonStatus === "changed" ? "#d6a700" : statusColor(record.status);
    const marker = L.marker([record.lat, record.lng], {
      draggable: true,
      icon: L.divIcon({
        className: "market-marker-shell",
        iconSize: [record.ownBrokerage ? 22 : 16, record.ownBrokerage ? 22 : 16],
        iconAnchor: [record.ownBrokerage ? 11 : 8, record.ownBrokerage ? 11 : 8],
        html: `<span class="market-marker${record.ownBrokerage ? " own" : ""}" style="--marker-color:${color}"></span>`
      })
    }).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(record.name || record.address)}</strong><br>${formatNumber(record.price)}万円<br>坪単価 ${formatNumber(record.unitPrice)}万円`);
    marker.on("dragend", () => {
      const position = marker.getLatLng();
      const key = getRecordKey(record);
      const updatedPosition = {
        lat: Number(position.lat.toFixed(6)),
        lng: Number(position.lng.toFixed(6))
      };
      state.positionAdjustments[key] = updatedPosition;
      state.current.filter((item) => getRecordKey(item) === key).forEach((item) => Object.assign(item, updatedPosition));
      state.compared.filter((item) => getRecordKey(item) === key).forEach((item) => Object.assign(item, updatedPosition));
    });
    state.markers.push(marker);
  });
  if (points.length) {
    state.map.fitBounds(points.map((record) => [record.lat, record.lng]), { padding: [24, 24] });
  }
  setTimeout(() => state.map.invalidateSize(), 120);
}

function renderChart() {
  const canvas = $("#scatterChart");
  if (!canvas) return;
  const chartBox = canvas.closest(".chart-box");
  if (!window.Chart) {
    if (chartBox) {
      chartBox.innerHTML = '<div class="empty-visual">Chart.jsを読み込めませんでした。インターネット接続またはCDNの読み込み設定を確認してください。</div>';
    }
    return;
  }
  if (!canvas.isConnected) return;
  const [xKey, yKey] = $("#chartMode").value.split(":");
  const records = state.compared.filter((record) => record.comparisonStatus !== "ended" || record.status.includes("成約") || record.status.includes("終了"));
  const datasets = records.map((record) => ({
    label: record.name || record.address || "物件",
    data: [{ x: record[xKey], y: record[yKey] }],
    pointRadius: record.ownBrokerage ? 9 : record.comparisonStatus === "changed" ? 8 : 6,
    pointHoverRadius: record.ownBrokerage ? 11 : 8,
    pointBackgroundColor: record.comparisonStatus === "changed" ? "#ffd968" : statusColor(record.status),
    pointBorderColor: record.ownBrokerage ? "#111111" : "rgba(16, 35, 63, 0.35)",
    pointBorderWidth: record.ownBrokerage ? 3 : 1.5
  })).filter((dataset) => dataset.data[0].x > 0 && dataset.data[0].y > 0);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(canvas, {
    type: "scatter",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            padding: 18
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${formatNumber(context.parsed.x)} / ${formatNumber(context.parsed.y)}`
          }
        }
      },
      scales: {
        x: { title: { display: true, text: axisLabel(xKey) }, grid: { color: "#e8edf4" } },
        y: { title: { display: true, text: axisLabel(yKey) }, grid: { color: "#e8edf4" } }
      }
    }
  });
}

function statusColor(status) {
  if (String(status).includes("成約")) return "#9bd3f5";
  if (String(status).includes("終了")) return "#9ca3af";
  return "#d9423a";
}

function axisLabel(key) {
  return {
    landArea: "土地面積（坪）",
    buildingArea: "建物面積（坪）",
    exclusiveArea: "専有面積（坪）",
    age: "築年数",
    price: "価格（万円）",
    unitPrice: "坪単価（万円）"
  }[key] || key;
}

function syncBlocks() {
  $$("[data-block]").forEach((checkbox) => {
    const block = $(`[data-report-block="${checkbox.dataset.block}"]`);
    if (block) block.hidden = !checkbox.checked;
  });
}

function exportJson() {
  processData();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    propertyType: state.propertyType,
    defaults: getDefaults(),
    records: state.current
  };
  $("#exportArea").value = JSON.stringify(payload, null, 2);
}

function downloadJson() {
  if (!$("#exportArea").value.trim()) exportJson();
  const blob = new Blob([$("#exportArea").value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `market-report-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importPreviousJson() {
  try {
    const parsed = JSON.parse($("#importArea").value);
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records)) throw new Error("recordsが見つかりません。");
    state.previous = records.map(recordFromJson);
    $("#importStatus").textContent = `前回データ ${state.previous.length}件を読み込みました。`;
    processData();
    showView("reportView");
  } catch (error) {
    $("#importStatus").textContent = `読み込みエラー: ${error.message}`;
  }
}

function restoreCurrentJson() {
  try {
    const parsed = JSON.parse($("#importArea").value);
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records)) throw new Error("復元する物件データが見つかりません。");
    if (parsed.propertyType && TYPE_LABELS[parsed.propertyType]) {
      $("#propertyType").value = parsed.propertyType;
      state.propertyType = parsed.propertyType;
      refreshChartMode();
    }
    if (parsed.defaults) {
      $("#defaultBuildingUnitPrice").value = parsed.defaults.buildingUnitPrice ?? $("#defaultBuildingUnitPrice").value;
      $("#defaultRenovationCost").value = parsed.defaults.renovationCost ?? $("#defaultRenovationCost").value;
      $("#defaultDepreciationYears").value = parsed.defaults.depreciationYears ?? $("#defaultDepreciationYears").value;
    }
    state.adjustments = {};
    state.positionAdjustments = {};
    $("#pasteArea").value = recordsToPaste(records.map(recordFromJson));
    processData();
    $("#importStatus").textContent = `現在データ ${records.length}件を復元しました。`;
    showView("reportView");
  } catch (error) {
    $("#importStatus").textContent = `復元エラー: ${error.message}`;
  }
}

function recordsToPaste(records) {
  const rows = records.map((record) => [
    record.name,
    record.address,
    record.lat,
    record.lng,
    record.price,
    record.landArea,
    record.buildingArea,
    record.exclusiveArea,
    record.age,
    record.registeredDate,
    record.url,
    record.status,
    record.previousPrice,
    record.currentPrice,
    record.depreciationYears,
    record.buildingUnitPrice,
    record.renovationCost,
    record.note,
    record.ownBrokerage ? "1" : ""
  ]);
  return [HEADERS, ...rows].map((row) => row.map((value) => String(value ?? "").replace(/\t|\r?\n/g, " ")).join("\t")).join("\n");
}

function recordFromJson(record) {
  if (!("name" in record) && !("address" in record)) return normalizeRecord(record);
  const restored = {
    name: textValue(record.name),
    address: textValue(record.address),
    lat: numberValue(record.lat),
    lng: numberValue(record.lng),
    price: numberValue(record.price || record.currentPrice),
    landArea: numberValue(record.landArea),
    buildingArea: numberValue(record.buildingArea),
    exclusiveArea: numberValue(record.exclusiveArea),
    age: numberValue(record.age),
    registeredDate: textValue(record.registeredDate),
    url: textValue(record.url),
    status: textValue(record.status) || "販売中",
    previousPrice: numberValue(record.previousPrice),
    currentPrice: numberValue(record.currentPrice || record.price),
    depreciationYears: numberValue(record.depreciationYears) || getDefaults().depreciationYears,
    buildingUnitPrice: numberValue(record.buildingUnitPrice) || getDefaults().buildingUnitPrice,
    renovationCost: numberValue(record.renovationCost) || getDefaults().renovationCost,
    note: textValue(record.note),
    ownBrokerage: Boolean(record.ownBrokerage)
  };
  restored.unitPrice = numberValue(record.unitPrice) || calculateUnitPrice(restored);
  restored.matchKeys = createMatchKeys(restored);
  return restored;
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "0";
  return number.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
