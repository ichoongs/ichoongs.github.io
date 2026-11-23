(() => {
  "use strict";

  const SIMULATION_COUNT = 1000;
  const RECOMMENDATION_LIMIT = 23.9;
  const EXAM_CORRELATION = 0.8;
  const ITEM_GROUPS = [
    { type: "선택형", level: 0, label: "쉬움" },
    { type: "선택형", level: 1, label: "보통" },
    { type: "선택형", level: 2, label: "어려움" },
    { type: "서답형", level: 0, label: "쉬움" },
    { type: "서답형", level: 1, label: "보통" },
    { type: "서답형", level: 2, label: "어려움" },
  ];
  const RATE_COLUMNS = ["A", "B", "C", "D"];
  const rateCache = new Map();
  const BOUNDARIES = [
    { key: "AB", label: "A/B", area: "area-ab" },
    { key: "BC", label: "B/C", area: "area-bc" },
    { key: "CD", label: "C/D", area: "area-cd" },
    { key: "DE", label: "D/E", area: "area-de" },
  ];
  const GRADES = ["A", "B", "C", "D", "E"];
  const TEACHER_NAMES_KEY = "aRateTeacherNames";
  const state = {
    rows: [],
    columns: [],
    touchedWeights: new Set(),
    sourceFileName: "",
    lastReport: null,
    rateResult: null,
    teacherNames: loadTeacherNames(),
  };

  function loadTeacherNames() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TEACHER_NAMES_KEY) || "[]");
      return Array.isArray(saved) ? saved.map((name) => String(name ?? "")) : [];
    } catch (error) {
      return [];
    }
  }

  function saveTeacherNames() {
    try {
      window.localStorage.setItem(TEACHER_NAMES_KEY, JSON.stringify(state.teacherNames));
    } catch (error) {
      // 저장소를 쓸 수 없는 환경에서는 이번 화면에서만 이름을 유지한다
    }
  }

  // 입력 자동 저장: 설정값만 이 브라우저에 저장하고, 학생 점수 파일은 저장하지 않는다
  const INPUTS_KEY = "aRateSavedInputs";
  const SAVED_FIELD_IDS = [
    "exam1Max", "exam1Weight", "exam1AB", "exam1BC", "exam1CD", "exam1DE",
    "exam2Max", "exam2Weight", "exam2AB", "exam2BC", "exam2CD", "exam2DE",
    "teacherCount", "meanAdjustment",
  ];
  let saveTimer = null;

  function loadInputs() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(INPUTS_KEY) || "null");
      return saved && saved.version === 1 ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function collectInputs() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      fields: Object.fromEntries(SAVED_FIELD_IDS.map((id) => [id, $(id).value])),
      spreadFactor: document.querySelector('input[name="spreadFactor"]:checked')?.value,
      groupWeights: [...document.querySelectorAll(".group-weight")].map((input) => input.value),
      areas: [...document.querySelectorAll(".performance-area")].map((area) => ({
        name: area.querySelector(".area-name").value,
        max: area.querySelector(".area-max").value,
        weight: area.querySelector(".area-weight").value,
        ab: area.querySelector(".area-ab").value,
        bc: area.querySelector(".area-bc").value,
        cd: area.querySelector(".area-cd").value,
        de: area.querySelector(".area-de").value,
        expected: area.querySelector(".area-expected").value,
      })),
    };
  }

  function saveInputs() {
    try {
      const data = collectInputs();
      window.localStorage.setItem(INPUTS_KEY, JSON.stringify(data));
      renderSaveStatus(data);
    } catch (error) {
      renderSaveStatus(null, true);
    }
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveInputs, 400);
  }

  function restoreInputs(saved) {
    Object.entries(saved.fields || {}).forEach(([id, value]) => {
      if (SAVED_FIELD_IDS.includes(id) && $(id) && value !== undefined) $(id).value = value;
    });
    const spread = document.querySelector(`input[name="spreadFactor"][value="${saved.spreadFactor}"]`);
    if (spread) spread.checked = true;
    document.querySelectorAll(".group-weight").forEach((input, index) => {
      if (saved.groupWeights?.[index] !== undefined) input.value = saved.groupWeights[index];
    });
    $("exam2ABSlider").value = $("exam2AB").value;
    syncSimulationRange();
  }

  function renderSaveStatus(saved, failed = false) {
    const text = $("saveStatusText");
    if (failed) {
      text.textContent = "이 브라우저에서는 입력을 저장할 수 없습니다.";
      $("clearSaved").disabled = true;
      return;
    }
    if (saved) {
      const time = new Date(saved.savedAt).toLocaleString("ko-KR", {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      text.innerHTML = `<strong>자동 저장됨</strong> · ${escapeHtml(time)} · 이 브라우저에만 저장되며 점수 파일은 저장하지 않습니다.`;
    } else {
      text.textContent = "입력을 바꾸면 이 브라우저에 자동 저장됩니다. 점수 파일은 저장하지 않습니다.";
    }
    $("clearSaved").disabled = !saved && !state.teacherNames.some((name) => String(name || "").trim());
  }

  function clearSavedInputs() {
    const confirmed = window.confirm(
      "이 브라우저에 저장된 입력(평가 정보, 수행평가 영역, 2차 문항정보, 교사 이름 등)을 지우고 기본값으로 되돌릴까요?\n"
      + "되돌릴 수 없으며, 지금 불러온 점수도 화면에서 사라집니다."
    );
    if (!confirmed) return;
    window.clearTimeout(saveTimer);
    try {
      window.localStorage.removeItem(INPUTS_KEY);
      window.localStorage.removeItem(TEACHER_NAMES_KEY);
    } catch (error) {
      // 저장소를 쓸 수 없으면 지울 것도 없다
    }
    window.location.reload();
  }

  function teacherName(index) {
    return (state.teacherNames[index] || "").trim() || `교사 ${index + 1}`;
  }
  let renderTimer = null;

  const $ = (id) => document.getElementById(id);
  const numericIds = [
    "exam1Max", "exam2Max",
    "exam1AB", "exam1BC", "exam1CD", "exam1DE",
    "exam2AB", "exam2BC", "exam2CD", "exam2DE",
    "teacherCount",
    "meanAdjustment",
    "rangeStart", "rangeEnd", "rangeStep",
  ];

  function teacherCountValue() {
    const count = number("teacherCount");
    return Number.isInteger(count) && count >= 1 && count <= 20 ? count : NaN;
  }

  function groupWeights() {
    return [...document.querySelectorAll(".group-weight")].map((input) => finiteNumber(input.value));
  }

  function rateInputsReady(config) {
    const weights = config.groupWeights;
    return Number.isFinite(config.teacherCount)
      && weights.every((weight) => Number.isFinite(weight) && weight >= 0)
      && weights.some((weight) => weight > 0)
      && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - config.exam2Max) < 0.01
      && config.exam2Targets.every(Number.isFinite);
  }

  // 2차 목표 분할점수 → 교사별 예상정답률 세트와 그 평균(나이스 산출값). exam2ABTarget으로 A/B 목표만 바꿔 볼 수 있다.
  function rateSets(config, exam2ABTarget = config.exam2Targets[0]) {
    if (!config.rateReady || !Number.isFinite(exam2ABTarget)) return null;
    const targets = [exam2ABTarget, ...config.exam2Targets.slice(1)];
    const key = JSON.stringify([config.groupWeights, targets, config.teacherCount]);
    if (!rateCache.has(key)) {
      if (rateCache.size > 400) rateCache.clear();
      const groups = ITEM_GROUPS.map((group, index) => ({ ...group, weight: config.groupWeights[index] }));
      rateCache.set(key, window.RateSets.buildSets(groups, targets, config.teacherCount));
    }
    return rateCache.get(key);
  }

  function rateValidationMessage(config) {
    if (!Number.isFinite(config.teacherCount)) {
      return "담당 교사 수는 1~20명 사이의 정수로 입력해 주세요.";
    }
    const weights = config.groupWeights;
    if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
      return "2차 문항정보의 배점합은 0 이상의 숫자로 입력해 주세요. 해당 문항이 없으면 0을 넣으세요.";
    }
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - config.exam2Max) >= 0.01) {
      return `2차 문항정보 배점합 합계(${formatCut(total)}점)가 2차 만점(${formatCut(config.exam2Max)}점)과 같아야 합니다.`;
    }
    return "";
  }

  function achievedAB(config, target) {
    return rateSets(config, target)?.average[0] ?? NaN;
  }

  function formatCut(value) {
    if (!Number.isFinite(value)) return "-";
    const rounded = Math.round(value);
    return Math.abs(value - rounded) < 1e-6 ? format(rounded, 0) : format(value, 2);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function number(id) {
    return finiteNumber($(id).value);
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function scheduleRender(delay = 180) {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, delay);
  }

  function centeredSimulationRange(cut, maximum, halfWidth = 10) {
    if (![cut, maximum].every(Number.isFinite) || maximum <= 0) return null;
    const center = clamp(cut, 0, maximum);
    const span = Math.min(halfWidth, center, maximum - center);
    return {
      start: Number((center - span).toFixed(2)),
      end: Number((center + span).toFixed(2)),
    };
  }

  function syncSimulationRange(cut = number("exam2AB")) {
    const range = centeredSimulationRange(cut, number("exam2Max"));
    if (!range) return;
    $("rangeStart").value = range.start;
    $("rangeEnd").value = range.end;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const input = text.replace(/^\uFEFF/, "");

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (char === '"') {
        if (quoted && input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        row.push(cell.trim());
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);
    if (rows.length < 2) throw new Error("헤더와 학생 데이터가 필요합니다.");
    return rows;
  }

  function normalizeTable(matrix, scoreKey) {
    const nonEmptyRows = matrix.filter((row) =>
      row.some((value) => String(value ?? "").trim() !== "")
    );
    const matrixHeaderIndex = nonEmptyRows.findIndex((row) => {
      const first = String(row[0] ?? "").replace(/\s/g, "");
      const classCount = row.slice(1).filter((value) => Number.isFinite(finiteNumber(value))).length;
      return first.includes("반번호") && classCount >= 2;
    });

    if (matrixHeaderIndex >= 0) {
      const header = nonEmptyRows[matrixHeaderIndex];
      const classes = header.slice(1).map((value, index) => ({
        column: index + 1,
        label: String(value ?? "").trim(),
      })).filter((item) => item.label !== "" && Number.isFinite(finiteNumber(item.label)));
      const rows = [];

      for (const sourceRow of nonEmptyRows.slice(matrixHeaderIndex + 1)) {
        const studentNumber = finiteNumber(sourceRow[0]);
        if (!Number.isFinite(studentNumber)) break;
        classes.forEach(({ column, label }) => {
          const score = finiteNumber(sourceRow[column]);
          if (Number.isFinite(score)) {
            rows.push({
              studentId: `${label}반-${studentNumber}번`,
              [scoreKey]: score,
            });
          }
        });
      }
      if (!rows.length) throw new Error("교차표에서 유효한 점수를 찾지 못했습니다.");
      return {
        rows,
        format: `반×번호 교차표 자동 인식 · ${classes.length}개 반`,
      };
    }

    const headerIndex = nonEmptyRows.findIndex((row) =>
      row.filter((value) => String(value ?? "").trim() !== "").length >= 2
    );
    if (headerIndex < 0 || headerIndex === nonEmptyRows.length - 1) {
      throw new Error("헤더와 학생 데이터가 필요합니다.");
    }
    const headers = nonEmptyRows[headerIndex].map((header, index) =>
      String(header ?? "").trim() || `column_${index + 1}`
    );
    return {
      rows: nonEmptyRows.slice(headerIndex + 1).map((values) =>
        Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
      ),
      format: "행 단위 명단형",
    };
  }

  function repairSheetRange(sheet) {
    const addresses = Object.keys(sheet).filter((key) => !key.startsWith("!"));
    if (!addresses.length) return;
    const cells = addresses.map((address) => XLSX.utils.decode_cell(address));
    const range = cells.reduce((result, cell) => ({
      s: { r: Math.min(result.s.r, cell.r), c: Math.min(result.s.c, cell.c) },
      e: { r: Math.max(result.e.r, cell.r), c: Math.max(result.e.c, cell.c) },
    }), { s: { r: Infinity, c: Infinity }, e: { r: 0, c: 0 } });
    sheet["!ref"] = XLSX.utils.encode_range(range);
  }

  async function readFile(file, scoreKey) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (extension === "csv") return normalizeTable(parseCsv(await file.text()), scoreKey);
    if (!["xlsx", "xls"].includes(extension)) {
      throw new Error("CSV 또는 Excel 파일만 사용할 수 있습니다.");
    }
    if (!window.XLSX) {
      throw new Error("Excel 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV를 사용하세요.");
    }
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    if (!workbook.SheetNames.length) throw new Error("읽을 수 있는 시트가 없습니다.");
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    repairSheetRange(sheet);
    return normalizeTable(
      XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }),
      scoreKey
    );
  }

  function findColumn(columns, candidates) {
    const lower = columns.map((column) => column.toLowerCase().replace(/\s/g, ""));
    const index = lower.findIndex((column) => candidates.includes(column));
    return index >= 0 ? columns[index] : "";
  }

  function setOptions(select, columns, includeBlank = false) {
    select.innerHTML = includeBlank ? '<option value="">선택 안 함</option>' : "";
    columns.forEach((column) => {
      const option = document.createElement("option");
      option.value = column;
      option.textContent = column;
      select.append(option);
    });
  }

  function showStatus(id, message, error = false) {
    const element = $(id);
    element.hidden = false;
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function loadExamRows(rows, fileName, formatLabel = "행 단위 명단형") {
    if (!rows.length) throw new Error("학생 데이터가 없습니다.");
    state.columns = Object.keys(rows[0]);
    const idColumn = findColumn(
      state.columns, ["studentid", "student_id", "id", "학번", "학생식별값"]
    ) || state.columns[0];
    const scoreColumn = findColumn(
      state.columns, ["exam1", "1차", "1차점수", "1차정기시험"]
    );
    if (!scoreColumn) {
      throw new Error("1차 점수 열을 자동으로 찾지 못했습니다. NEIS 교과목별 일람표를 사용해 주세요.");
    }
    state.rows = rows.flatMap((row, index) => {
      const exam1 = finiteNumber(row[scoreColumn]);
      if (!Number.isFinite(exam1)) return [];
      return [{
        studentId: normalizeId(row[idColumn]) || `row-${index + 1}`,
        exam1,
      }];
    });
    if (!state.rows.length) throw new Error("유효한 1차 점수를 찾지 못했습니다.");
    state.sourceFileName = fileName;
    state.lastReport = null;
    const stats = exam1Statistics(state.rows);
    $("scoreStats").hidden = false;
    $("exam1Count").textContent = state.rows.length.toLocaleString("ko-KR");
    $("exam1Mean").textContent = format(stats.mean, 1);
    $("exam1Sd").textContent = format(stats.sd, 1);
    showStatus("fileStatus", `${fileName} · ${formatLabel} · ${state.rows.length.toLocaleString("ko-KR")}명 자동 분석 완료`);
    render();
  }

  function settings() {
    const teacherCount = teacherCountValue();
    const performanceAreas = [...document.querySelectorAll(".performance-area")].map((area) => {
      const targets = BOUNDARIES.map((boundary) =>
        finiteNumber(area.querySelector(`.${boundary.area}`).value)
      );
      const cuts = targets;
      return {
        name: area.querySelector(".area-name").value.trim() || "수행평가",
        max: finiteNumber(area.querySelector(".area-max").value),
        weight: finiteNumber(area.querySelector(".area-weight").value),
        targets,
        cuts,
        ab: cuts[0],
        expected: finiteNumber(area.querySelector(".area-expected").value),
      };
    });
    const exam1Targets = BOUNDARIES.map((boundary) => number(`exam1${boundary.key}`));
    const exam2Targets = BOUNDARIES.map((boundary) => number(`exam2${boundary.key}`));
    const config = {
      teacherCount,
      groupWeights: groupWeights(),
      exam1Max: number("exam1Max"),
      exam2Max: number("exam2Max"),
      exam1Weight: number("exam1Weight"),
      exam2Weight: number("exam2Weight"),
      exam1Targets,
      exam2Targets,
      exam1Cuts: exam1Targets,
      exam1AB: exam1Targets[0],
      performanceAreas,
      meanAdjustment: number("meanAdjustment"),
      spreadFactor: Number(document.querySelector('input[name="spreadFactor"]:checked').value),
    };
    config.rateReady = rateInputsReady(config);
    config.rateResult = rateSets(config);
    // 2차는 교사별 예상정답률 평균(나이스 산출값)으로 계산한다
    config.exam2Cuts = config.rateResult ? config.rateResult.average : exam2Targets;
    config.exam2AB = config.exam2Cuts[0];
    return config;
  }

  function normalizeId(value) {
    return String(value ?? "").trim();
  }

  function cleanStudents(config) {
    return state.rows.flatMap((row, index) => {
      const id = normalizeId(row.studentId) || `row-${index + 1}`;
      const exam1 = finiteNumber(row.exam1);
      if (!Number.isFinite(exam1)) return [];
      return [{ id, exam1 }];
    });
  }

  function standardDeviation(values, mean) {
    if (values.length <= 1) return 0;
    return Math.sqrt(
      values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
    );
  }

  function exam1Statistics(students) {
    const mean = students.reduce((sum, student) => sum + student.exam1, 0) / students.length;
    const sd = standardDeviation(students.map((student) => student.exam1), mean);
    return { mean, sd };
  }

  function targetDistribution(students, config) {
    const stats = exam1Statistics(students);
    const scale = config.exam2Max / config.exam1Max;
    return {
      exam1Mean: stats.mean,
      exam1Sd: stats.sd,
      mean: clamp(stats.mean * scale + config.meanAdjustment, 0, config.exam2Max),
      sd: Math.max(0, stats.sd * scale * config.spreadFactor),
    };
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalRandom(random) {
    const u = Math.max(random(), Number.EPSILON);
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function buildTrialScores(students, config) {
    const random = seededRandom(20260612);
    const distribution = targetDistribution(students, config);
    const residualScale = Math.sqrt(1 - EXAM_CORRELATION ** 2);
    const performanceScore = config.performanceAreas.reduce((sum, area) =>
      sum + (clamp(area.expected, 0, area.max) / area.max * area.weight), 0
    );
    const fixedScores = students.map((student) =>
      (student.exam1 / config.exam1Max * config.exam1Weight)
      + performanceScore
    );
    return Array.from({ length: SIMULATION_COUNT }, () => {
      const latentScores = students.map((student) => {
        const zScore = distribution.exam1Sd > 0
          ? (student.exam1 - distribution.exam1Mean) / distribution.exam1Sd
          : 0;
        return EXAM_CORRELATION * zScore + residualScale * normalRandom(random);
      });
      const latentMean = latentScores.reduce((sum, value) => sum + value, 0) / latentScores.length;
      const latentSd = standardDeviation(latentScores, latentMean) || 1;
      return latentScores.map((latentScore, index) => {
        const exam2 = clamp(
          distribution.mean + distribution.sd * ((latentScore - latentMean) / latentSd),
          0,
          config.exam2Max
        );
        return fixedScores[index] + (exam2 / config.exam2Max * config.exam2Weight);
      }).sort((a, b) => a - b);
    });
  }

  function assessments(config) {
    return [
      { name: "1차 정기시험", max: config.exam1Max, targets: config.exam1Targets, cuts: config.exam1Cuts },
      { name: "2차 정기시험", max: config.exam2Max, targets: config.exam2Targets, cuts: config.exam2Cuts },
      ...config.performanceAreas.map((area) => ({
        name: area.name, max: area.max, targets: area.targets, cuts: area.cuts,
      })),
    ];
  }

  function finalCutAt(config, index, exam2Cut = config.exam2Cuts[index]) {
    const performanceCut = config.performanceAreas.reduce((sum, area) =>
      sum + (area.cuts[index] / area.max * area.weight), 0
    );
    return (config.exam1Cuts[index] / config.exam1Max * config.exam1Weight)
      + (exam2Cut / config.exam2Max * config.exam2Weight)
      + performanceCut;
  }

  function finalCut(config, exam2AB = config.exam2AB) {
    return finalCutAt(config, 0, exam2AB);
  }

  function lowerBound(sorted, target) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sorted[middle] < target - 1e-9) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function percentile(sorted, probability) {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(probability * (sorted.length - 1)))
    );
    return sorted[index];
  }

  function forecast(trialScores, config, exam2AB = config.exam2AB) {
    const cut = finalCut(config, exam2AB);
    const total = trialScores[0]?.length || 0;
    const rates = trialScores.map((scores) =>
      total ? ((total - lowerBound(scores, cut)) / total * 100) : 0
    ).sort((a, b) => a - b);
    const median = percentile(rates, 0.5);
    return {
      cut,
      total,
      median,
      lower: percentile(rates, 0.05),
      upper: percentile(rates, 0.95),
      exceedProbability: rates.filter((rate) => rate > RECOMMENDATION_LIMIT).length / rates.length * 100,
      medianCount: Math.round(median / 100 * total),
    };
  }

  function gradeForecast(trialScores, config) {
    const cuts = BOUNDARIES.map((_, index) => finalCutAt(config, index));
    const total = trialScores[0]?.length || 0;
    const ratesByGrade = GRADES.map(() => []);
    trialScores.forEach((scores) => {
      const below = cuts.map((cut) => lowerBound(scores, cut));
      const counts = [
        total - below[0],
        below[0] - below[1],
        below[1] - below[2],
        below[2] - below[3],
        below[3],
      ];
      counts.forEach((count, index) => ratesByGrade[index].push(total ? count / total * 100 : 0));
    });
    const grades = GRADES.map((grade, index) => {
      const rates = ratesByGrade[index].sort((a, b) => a - b);
      const median = percentile(rates, 0.5);
      return {
        grade,
        median,
        lower: percentile(rates, 0.05),
        upper: percentile(rates, 0.95),
        mean: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
        medianCount: Math.round(median / 100 * total),
      };
    });
    return { cuts, total, grades };
  }

  function forecastStatus(result) {
    if (result.upper <= RECOMMENDATION_LIMIT) {
      return { key: "safe", label: "안정", description: "예측구간 상한도 23.9% 이하" };
    }
    if (result.lower > RECOMMENDATION_LIMIT) {
      return { key: "danger", label: "위험", description: "예측구간 하한도 23.9% 초과" };
    }
    return { key: "caution", label: "주의", description: "예측구간이 23.9%를 걸침" };
  }

  function format(value, digits = 1) {
    if (!Number.isFinite(Number(value))) return "-";
    return Number(value).toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function validationMessage(config, students) {
    const maxima = [config.exam1Max, config.exam2Max, ...config.performanceAreas.map((area) => area.max)];
    const weights = [config.exam1Weight, config.exam2Weight, ...config.performanceAreas.map((area) => area.weight)];
    if (maxima.some((value) => !Number.isFinite(value) || value <= 0)) {
      return "각 평가의 만점은 0보다 커야 합니다.";
    }
    if (weights.some((value) => !Number.isFinite(value) || value < 0)) {
      return "반영비율은 0 이상이어야 합니다.";
    }
    for (const item of assessments(config)) {
      if (!item.targets.every(Number.isFinite)) {
        return `${item.name}의 A/B·B/C·C/D·D/E 분할점수를 모두 입력해 주세요.`;
      }
      if (item.targets.some((target) => target < 0 || target > item.max)) {
        return `${item.name} 분할점수는 0점 이상 만점 이하여야 합니다.`;
      }
      if (item.targets.some((target, index) => index > 0 && item.targets[index - 1] <= target + 1e-9)) {
        return `${item.name} 분할점수는 A/B > B/C > C/D > D/E 순서여야 합니다.`;
      }
    }
    const rateMessage = rateValidationMessage(config);
    if (rateMessage) return rateMessage;
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    if (Math.abs(weightSum - 100) > 1e-9) {
      return `1차·2차·수행평가 반영비율 합계를 100%로 맞춰주세요. 현재 ${format(weightSum, 0)}%입니다.`;
    }
    if (!config.performanceAreas.length) {
      return "수행평가 영역을 하나 이상 추가해 주세요.";
    }
    if (config.performanceAreas.some((area) => !Number.isFinite(area.expected))) {
      return "모든 수행평가 영역의 예상점수를 입력해 주세요.";
    }
    if (config.performanceAreas.some((area) => area.expected < 0 || area.expected > area.max)) {
      return "수행평가 예상점수는 0점 이상 각 영역 만점 이하여야 합니다.";
    }
    if (!students.length) return "유효한 1차 점수 데이터가 없습니다.";
    if (students.some((student) => student.exam1 < 0 || student.exam1 > config.exam1Max)) {
      return "1차 점수 파일에 0점 미만 또는 입력한 만점 초과 점수가 있습니다.";
    }
    if (!Number.isFinite(config.meanAdjustment)) {
      return "2차 평균 변화값을 입력해 주세요.";
    }
    if (!Number.isFinite(config.spreadFactor) || config.spreadFactor <= 0) {
      return "2차 점수 분포를 선택해 주세요.";
    }
    return "";
  }

  function weightInputs() {
    return [
      $("exam1Weight"),
      $("exam2Weight"),
      ...document.querySelectorAll(".area-weight"),
    ].filter(Boolean);
  }

  function setWeight(input, value) {
    input.value = Number(clamp(value, 0, 100).toFixed(1));
  }

  function distributeWeight(inputs, total) {
    if (!inputs.length) return;
    const current = inputs.map((input) => Math.max(0, Number(input.value) || 0));
    const currentSum = current.reduce((sum, value) => sum + value, 0);
    const totalUnits = Math.max(0, Math.round(total * 10));
    const rawUnits = current.map((value) =>
      currentSum > 0 ? totalUnits * value / currentSum : totalUnits / inputs.length
    );
    const units = rawUnits.map(Math.floor);
    let remainder = totalUnits - units.reduce((sum, value) => sum + value, 0);
    const remainderOrder = rawUnits
      .map((value, index) => ({ index, fraction: value - units[index] }))
      .sort((a, b) => b.fraction - a.fraction);
    for (let index = 0; index < remainder; index += 1) {
      units[remainderOrder[index % remainderOrder.length].index] += 1;
    }
    inputs.forEach((input, index) => setWeight(input, units[index] / 10));
  }

  function updateWeightTotal() {
    const total = weightInputs().reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    $("weightTotal").textContent = `${format(total, 1)}%`;
  }

  function rebalanceWeights(changedInput = null) {
    const inputs = weightInputs();
    state.touchedWeights = new Set(
      [...state.touchedWeights].filter((input) => inputs.includes(input))
    );

    if (!changedInput) {
      const touched = inputs.filter((input) => state.touchedWeights.has(input));
      const untouched = inputs.filter((input) => !state.touchedWeights.has(input));
      const touchedSum = touched.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      if (touched.length && untouched.length && touchedSum <= 100) {
        distributeWeight(untouched, 100 - touchedSum);
      } else {
        distributeWeight(inputs, 100);
        state.touchedWeights.clear();
      }
      updateWeightTotal();
      render();
      return;
    }

    setWeight(changedInput, Number(changedInput.value) || 0);
    state.touchedWeights.add(changedInput);
    let touched = inputs.filter((input) => state.touchedWeights.has(input));
    let untouched = inputs.filter((input) => !state.touchedWeights.has(input));

    if (!untouched.length) {
      state.touchedWeights = new Set([changedInput]);
      touched = [changedInput];
      untouched = inputs.filter((input) => input !== changedInput);
    }

    const touchedSum = touched.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    if (touchedSum > 100) {
      distributeWeight(touched, 100);
      untouched.forEach((input) => setWeight(input, 0));
    } else {
      distributeWeight(untouched, 100 - touchedSum);
    }
    updateWeightTotal();
    render();
  }

  function simulationValues(config) {
    const maximum = config.exam2Max;
    let start = clamp(number("rangeStart"), 0, maximum);
    let end = clamp(number("rangeEnd"), 0, maximum);
    const step = number("rangeStep");
    if (![start, end, step].every(Number.isFinite) || step <= 0) return [];
    if (start > end) [start, end] = [end, start];
    const values = new Map();
    for (let value = start; value <= end + step / 1000 && values.size < 201; value += step) {
      const cut = achievedAB(config, Number(value.toFixed(6)));
      if (Number.isFinite(cut)) values.set(cut.toFixed(4), cut);
    }
    return [...values.values()].sort((a, b) => a - b);
  }

  function renderTable(trialScores, config) {
    const body = $("simulationBody");
    body.innerHTML = "";
    const reportRows = [];
    simulationValues(config).forEach((cut) => {
      const result = forecast(trialScores, config, cut);
      const level = forecastStatus(result);
      reportRows.push({
        exam2AB: cut,
        finalCut: result.cut,
        medianRate: result.median,
        lowerRate: result.lower,
        upperRate: result.upper,
        exceedProbability: result.exceedProbability,
        status: level.label,
      });
      const row = document.createElement("tr");
      if (Math.abs(cut - config.exam2AB) < 1e-6) row.className = "current";
      row.innerHTML = `
        <td>${format(cut, 2)}</td>
        <td>${format(result.cut, 2)}</td>
        <td>${format(result.median)}%</td>
        <td>${format(result.lower)}~${format(result.upper)}%</td>
        <td>${format(result.exceedProbability)}%</td>
        <td><span class="pill ${level.key}">${level.label}</span></td>
      `;
      body.append(row);
    });
    return reportRows;
  }

  // 2차 A/B 목표를 0.1점 간격으로 찾되, 예측은 그 목표로 만든 예상정답률 세트의 평균(나이스 산출값)으로 판단한다
  function renderRecommendation(trialScores, config) {
    const safeAt = (tenths) =>
      forecast(trialScores, config, achievedAB(config, tenths / 10)).upper <= RECOMMENDATION_LIMIT;
    let low = Math.ceil(config.exam2Targets[1] * 10) + 1;
    let high = Math.floor(config.exam2Max * 10);
    if (low > high || !safeAt(high)) {
      $("recommendationText").textContent =
        "2차 A/B 목표를 만점 가까이 높여도 90% 예측구간 상한이 23.9%를 초과합니다.";
      return;
    }
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (safeAt(middle)) high = middle;
      else low = middle + 1;
    }
    const target = low / 10;
    $("recommendationText").innerHTML =
      `90% 예측구간 상한까지 23.9% 이하가 되려면 2차 A/B 목표는 최소 <strong>${format(target, 1)}점</strong>입니다.`
      + `<span class="recommendation__set">이 목표로 만든 예상정답률의 나이스 평균은 ${format(achievedAB(config, target), 2)}점입니다.`
      + ` <button class="apply-button" type="button" data-target="${target}">이 값으로 맞추기</button></span>`;
  }

  function renderRateSets(config) {
    const weights = config.groupWeights;
    const total = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) ? weight : 0), 0);
    const mismatch = Math.abs(total - config.exam2Max) >= 0.01;
    $("groupWeightTotal").textContent =
      `배점합 합계 ${formatCut(total)}점 / 2차 만점 ${formatCut(config.exam2Max)}점`;
    $("groupWeightTotal").classList.toggle("error", mismatch);
    const result = config.rateResult;
    if (!result) {
      $("rateSummary").innerHTML =
        `<p class="rate-summary__empty">${escapeHtml(rateValidationMessage(config) || "2차 분할점수 4개를 모두 입력하면 교사별 예상정답률을 만듭니다.")}</p>`;
      $("neisNote").textContent = "";
      $("teacherCards").innerHTML = "";
      return null;
    }
    $("rateSummary").innerHTML = BOUNDARIES.map((boundary, column) => {
      const gap = result.average[column] - result.targets[column];
      return `
        <div class="rate-target">
          <span>${boundary.label}</span>
          <strong>${format(result.average[column], 2)}</strong>
          <small>목표 ${formatCut(result.targets[column])} · 차이 ${gap >= 0 ? "+" : ""}${format(gap, 2)}</small>
        </div>`;
    }).join("");
    $("neisNote").textContent =
      `교사 ${config.teacherCount}명의 분할점수 평균이 나이스 산출값이며, 예측도 이 값으로 계산합니다. `
      + "규칙: 5% 단위 · 한 줄 안에서 A > B > C > D · 같은 문항구분 안에서 쉬움 ≥ 보통 ≥ 어려움.";
    renderTeacherCards(result);
    return result;
  }

  function groupRowHtml(result, row, cells) {
    const group = result.groups[row];
    const sameType = result.groups.filter((item) => item.type === group.type);
    const typeCell = sameType[0] === group
      ? `<td class="type-cell" rowspan="${sameType.length}">${group.type}</td>`
      : "";
    return `<tr>${typeCell}<td>${ITEM_GROUPS[group.index].label}</td><td>${formatCut(group.weight)}</td>${cells}</tr>`;
  }

  function renderTeacherCards(result) {
    $("teacherCards").innerHTML = result.teachers.map((teacher, index) => `
      <article class="teacher-card">
        <div class="teacher-card__head">
          <span class="teacher-no">${index + 1}</span>
          <input class="teacher-name" type="text" data-index="${index}" value="${escapeHtml(state.teacherNames[index] || "")}" placeholder="교사 ${index + 1}" aria-label="교사 ${index + 1} 이름">
          <button class="copy-button" type="button" data-index="${index}">복사</button>
        </div>
        <table class="teacher-table">
          <thead><tr><th>구분</th><th>난이도</th><th>배점합</th>${RATE_COLUMNS.map((label) => `<th>${label}</th>`).join("")}</tr></thead>
          <tbody>
            ${teacher.rates.map((line, row) =>
              groupRowHtml(result, row, line.map((value) => `<td class="rate-cell">${value}</td>`).join(""))
            ).join("")}
          </tbody>
          <tfoot>
            <tr><td colspan="3">분할점수</td>${teacher.cuts.map((cut) => `<td>${format(cut, 2)}</td>`).join("")}</tr>
          </tfoot>
        </table>
      </article>
    `).join("");
  }

  function teacherMessage(index) {
    const result = state.rateResult;
    const teacher = result.teachers[index];
    const lines = teacher.rates.map((line, row) => {
      const group = result.groups[row];
      return `${group.type} ${ITEM_GROUPS[group.index].label}(${formatCut(group.weight)}점): `
        + line.map((value, column) => `${RATE_COLUMNS[column]} ${value}`).join(" / ");
    });
    return [
      `[${teacherName(index)}] 2차 예상정답률 입력값 (최소능력자, 5% 단위)`,
      ...lines,
      `→ 분할점수 ${BOUNDARIES.map((boundary, column) => `${boundary.label} ${format(teacher.cuts[column], 2)}`).join(" / ")}`,
    ].join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    }
  }

  function renderFinalCuts(cuts) {
    $("finalCutGrid").innerHTML = BOUNDARIES.map((boundary, index) => `
      <div class="final-cut${index === 0 ? " primary" : ""}">
        <span>${boundary.label}</span>
        <strong>${format(cuts[index], 2)}</strong>
      </div>
    `).join("");
  }

  function renderGrades(gradeResult) {
    const { grades } = gradeResult;
    const sum = grades.reduce((total, grade) => total + grade.median, 0) || 1;
    $("gradeBar").innerHTML = grades.map((grade) => {
      const width = grade.median / sum * 100;
      const label = width >= 9 ? `${grade.grade} ${format(grade.median)}%` : width >= 3 ? grade.grade : "";
      return `<div class="grade-seg grade-${grade.grade.toLowerCase()}" style="width:${width}%" title="${grade.grade} ${format(grade.median)}%">${label}</div>`;
    }).join("");
    const scaleMax = Math.max(10, Math.ceil(Math.max(...grades.map((grade) => grade.upper)) / 10) * 10);
    $("gradeCards").innerHTML = grades.map((grade) => `
      <article class="grade-card grade-${grade.grade.toLowerCase()}">
        <div class="grade-card__top">
          <span class="grade-badge">${grade.grade}</span>
          <small>${grade.medianCount.toLocaleString("ko-KR")}명</small>
        </div>
        <strong>${format(grade.median)}<em>%</em></strong>
        <div class="grade-range" aria-hidden="true">
          <b style="left:${grade.lower / scaleMax * 100}%;width:${(grade.upper - grade.lower) / scaleMax * 100}%"></b>
          <i style="left:${grade.median / scaleMax * 100}%"></i>
        </div>
        <small class="range-text">90% ${format(grade.lower)}~${format(grade.upper)}%</small>
      </article>
    `).join("");
  }

  function render() {
    const config = settings();
    $("exam2ABSlider").max = config.exam2Max || 100;
    $("sliderMaxLabel").textContent = `${config.exam2Max || 100}점`;
    $("sliderValue").textContent = formatCut(config.exam2Targets[0]);
    $("sliderAchieved").textContent = config.rateResult
      ? `나이스 산출 평균 ${format(config.exam2AB, 2)}점`
      : "";
    BOUNDARIES.forEach((boundary, column) => {
      $(`exam2${boundary.key}Avg`).textContent = config.rateResult
        ? `나이스 평균 ${format(config.rateResult.average[column], 2)}`
        : "";
    });
    state.rateResult = renderRateSets(config);
    if (!state.rows.length) {
      state.lastReport = null;
      return;
    }

    const students = cleanStudents(config);
    let target = null;
    if (
      students.length
      && Number.isFinite(config.exam1Max) && config.exam1Max > 0
      && Number.isFinite(config.exam2Max) && config.exam2Max > 0
    ) {
      target = targetDistribution(students, config);
      $("targetMeanDisplay").textContent = format(target.mean, 1);
      $("targetSdDisplay").textContent = format(target.sd, 1);
    }
    const warning = validationMessage(config, students);
    $("weightValidation").textContent = warning;
    $("weightValidation").classList.toggle("error", Boolean(warning));
    if (warning) {
      state.lastReport = null;
      $("results").hidden = true;
      $("emptyState").hidden = false;
      $("emptyState").innerHTML = `<span>${warning}</span>`;
      return;
    }

    $("emptyState").textContent = "";
    $("emptyState").hidden = true;
    $("results").hidden = false;
    const trialScores = buildTrialScores(students, config);
    const result = forecast(trialScores, config);
    const level = forecastStatus(result);

    $("totalStudents").textContent = result.total.toLocaleString("ko-KR");
    $("aCount").textContent = result.medianCount.toLocaleString("ko-KR");
    $("aRate").textContent = format(result.median);
    $("predictionInterval").textContent = `${format(result.lower)}~${format(result.upper)}%`;
    $("exceedProbability").textContent = `${format(result.exceedProbability)}%`;
    $("statusText").textContent = level.label;
    $("statusDescription").textContent = level.description;
    $("statusText").closest(".status-card").className = `metric status-card ${level.key}`;
    const gradeResult = gradeForecast(trialScores, config);
    renderFinalCuts(gradeResult.cuts);
    renderGrades(gradeResult);
    $("cutFormula").textContent =
      `A/B = 1차 ${formatCut(config.exam1AB)}/${format(config.exam1Max, 0)}×${format(config.exam1Weight, 1)} + `
      + `2차 ${formatCut(config.exam2AB)}/${format(config.exam2Max, 0)}×${format(config.exam2Weight, 1)} + `
      + config.performanceAreas.map((area) =>
        `${area.name} ${formatCut(area.ab)}/${format(area.max, 0)}×${format(area.weight, 1)}`
      ).join(" + ");
    renderRecommendation(trialScores, config);
    const simulationRows = renderTable(trialScores, config);
    state.lastReport = {
      config,
      result,
      level,
      target,
      gradeResult,
      rateResult: state.rateResult,
      simulationRows,
      recommendation: $("recommendationText").textContent.trim(),
      cutFormula: $("cutFormula").textContent,
    };
  }

  function safeSheetName(name) {
    return name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  }

  function setSheetWidths(sheet, widths) {
    sheet["!cols"] = widths.map((width) => ({ wch: width }));
  }

  function exportExcel() {
    if (!window.XLSX) {
      showStatus("fileStatus", "Excel 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", true);
      return;
    }
    if (!state.lastReport || !state.rows.length) return;

    const {
      config, result, level, target, gradeResult, rateResult, simulationRows, recommendation, cutFormula,
    } = state.lastReport;
    const workbook = XLSX.utils.book_new();

    const scoreRows = [
      ["studentId", "exam1"],
      ...state.rows.map((row) => [row.studentId, row.exam1]),
    ];
    const scoreSheet = XLSX.utils.aoa_to_sheet(scoreRows);
    scoreSheet["!autofilter"] = { ref: `A1:B${scoreRows.length}` };
    scoreSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    setSheetWidths(scoreSheet, [18, 12]);
    XLSX.utils.book_append_sheet(workbook, scoreSheet, "1차 점수");

    const summaryRows = [
      ["A비율 시뮬레이션 결과"],
      ["저장 일시", new Date().toLocaleString("ko-KR")],
      ["원본 파일", state.sourceFileName || "-"],
      ["모의 계산 횟수", SIMULATION_COUNT],
      ["1·2차 성취 경향 상관 가정", EXAM_CORRELATION],
      [],
      ["결과 항목", "값", "설명"],
      ["전체 학생 수", result.total, "빈 점수 칸은 제외"],
      ["중앙 예상 A 인원", result.medianCount, "1,000회 모의 결과의 중앙값 기준"],
      ["중앙 예상 A 비율", result.median / 100, "1,000회 모의 결과의 중앙값"],
      ["90% 예측구간 하한", result.lower / 100, "하위 5%"],
      ["90% 예측구간 상한", result.upper / 100, "상위 95%"],
      ["23.9% 초과확률", result.exceedProbability / 100, "교육청 권고기준 초과 모의 횟수 비율"],
      ["보수적 판정", level.label, level.description],
      ["학기말 예상 A/B 환산컷", result.cut, cutFormula],
      ["추천 2차 A/B 컷", recommendation],
      ...BOUNDARIES.slice(1).map((boundary, index) => [
        `학기말 예상 ${boundary.label} 환산컷`, gradeResult.cuts[index + 1],
      ]),
      [],
      ["주의", "본 결과는 입력한 가정에 따른 참고용 시뮬레이션이며 확정 예측이 아닙니다."],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!merges"] = [XLSX.utils.decode_range("A1:C1")];
    summarySheet["!freeze"] = { xSplit: 0, ySplit: 7 };
    ["B10", "B11", "B12", "B13"].forEach((cell) => {
      if (summarySheet[cell]) summarySheet[cell].z = "0.0%";
    });
    setSheetWidths(summarySheet, [26, 24, 52]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "결과 요약");

    const spreadLabel = config.spreadFactor === 0.8
      ? "더 좁음"
      : config.spreadFactor === 1.2 ? "더 넓음" : "비슷함";
    const settingRows = [
      ["구분", "영역", "만점", "반영비율", "A/B", "B/C", "C/D", "D/E", "예상점수"],
      ["지필평가", "1차 정기시험", config.exam1Max, config.exam1Weight / 100, ...config.exam1Cuts, "실제 점수 파일"],
      ["지필평가", "2차 정기시험", config.exam2Max, config.exam2Weight / 100, ...config.exam2Cuts, "모의 생성"],
      ...config.performanceAreas.map((area) => [
        "수행평가", area.name, area.max, area.weight / 100, ...area.cuts, area.expected,
      ]),
      [],
      ["2차 나이스 입력", "담당 교사 수", config.teacherCount, "명 · 2차 분할점수는 교사별 예상정답률 산출값의 평균"],
      ["2차 나이스 입력", "2차 목표 분할점수", ...config.exam2Targets],
      ...ITEM_GROUPS.map((group, index) => [
        "2차 문항정보", `${group.type} ${group.label}`, config.groupWeights[index], "배점합",
      ]),
      ["2차 예상 설정", "평균 변화", config.meanAdjustment, "점"],
      ["2차 예상 설정", "점수 분포", spreadLabel, `표준편차 × ${config.spreadFactor}`],
      ["2차 예상 분포", "예상 평균", target?.mean ?? "", "점"],
      ["2차 예상 분포", "예상 표준편차", target?.sd ?? "", "점"],
    ];
    const settingSheet = XLSX.utils.aoa_to_sheet(settingRows);
    settingSheet["!autofilter"] = { ref: `A1:I${3 + config.performanceAreas.length}` };
    settingSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    for (let row = 2; row <= 3 + config.performanceAreas.length; row += 1) {
      const cell = `D${row}`;
      if (settingSheet[cell]) settingSheet[cell].z = "0.0%";
    }
    setSheetWidths(settingSheet, [16, 22, 12, 14, 10, 10, 10, 10, 18]);
    XLSX.utils.book_append_sheet(workbook, settingSheet, "입력 설정");

    const gradeRows = [
      ["등급", "중앙 비율", "중앙 인원", "90% 하한", "90% 상한", "평균 비율"],
      ...gradeResult.grades.map((grade) => [
        grade.grade,
        grade.median / 100,
        grade.medianCount,
        grade.lower / 100,
        grade.upper / 100,
        grade.mean / 100,
      ]),
      [],
      ["학기말 환산컷", "점수"],
      ...BOUNDARIES.map((boundary, index) => [boundary.label, gradeResult.cuts[index]]),
      [],
      ["참고", "수행평가는 모든 학생에게 같은 예상점수를 적용하므로 C~E 비율은 실제보다 작게 나올 수 있습니다."],
    ];
    const gradeSheet = XLSX.utils.aoa_to_sheet(gradeRows);
    for (let row = 2; row <= 6; row += 1) {
      ["B", "D", "E", "F"].forEach((column) => {
        const cell = `${column}${row}`;
        if (gradeSheet[cell]) gradeSheet[cell].z = "0.0%";
      });
    }
    setSheetWidths(gradeSheet, [14, 12, 12, 12, 12, 12]);
    XLSX.utils.book_append_sheet(workbook, gradeSheet, "등급 비율 예측");

    const teacherCount = config.teacherCount;
    const rateSummary = [
      ["2차 분할점수", "목표", "나이스 평균", ...Array.from({ length: teacherCount }, (_, index) => teacherName(index))],
      ...BOUNDARIES.map((boundary, column) => [
        boundary.label,
        rateResult.targets[column],
        rateResult.average[column],
        ...rateResult.teachers.map((teacher) => teacher.cuts[column]),
      ]),
      [],
      ["참고", "교사별 분할점수 = Σ(배점합 × 최소능력자 예상정답률), 나이스 산출값 = 교사 평균"],
    ];
    const rateSheet = XLSX.utils.aoa_to_sheet(rateSummary);
    for (let row = 2; row <= 5; row += 1) {
      for (let column = 1; column < 3 + teacherCount; column += 1) {
        const cell = `${XLSX.utils.encode_col(column)}${row}`;
        if (rateSheet[cell]) rateSheet[cell].z = "0.00";
      }
    }
    setSheetWidths(rateSheet, [14, 10, 12, ...Array(teacherCount).fill(10)]);
    XLSX.utils.book_append_sheet(workbook, rateSheet, "2차 정답률 요약");

    const usedSheetNames = new Set(workbook.SheetNames);
    rateResult.teachers.forEach((teacher, index) => {
      const name = teacherName(index);
      let sheetName = safeSheetName(state.teacherNames[index]?.trim() ? name : `교사${index + 1}`);
      if (usedSheetNames.has(sheetName)) sheetName = safeSheetName(`${sheetName.slice(0, 26)} (${index + 1})`);
      usedSheetNames.add(sheetName);
      const teacherSheet = XLSX.utils.aoa_to_sheet([
        [`${name} 2차 예상정답률 입력값 (최소능력자, 5% 단위)`],
        [],
        ["문항구분", "난이도", "배점합", ...RATE_COLUMNS],
        ...teacher.rates.map((line, row) => {
          const group = rateResult.groups[row];
          return [group.type, ITEM_GROUPS[group.index].label, group.weight, ...line];
        }),
        [],
        ["분할점수", "", "", ...teacher.cuts],
      ]);
      const cutRow = 5 + teacher.rates.length;
      ["D", "E", "F", "G"].forEach((column) => {
        if (teacherSheet[`${column}${cutRow}`]) teacherSheet[`${column}${cutRow}`].z = "0.00";
      });
      setSheetWidths(teacherSheet, [12, 10, 10, 8, 8, 8, 8]);
      XLSX.utils.book_append_sheet(workbook, teacherSheet, sheetName);
    });

    const simulationData = [
      ["2차 A/B", "학기말 환산컷", "중앙 A비율", "90% 하한", "90% 상한", "23.9% 초과확률", "판정"],
      ...simulationRows.map((row) => [
        row.exam2AB,
        row.finalCut,
        row.medianRate / 100,
        row.lowerRate / 100,
        row.upperRate / 100,
        row.exceedProbability / 100,
        row.status,
      ]),
    ];
    const simulationSheet = XLSX.utils.aoa_to_sheet(simulationData);
    simulationSheet["!autofilter"] = { ref: `A1:G${simulationData.length}` };
    simulationSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    for (let row = 2; row <= simulationData.length; row += 1) {
      ["C", "D", "E", "F"].forEach((column) => {
        const cell = `${column}${row}`;
        if (simulationSheet[cell]) simulationSheet[cell].z = "0.0%";
      });
    }
    setSheetWidths(simulationSheet, [12, 16, 14, 12, 12, 18, 10]);
    XLSX.utils.book_append_sheet(workbook, simulationSheet, safeSheetName("2차 컷 시뮬레이션"));

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "_",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join("");
    XLSX.writeFile(workbook, `A_rate_simulation_${stamp}.xlsx`, { compression: true });
  }

  function makeSample() {
    const rows = Array.from({ length: 240 }, (_, index) => {
      const wave = Math.sin(index * 1.73) * 13 + Math.cos(index * 0.37) * 8;
      const trend = ((index * 17) % 31) - 15;
      return {
        studentId: `S${String(index + 1).padStart(3, "0")}`,
        exam1: clamp(Math.round(70 + wave + trend * 0.55), 24, 100),
      };
    });
    loadExamRows(rows, "sample_exam1.csv");
  }

  function addPerformanceArea(values = {}) {
    const area = document.createElement("div");
    area.className = "performance-area";
    area.innerHTML = `
      <label>영역명<input class="area-name" type="text" value="${escapeHtml(values.name || "수행평가")}"></label>
      <label>만점<input class="area-max" type="number" min="1" value="${values.max ?? 100}"></label>
      <label>반영비율<input class="area-weight weight-input" type="number" min="0" max="100" step="0.1" value="${values.weight ?? 10}"></label>
      <label>A/B<input class="area-ab" type="number" min="0" step="0.01" value="${values.ab ?? 90}"></label>
      <label>B/C<input class="area-bc" type="number" min="0" step="0.01" value="${values.bc ?? 80}"></label>
      <label>C/D<input class="area-cd" type="number" min="0" step="0.01" value="${values.cd ?? 70}"></label>
      <label>D/E<input class="area-de" type="number" min="0" step="0.01" value="${values.de ?? 60}"></label>
      <label>예상점수<input class="area-expected" type="number" min="0" value="${values.expected ?? 100}"></label>
      <button class="remove-area-button" type="button" title="영역 삭제" aria-label="수행평가 영역 삭제">×</button>
    `;
    $("performanceAreas").append(area);
  }

  async function importFile(file, scoreKey, loader, statusId) {
    try {
      const imported = await readFile(file, scoreKey);
      loader(imported.rows, file.name, imported.format);
    } catch (error) {
      showStatus(statusId, error.message, true);
    }
  }

  function bindDropzone(dropzoneId, inputId, scoreKey, loader, statusId) {
    const dropzone = $(dropzoneId);
    $(inputId).addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) importFile(file, scoreKey, loader, statusId);
    });
    ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    }));
    dropzone.addEventListener("drop", (event) => {
      const [file] = event.dataTransfer.files;
      if (file) importFile(file, scoreKey, loader, statusId);
    });
  }

  bindDropzone("dropzone", "fileInput", "exam1", loadExamRows, "fileStatus");
  const savedInputs = loadInputs();
  if (savedInputs?.areas?.length) {
    savedInputs.areas.forEach((area) => addPerformanceArea(area));
  } else {
    addPerformanceArea({ name: "수행평가 1", weight: 15 });
    addPerformanceArea({ name: "수행평가 2", weight: 15 });
    addPerformanceArea({ name: "수행평가 3", weight: 10 });
  }
  if (savedInputs) restoreInputs(savedInputs);
  renderSaveStatus(savedInputs);
  // 사용자가 값을 바꾸거나 영역을 추가·삭제할 때만 저장한다 (점수 파일 선택은 제외)
  document.addEventListener("input", (event) => {
    if (event.target.id !== "fileInput" && !event.target.classList.contains("teacher-name")) scheduleSave();
  });
  document.addEventListener("change", (event) => {
    if (event.target.name === "spreadFactor") scheduleSave();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#addPerformanceArea, .remove-area-button, .apply-button")) scheduleSave();
  });
  $("clearSaved").addEventListener("click", clearSavedInputs);
  $("addPerformanceArea").addEventListener("click", () => {
    addPerformanceArea({ name: `수행평가 ${document.querySelectorAll(".performance-area").length + 1}` });
    const addedWeight = document.querySelector(".performance-area:last-child .area-weight");
    rebalanceWeights(addedWeight);
  });
  $("performanceAreas").addEventListener("input", (event) => {
    if (event.target.classList.contains("area-weight")) {
      rebalanceWeights(event.target);
    } else {
      scheduleRender();
    }
  });
  $("performanceAreas").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-area-button");
    if (!button) return;
    const area = button.closest(".performance-area");
    const removedWeight = area.querySelector(".area-weight");
    state.touchedWeights.delete(removedWeight);
    area.remove();
    rebalanceWeights();
  });
  $("loadSample").addEventListener("click", makeSample);
  $("exportExcel").addEventListener("click", exportExcel);
  document.querySelectorAll('input[name="spreadFactor"]').forEach((input) =>
    input.addEventListener("change", render)
  );
  numericIds
    .filter((id) => id !== "exam2AB")
    .forEach((id) => $(id).addEventListener("input", () => scheduleRender()));
  $("exam2Max").addEventListener("input", () => syncSimulationRange());
  $("itemGroups").addEventListener("input", () => scheduleRender());
  $("recommendation").addEventListener("click", (event) => {
    const button = event.target.closest(".apply-button");
    if (!button) return;
    $("exam2AB").value = button.dataset.target;
    $("exam2ABSlider").value = button.dataset.target;
    syncSimulationRange();
    render();
  });
  $("teacherCards").addEventListener("input", (event) => {
    if (!event.target.classList.contains("teacher-name")) return;
    state.teacherNames[Number(event.target.dataset.index)] = event.target.value;
    saveTeacherNames();
    renderSaveStatus(loadInputs());
  });
  $("teacherCards").addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-button");
    if (!button) return;
    const copied = await copyText(teacherMessage(Number(button.dataset.index)));
    button.textContent = copied ? "복사됨" : "복사 실패";
    button.classList.toggle("copied", copied);
    window.setTimeout(() => {
      button.textContent = "복사";
      button.classList.remove("copied");
    }, 1500);
  });
  ["exam1Weight", "exam2Weight"].forEach((id) =>
    $(id).addEventListener("input", (event) => rebalanceWeights(event.target))
  );
  $("exam2ABSlider").addEventListener("input", () => {
    $("exam2AB").value = $("exam2ABSlider").value;
    syncSimulationRange();
    render();
  });
  $("exam2AB").addEventListener("input", () => {
    $("exam2ABSlider").value = $("exam2AB").value;
    syncSimulationRange();
    scheduleRender();
  });

  updateWeightTotal();
  render();
})();
