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
  "自社媒介フラグ",
  "沿線駅"
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
  addedRecords: [],
  previous: [],
  compared: [],
  adjustments: {},
  positionAdjustments: {},
  geocodingKeys: new Set(),
  tableEdits: {},
  priceChangeFlags: {},
  selectedAdjustmentKey: "",
  map: null,
  markers: [],
  chart: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
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
    state.addedRecords = [];
    state.tableEdits = {};
    state.priceChangeFlags = {};
    processData();
  });
  $("#addCaseButton")?.addEventListener("click", () => {
    const incomingRecords = parsePastedData($("#pasteArea").value);
    if (!incomingRecords.length) return;
    incomingRecords.forEach((record, index) => {
      const normalized = normalizeRecord({ ...record, __recordId: createRecordId(record, state.addedRecords.length + index) });
      const matchingRecord = state.current.find((current) => current.address.replace(/\s/g, "") === normalized.address.replace(/\s/g, "") && current.landArea > 0 && Math.abs(current.landArea - normalized.landArea) < 0.001);
      if (matchingRecord && matchingRecord.price !== normalized.price) record.__priceChanged = true;
    });
    state.addedRecords.push(...incomingRecords);
    $("#pasteArea").value = "";
    processData();
    showView("reportView");
  });
  $("#addTargetButton")?.addEventListener("click", () => {
    state.addedRecords.push({
      __recordId: `target-${Date.now()}`,
      "物件名": "",
      "所在地": "",
      "沿線駅": "",
      "価格": "",
      "土地面積": "",
      "建物面積": "",
      "専有面積": "",
      "築年数": "",
      "登録日": new Date().toLocaleDateString("ja-JP"),
      "取引状況": "対象物件"
    });
    processData();
    showView("reportView");
  });
  $("#printButton").addEventListener("click", () => {
    processData();
    showView("reportView");
    setTimeout(() => window.print(), 150);
  });
  $("#exportButton").addEventListener("click", downloadJson);
  $("#downloadButton").addEventListener("click", downloadJson);
  $("#importTopButton")?.addEventListener("click", () => $("#importFile")?.click());
  $("#importFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      $("#importArea").value = await file.text();
      restoreCurrentJson();
    }
  });
  $("#importButton").addEventListener("click", importPreviousJson);
  $("#restoreButton")?.addEventListener("click", restoreCurrentJson);
  $("#resetPreviousButton").addEventListener("click", () => {
    state.previous = [];
    $("#importArea").value = "";
    $("#importStatus").textContent = "前回データ未読込";
    processData();
  });
  $("#chartMode").addEventListener("change", () => renderChart());
  $("#showPriceChange")?.addEventListener("change", renderReport);
  $("#geocodeButton")?.addEventListener("click", geocodeMissingRecords);
  $("#reportTable")?.addEventListener("change", handleTableChange);
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
  const pendingRecords = parsePastedData($("#pasteArea").value);
  const sourceRecords = [...state.addedRecords, ...pendingRecords].map((record, index) => ({
    ...record,
    __recordId: record.__recordId || createRecordId(record, index)
  }));
  state.current = sourceRecords
    .map(normalizeRecord)
    .map(applyRecordAdjustment)
    .map(applyTableEdits)
    .map(applyRecordPosition);
  state.compared = compareRecords(state.current, state.previous)
    .map(applyTableEdits)
    .sort((a, b) => Number(normalizeStatus(b.status) === "対象物件") - Number(normalizeStatus(a.status) === "対象物件"));
  let nextNo = 1;
  state.compared.forEach((record) => {
    record.no = normalizeStatus(record.status) === "対象物件" ? "" : nextNo++;
    const key = getRecordKey(record);
    if (!(key in state.priceChangeFlags)) {
      state.priceChangeFlags[key] = record.priceChanged || record.comparisonStatus === "changed";
    }
  });
  renderAdjustmentControls();
  renderPreview();
  renderReport();
  syncBlocks();
  geocodeMissingRecords();
}

function getRecordKey(record) {
  return record.recordId || record.matchKeys[0] || `${record.address}|${record.name}`;
}

function createRecordId(record, index) {
  return [record["物件名"], record["所在地"], record["登録日"], record["価格"] || record["今回価格"], index].join("|");
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

function applyTableEdits(record) {
  const edits = state.tableEdits[getRecordKey(record)];
  if (!edits) return record;
  const updated = { ...record, ...edits };
  ["price", "landArea", "buildingArea", "exclusiveArea", "age"].forEach((field) => {
    if (field in edits) updated[field] = numberValue(edits[field]);
  });
  updated.currentPrice = updated.price;
  updated.matchKeys = createMatchKeys(updated);
  updated.unitPrice = calculateUnitPrice(updated);
  return updated;
}

function handleTableChange(event) {
  const target = event.target;
  const key = target.dataset.recordKey;
  if (!key) return;
  if (target.dataset.priceChange) {
    state.priceChangeFlags[key] = target.checked;
    renderMetrics();
    return;
  }
  const field = target.dataset.editField;
  if (!field) return;
  state.tableEdits[key] = { ...(state.tableEdits[key] || {}), [field]: target.value };
  processData();
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
  const lines = text.split("\n").map((line) => cleanExtractedValue(line)).filter(Boolean);
  const get = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return cleanExtractedValue(match[1]);
    }
    return "";
  };

  const getAfterLabel = (labels, valuePattern = null) => {
    for (let index = 0; index < lines.length; index += 1) {
      if (!labels.some((label) => lines[index] === label)) continue;
      for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 8); nextIndex += 1) {
        const candidate = lines[nextIndex];
        if (labels.some((label) => candidate === label)) continue;
        if (!valuePattern || valuePattern.test(candidate)) return candidate;
      }
    }
    return "";
  };

  const getImmediateValue = (label) => {
    const index = lines.indexOf(label);
    const candidate = index >= 0 ? lines[index + 1] || "" : "";
    return /^(その他所在地表示|交通|交通１|交通２|交通３|沿線名|駅名)$/.test(candidate) ? "" : candidate;
  };

  const propertyNumber = getAfterLabel(["物件番号"], /^\d+$/);
  const prefecture = getImmediateValue("都道府県名");
  const address1 = getImmediateValue("所在地名１");
  const address2 = getImmediateValue("所在地名２");
  const address3 = getImmediateValue("所在地名３");
  const reinsAddress = [prefecture, address1, address2, address3].filter(Boolean).join("");
  const reinsPrice = getAfterLabel(["価格"], /^[0-9,\.]+万円$/);
  const reinsContractPrice = getAfterLabel(["成約価格"], /^[0-9,\.]+万円$/);
  const reinsLandArea = getAfterLabel(["土地面積", "（私道を含まず）"], /^[0-9,\.]+(?:㎡|m2|平米|坪)$/);
  const reinsBuildingArea = getAfterLabel(["建物面積", "延床面積"], /^[0-9,\.]+(?:㎡|m2|平米|坪)$/);
  const reinsExclusiveArea = getAfterLabel(["専有面積"], /^[0-9,\.]+(?:㎡|m2|平米|坪)$/);
  const propertyType = getAfterLabel(["物件種目"], /.+/);
  const reinsRegisteredDate = getAfterLabel(["登録年月日"], /.+/);
  const reinsContractDate = getAfterLabel(["成約年月日"], /.+/);
  const reinsBuiltDate = getAfterLabel(["築年月"], /^\d{4}年/);
  const reinsStatus = reinsContractPrice || reinsContractDate ? "成約" : "販売中";
  const reinsLine = getAfterLabel(["沿線名"], /.+/);
  const reinsStation = getAfterLabel(["駅名"], /.+/);

  record["物件名"] = get([/(?:物件名|名称|建物名|マンション名)\s*[:：]?\s*([^\n]+)/]) || (reinsAddress ? `${propertyType || "REINS"} ${reinsAddress}` : (propertyNumber ? `${propertyType || "REINS"} ${propertyNumber}` : propertyType));
  record["所在地"] = reinsAddress || get([/(?:所在地|住所|物件所在地)\s*[:：]?\s*([^\n]+)/]);
  record["価格"] = reinsContractPrice || reinsPrice || get([/(?:販売価格|成約価格|価格|物件価格)\s*[:：]?\s*([0-9,\.]+)\s*(?:万円|円)?/]);
  record["土地面積"] = areaValue(reinsLandArea || get([/(?:土地面積|敷地面積)\s*[:：]?\s*([0-9,\.]+\s*(?:㎡|m2|平米|坪)?)/]));
  record["建物面積"] = areaValue(reinsBuildingArea || get([/(?:建物面積|延床面積)\s*[:：]?\s*([0-9,\.]+\s*(?:㎡|m2|平米|坪)?)/]));
  record["専有面積"] = areaValue(reinsExclusiveArea || get([/(?:専有面積|専有)\s*[:：]?\s*([0-9,\.]+\s*(?:㎡|m2|平米|坪)?)/]));
  record["築年数"] = ageValue(get([/(?:築年数|築後年数)\s*[:：]?\s*([0-9,\.]+)\s*年?/, /築\s*([0-9,\.]+)\s*年/])) || ageFromBuiltDate(reinsBuiltDate);
  record["登録日"] = reinsRegisteredDate || get([/(?:登録日|掲載日|情報登録日|公開日)\s*[:：]?\s*([0-9\/\-.年月日]+)/]);
  record["物件URL"] = get([/(https?:\/\/[^\s]+)/]);
  record["取引状況"] = reinsStatus || get([/(?:取引状況|状態|販売状況)\s*[:：]?\s*([^\n]+)/]) || "販売中";
  record["沿線駅"] = [reinsLine, reinsStation].filter(Boolean).join(" ");
  record["前回価格"] = get([/(?:前回価格)\s*[:：]?\s*([0-9,\.]+)\s*(?:万円|円)?/]);
  record["今回価格"] = get([/(?:今回価格)\s*[:：]?\s*([0-9,\.]+)\s*(?:万円|円)?/]);
  record["建物減価償却年数"] = get([/(?:建物減価償却年数|減価償却年数)\s*[:：]?\s*([0-9,\.]+)/]);
  record["建物坪単価"] = get([/(?:建物坪単価)\s*[:：]?\s*([0-9,\.]+)/]);
  record["リフォーム費用"] = get([/(?:リフォーム費用)\s*[:：]?\s*([0-9,\.]+)/]);
  record["備考"] = get([/(?:備考|コメント|メモ)\s*[:：]?\s*([^\n]+)/]) || (propertyNumber ? `物件番号: ${propertyNumber}` : "");
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

function ageFromBuiltDate(value) {
  const match = String(value ?? "").match(/(\d{4})年/);
  return match ? String(Math.max(0, new Date().getFullYear() - Number(match[1]))) : "";
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
    recordId: raw.__recordId || "",
    name: textValue(raw["物件名"]),
    address: textValue(raw["所在地"]),
    station: textValue(raw["沿線駅"]),
    lat: numberValue(raw["緯度"]),
    lng: numberValue(raw["経度"]),
    price: numberValue(raw["今回価格"]) || numberValue(raw["価格"]),
    landArea: numberValue(raw["土地面積"]),
    buildingArea: numberValue(raw["建物面積"]),
    exclusiveArea: numberValue(raw["専有面積"]),
    age: numberValue(raw["築年数"]),
    registeredDate: textValue(raw["登録日"]),
    url: textValue(raw["物件URL"]),
    status: normalizeStatus(raw["取引状況"]),
    previousPrice: numberValue(raw["前回価格"]),
    currentPrice: numberValue(raw["今回価格"]) || numberValue(raw["価格"]),
    depreciationYears: numberValue(raw["建物減価償却年数"]) || defaults.depreciationYears,
    buildingUnitPrice: numberValue(raw["建物坪単価"]) || defaults.buildingUnitPrice,
    renovationCost: numberValue(raw["リフォーム費用"]) || defaults.renovationCost,
    note: textValue(raw["備考"]),
    ownBrokerage: isTruthy(raw["自社媒介フラグ"]),
    priceChanged: Boolean(raw.__priceChanged)
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

function normalizeStatus(value) {
  const status = String(value ?? "");
  if (status.includes("対象")) return "対象物件";
  return status.includes("成約") ? "成約物件" : "売出物件";
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
      compared.push({ ...record, status: "成約物件", comparisonStatus: "ended" });
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
  const saleCount = state.compared.filter((record) => normalizeStatus(record.status) === "売出物件").length;
  const contractCount = state.compared.filter((record) => normalizeStatus(record.status) === "成約物件").length;
  const shouldShowPriceChange = $("#showPriceChange")?.checked;
  const changedCount = shouldShowPriceChange ? state.compared.filter((record) => state.priceChangeFlags[getRecordKey(record)]).length : 0;
  $("#metrics").innerHTML = [
    metricHtml("売出物件数", `${saleCount}件`),
    metricHtml("成約物件数", `${contractCount}件`),
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
  const isReportTable = selector === "#reportTable";
  const showPriceChange = isReportTable && $("#showPriceChange")?.checked;
  const columns = [
    ["No", "no", "num"],
    ["ステータス", "status"],
    ...(state.propertyType === "mansion" ? [["物件名", "name"]] : []),
    ["所在地", "address"],
    ["沿線駅", "station"],
    ["価格", "price", "num"],
    ...(showPriceChange ? [["価格変更", "priceChange"]] : []),
    ["土地面積", "landArea", "num"],
    ["建物面積", "buildingArea", "num"],
    ...(state.propertyType === "mansion" ? [["専有面積", "exclusiveArea", "num"]] : []),
    ["築年数", "age", "num"],
    ["坪単価", "unitPrice", "num"],
    ["登録日", "registeredDate"]
  ];
  table.querySelector("thead").innerHTML = `<tr>${columns.map(([label, , cls]) => `<th class="${cls || ""}">${label}</th>`).join("")}</tr>`;
  table.querySelector("tbody").innerHTML = records.map((record) => {
    const recordKey = escapeHtml(getRecordKey(record));
    const rowClass = record.comparisonStatus === "new" ? "status-new" : state.priceChangeFlags[getRecordKey(record)] ? "status-changed" : record.comparisonStatus === "ended" ? "status-ended" : "";
    return `<tr class="${rowClass}">${columns.map(([label, key, cls]) => {
      if (key === "priceChange") return `<td data-label="${label}"><input class="table-checkbox" type="checkbox" data-price-change="true" data-record-key="${recordKey}"${state.priceChangeFlags[getRecordKey(record)] ? " checked" : ""}></td>`;
      if (key === "status") {
        const status = normalizeStatus(record.status);
        if (isReportTable) return `<td data-label="${label}"><select class="table-select" data-edit-field="status" data-record-key="${recordKey}"><option value="対象物件"${status === "対象物件" ? " selected" : ""}>対象物件</option><option value="売出物件"${status === "売出物件" ? " selected" : ""}>売出物件</option><option value="成約物件"${status === "成約物件" ? " selected" : ""}>成約物件</option></select></td>`;
        return `<td data-label="${label}">${escapeHtml(status)}</td>`;
      }
      const value = record[key];
      if (isReportTable && ["name", "address", "station", "price", "landArea", "buildingArea", "exclusiveArea", "age", "registeredDate"].includes(key)) {
        const inputType = ["price", "landArea", "buildingArea", "exclusiveArea", "age"].includes(key) ? "number" : "text";
        const step = inputType === "number" ? " step=\"any\"" : "";
        const unit = key === "price" ? "万円" : ["landArea", "buildingArea", "exclusiveArea"].includes(key) ? "坪" : key === "age" ? "年" : "";
        return `<td class="${cls || ""}" data-label="${label}"><span class="table-editor"><input class="table-input" type="${inputType}"${step} data-edit-field="${key}" data-record-key="${recordKey}" value="${escapeHtml(value ?? "")}">${unit ? `<span class="table-unit">${unit}</span>` : ""}</span></td>`;
      }
      return `<td class="${cls || ""}" data-label="${label}">${formatCell(key, value)}</td>`;
    }).join("")}</tr>`;
  }).join("");
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
  const points = state.compared.filter((record) => record.lat && record.lng);
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
    const color = record.ownBrokerage ? "#111111" : state.priceChangeFlags[getRecordKey(record)] ? "#d6a700" : record.comparisonStatus === "ended" ? "#9ca3af" : statusColor(record.status);
    const markerLabel = record.no || "対象";
    const marker = L.marker([record.lat, record.lng], {
      draggable: true,
      icon: L.divIcon({
        className: "market-marker-shell",
        iconSize: [record.ownBrokerage ? 30 : 26, record.ownBrokerage ? 30 : 26],
        iconAnchor: [record.ownBrokerage ? 15 : 13, record.ownBrokerage ? 15 : 13],
        html: `<span class="market-marker${record.ownBrokerage ? " own" : ""}" style="--marker-color:${color}">${markerLabel}</span>`
      })
    }).addTo(state.map);
    marker.bindPopup(`<strong>${record.no ? `No.${record.no}` : "対象"} ${escapeHtml(record.name || record.address)}</strong><br>${formatNumber(record.price)}万円<br>坪単価 ${formatNumber(record.unitPrice)}万円`);
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

async function geocodeMissingRecords() {
  const targets = state.current.filter((record) => {
    const key = getRecordKey(record);
    return !record.lat && !record.lng && record.address && !state.geocodingKeys.has(key);
  });
  for (const record of targets) {
    const key = getRecordKey(record);
    state.geocodingKeys.add(key);
    try {
      const endpoint = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&q=${encodeURIComponent(record.address)}`;
      const response = await fetch(endpoint);
      const results = response.ok ? await response.json() : [];
      if (results[0]) {
        state.positionAdjustments[key] = {
          lat: Number(Number(results[0].lat).toFixed(6)),
          lng: Number(Number(results[0].lon).toFixed(6))
        };
        processData();
      }
    } catch (error) {
      // Keep the record without a map pin when address lookup is unavailable.
    } finally {
      state.geocodingKeys.delete(key);
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
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
    records: state.current.map((record) => ({
      ...record,
      priceChanged: Boolean(state.priceChangeFlags[getRecordKey(record)])
    }))
  };
  $("#exportArea").value = JSON.stringify(payload, null, 2);
}

function downloadJson() {
  exportJson();
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
    state.addedRecords = [];
    state.tableEdits = {};
    state.priceChangeFlags = {};
    $("#pasteArea").value = recordsToPaste(records.map(recordFromJson));
    processData();
    state.current.forEach((record, index) => {
      state.priceChangeFlags[getRecordKey(record)] = Boolean(records[index]?.priceChanged);
    });
    renderReport();
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
    record.ownBrokerage ? "1" : "",
    record.station
  ]);
  return [HEADERS, ...rows].map((row) => row.map((value) => String(value ?? "").replace(/\t|\r?\n/g, " ")).join("\t")).join("\n");
}

function recordFromJson(record) {
  if (!("name" in record) && !("address" in record)) return normalizeRecord(record);
  const restored = {
    name: textValue(record.name),
    address: textValue(record.address),
    station: textValue(record.station),
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
  return number.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
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
