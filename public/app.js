let state = { transactions: [], mappings: [], budgets: [], granularCategories: [] };
let selectedCategories = new Set();
let selectedBudgetId = "";
let selectedYear = new Date().getFullYear();
let userSelectedYear = false;
let comparisonYears = {
  currentIncome: null,
  lastIncome: null,
  currentSpend: null,
  lastSpend: null,
};
let categoryCompare = {
  categoryType: "aggregate",
  category: "",
  yearA: null,
  yearB: null,
};
let budgetCompare = {
  year: null,
  month: null,
};

const $ = (id) => document.getElementById(id);
const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

async function refresh() {
  state = await api("/api/state");
  const years = availableYears();
  if (!userSelectedYear && years.length > 0) {
    selectedYear = years[0];
  }
  applyDefaultComparisonYears();
  applyDefaultCategoryCompare();
  applyDefaultBudgetCompare();
  render();
}

function availableYears() {
  return [...new Set(state.transactions.map((row) => Number(row.date.slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
}

function latestDataDate() {
  return state.transactions.reduce((latest, row) => (!latest || row.date > latest ? row.date : latest), "");
}

function latestDateForYear(year) {
  return state.transactions
    .filter((row) => row.date.startsWith(`${year}-`))
    .reduce((latest, row) => (!latest || row.date > latest ? row.date : latest), "");
}

function latestDateForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  return state.transactions
    .filter((row) => row.date.startsWith(prefix))
    .reduce((latest, row) => (!latest || row.date > latest ? row.date : latest), "");
}

function latestMonth() {
  const latest = latestDataDate();
  return latest ? Number(latest.slice(5, 7)) : new Date().getMonth() + 1;
}

function categoryFor(row) {
  const mapping = state.mappings.find((item) => item.granularCategories.includes(row.granularCategory));
  return mapping ? mapping.aggregateCategory : row.granularCategory;
}

function aggregateCategories() {
  return state.mappings.map((mapping) => mapping.aggregateCategory).sort((a, b) => a.localeCompare(b));
}

function categoriesForType(categoryType) {
  const categories = categoryType === "aggregate" ? aggregateCategories() : state.granularCategories;
  return [...new Set(categories)].sort((a, b) => a.localeCompare(b));
}

function cumulativeByDay(year, type) {
  const byDay = new Map();
  state.transactions
    .filter((row) => row.type === type && row.date.startsWith(`${year}-`))
    .forEach((row) => {
      const day = row.date.slice(5);
      byDay.set(day, (byDay.get(day) || 0) + Number(row.amount));
    });

  let running = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, amount]) => {
      running += amount;
      return { day, value: running };
    });
}

function applyDefaultComparisonYears() {
  const years = availableYears();
  if (years.length === 0) return;
  const latest = years[0];
  comparisonYears.currentIncome ??= latest;
  comparisonYears.currentSpend ??= latest;
}

function applyDefaultCategoryCompare() {
  const years = availableYears();
  if (years.length === 0) return;
  const latest = years[0];
  const previous = years.includes(latest - 1) ? latest - 1 : years[1] || latest - 1;
  categoryCompare.yearA ??= latest;
  categoryCompare.yearB ??= previous;

  if (categoryCompare.categoryType === "aggregate" && aggregateCategories().length === 0) {
    categoryCompare.categoryType = "granular";
  }

  const categories = categoriesForType(categoryCompare.categoryType);
  if (!categoryCompare.category || !categories.includes(categoryCompare.category)) {
    categoryCompare.category = categories[0] || "";
  }
}

function applyDefaultBudgetCompare() {
  const latest = latestDataDate();
  budgetCompare.year ??= latest ? Number(latest.slice(0, 4)) : selectedYear;
  budgetCompare.month ??= latest ? Number(latest.slice(5, 7)) : new Date().getMonth() + 1;
}

function daysInYear(year) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

function labelForDay(year, ordinal) {
  const value = new Date(year, 0, ordinal);
  return `${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function cumulativeByOrdinal(year, type) {
  if (!year) return [];
  const daily = new Map();
  state.transactions
    .filter((row) => row.type === type && row.date.startsWith(`${year}-`))
    .forEach((row) => {
      const ordinal = dayOfYear(row.date);
      daily.set(ordinal, (daily.get(ordinal) || 0) + Number(row.amount));
    });
  if (daily.size === 0) return [];

  let running = 0;
  const latestDate = latestDateForYear(year);
  const lastActualDay = latestDate ? dayOfYear(latestDate) : 0;
  return Array.from({ length: daysInYear(year) }, (_, index) => {
    const day = index + 1;
    running += daily.get(day) || 0;
    return day <= lastActualDay ? running : undefined;
  });
}

function cumulativeExpenseByCategoryOrdinal(year, categoryType, category) {
  if (!year || !category) return [];
  const daily = new Map();
  state.transactions
    .filter((row) => row.type === "expense" && row.date.startsWith(`${year}-`))
    .filter((row) => (categoryType === "granular" ? row.granularCategory === category : categoryFor(row) === category))
    .forEach((row) => {
      const ordinal = dayOfYear(row.date);
      daily.set(ordinal, (daily.get(ordinal) || 0) + Number(row.amount));
    });
  if (daily.size === 0) return [];

  let running = 0;
  const latestDate = latestDateForYear(year);
  const lastActualDay = latestDate ? dayOfYear(latestDate) : 0;
  return Array.from({ length: daysInYear(year) }, (_, index) => {
    const day = index + 1;
    running += daily.get(day) || 0;
    return day <= lastActualDay ? running : undefined;
  });
}

function comparisonRows() {
  const series = {
    currentIncome: cumulativeByOrdinal(comparisonYears.currentIncome, "income"),
    lastIncome: cumulativeByOrdinal(comparisonYears.lastIncome, "income"),
    currentSpend: cumulativeByOrdinal(comparisonYears.currentSpend, "expense"),
    lastSpend: cumulativeByOrdinal(comparisonYears.lastSpend, "expense"),
  };
  const maxDays = Math.max(365, ...Object.values(series).map((rows) => rows.length));
  const labelYear = comparisonYears.currentIncome || comparisonYears.currentSpend || selectedYear;

  return Array.from({ length: maxDays }, (_, index) => {
    const day = index + 1;
    return {
      label: labelForDay(labelYear, day),
      currentIncome: series.currentIncome[index],
      lastIncome: series.lastIncome[index],
      currentSpend: series.currentSpend[index],
      lastSpend: series.lastSpend[index],
    };
  });
}

function categoryCompareRows() {
  const yearA = cumulativeExpenseByCategoryOrdinal(
    categoryCompare.yearA,
    categoryCompare.categoryType,
    categoryCompare.category
  );
  const yearB = cumulativeExpenseByCategoryOrdinal(
    categoryCompare.yearB,
    categoryCompare.categoryType,
    categoryCompare.category
  );
  const maxDays = Math.max(365, yearA.length, yearB.length);
  const labelYear = categoryCompare.yearA || categoryCompare.yearB || selectedYear;

  return Array.from({ length: maxDays }, (_, index) => ({
    label: labelForDay(labelYear, index + 1),
    yearA: yearA[index],
    yearB: yearB[index],
  }));
}

function dayOfYear(value) {
  const current = new Date(`${value}T00:00:00`);
  const start = new Date(current.getFullYear(), 0, 0);
  return Math.floor((current - start) / 86400000);
}

function pacingRows(budget) {
  if (!budget) return [];
  const compareYear = Number(budgetCompare.year || budget.year);
  const compareMonth = Number(budgetCompare.month || latestMonth());
  const rows = state.transactions
    .filter((row) => row.type === "expense" && row.date.startsWith(`${compareYear}-`))
    .filter((row) => (budget.categoryType === "granular" ? row.granularCategory === budget.category : categoryFor(row) === budget.category))
    .filter((row) => (budget.period === "monthly" ? Number(row.date.slice(5, 7)) === compareMonth : true));

  const days = budget.period === "monthly" ? new Date(compareYear, compareMonth, 0).getDate() : daysInYear(compareYear);
  const byDay = new Map();
  rows.forEach((row) => {
    const key = budget.period === "monthly" ? Number(row.date.slice(8, 10)) : dayOfYear(row.date);
    byDay.set(key, (byDay.get(key) || 0) + Number(row.amount));
  });

  let actual = 0;
  const latestDate =
    budget.period === "monthly"
      ? latestDateForMonth(compareYear, compareMonth)
      : latestDateForYear(compareYear);
  const lastActualDay =
    !latestDate ? 0 : budget.period === "monthly" ? Number(latestDate.slice(8, 10)) : dayOfYear(latestDate);
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    actual += byDay.get(day) || 0;
    return {
      label: budget.period === "monthly" ? String(day).padStart(2, "0") : String(day),
      actual: day <= lastActualDay ? actual : undefined,
      paced: budget.period === "one-time" ? Number(budget.amount) : (Number(budget.amount) * day) / days,
    };
  });
}

function renderLineChart(container, rows, series) {
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 320;
  const pad = { top: 20, right: 20, bottom: 34, left: 58 };
  const values = rows.flatMap((row) => series.map((item) => row[item.key]).filter((value) => value !== undefined));
  const max = Math.max(...values, 1);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotWidth);
  const y = (value) => pad.top + plotHeight - (Number(value || 0) / max) * plotHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1];

  const paths = series
    .map((item) => {
      const points = rows
        .map((row, index) => (row[item.key] === undefined ? null : `${x(index)},${y(row[item.key])}`))
        .filter(Boolean);
      if (points.length < 2) return "";
      const dash = item.dash ? ` stroke-dasharray="${item.dash}"` : "";
      return `<polyline points="${points.join(" ")}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${dash} />`;
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img">
      <rect width="${width}" height="${height}" fill="white"></rect>
      ${grid
        .map((step) => {
          const gy = pad.top + plotHeight - step * plotHeight;
          return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}" stroke="#edf1ef" />
            <text x="10" y="${gy + 4}" font-size="11" fill="#657073">${money(max * step)}</text>`;
        })
        .join("")}
      ${paths}
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}" stroke="#dce3df" />
      <text x="${pad.left}" y="${height - 10}" font-size="11" fill="#657073">${rows[0]?.label || ""}</text>
      <text x="${width - pad.right - 42}" y="${height - 10}" font-size="11" fill="#657073">${rows.at(-1)?.label || ""}</text>
      <line class="hover-line" x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="#9aa8a5" stroke-width="1" opacity="0"></line>
    </svg>
    <div class="chart-tooltip"></div>`;

  const tooltip = container.querySelector(".chart-tooltip");
  const hoverLine = container.querySelector(".hover-line");
  container.onmouseleave = () => {
    tooltip.style.display = "none";
    hoverLine.setAttribute("opacity", "0");
  };
  container.onmousemove = (event) => {
    if (rows.length === 0) return;
    const rect = container.getBoundingClientRect();
    const localX = Math.max(pad.left, Math.min(width - pad.right, event.clientX - rect.left));
    const index = Math.round(((localX - pad.left) / plotWidth) * (rows.length - 1));
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    const chartX = x(index);
    hoverLine.setAttribute("x1", chartX);
    hoverLine.setAttribute("x2", chartX);
    hoverLine.setAttribute("opacity", "1");
    tooltip.innerHTML = `<strong>${row.label}</strong>${series
      .map((item) => {
        const value = row[item.key];
        return `<span><span><i style="background:${item.color}"></i>${item.name || item.key}</span><b>${
          value === undefined || value === null ? "NULL" : money(value)
        }</b></span>`;
      })
      .join("")}`;
    tooltip.style.display = "block";
    tooltip.style.left = `${chartX}px`;
    tooltip.style.top = `${Math.max(56, event.clientY - rect.top)}px`;
  };
}

function render() {
  $("year-input").value = selectedYear;
  renderComparisonControls();
  const currentRows = state.transactions.filter((row) => row.date.startsWith(`${selectedYear}-`));
  const income = currentRows.filter((row) => row.type === "income").reduce((sum, row) => sum + Number(row.amount), 0);
  const spend = currentRows.filter((row) => row.type === "expense").reduce((sum, row) => sum + Number(row.amount), 0);
  $("metric-income").textContent = money(income);
  $("metric-spend").textContent = money(spend);
  $("metric-net").textContent = money(income - spend);
  $("metric-count").textContent = String(state.transactions.length);
  $("metric-latest-data").textContent = latestDataDate() || "NULL";

  $("label-current-income").textContent = comparisonYears.currentIncome ? `${comparisonYears.currentIncome} income` : "Income A";
  $("label-last-income").textContent = comparisonYears.lastIncome ? `${comparisonYears.lastIncome} income` : "Income B";
  $("label-current-spend").textContent = comparisonYears.currentSpend ? `${comparisonYears.currentSpend} expense` : "Expense A";
  $("label-last-spend").textContent = comparisonYears.lastSpend ? `${comparisonYears.lastSpend} expense` : "Expense B";
  renderLineChart($("comparison-chart"), comparisonRows(), [
    comparisonYears.currentIncome ? { key: "currentIncome", name: `${comparisonYears.currentIncome} income`, color: "#26734d" } : null,
    comparisonYears.lastIncome ? { key: "lastIncome", name: `${comparisonYears.lastIncome} income`, color: "#26734d", dash: "8 7" } : null,
    comparisonYears.currentSpend ? { key: "currentSpend", name: `${comparisonYears.currentSpend} expense`, color: "#b24a3b" } : null,
    comparisonYears.lastSpend ? { key: "lastSpend", name: `${comparisonYears.lastSpend} expense`, color: "#b24a3b", dash: "8 7" } : null,
  ].filter(Boolean));

  renderMappings();
  renderBudgets();
  renderCategoryCompare();
  renderIncome();
}

function renderComparisonControls() {
  const years = availableYears();
  const options = `<option value="">None</option>${years.map((year) => `<option value="${year}">${year}</option>`).join("")}`;
  [
    ["comparison-current-income", "currentIncome"],
    ["comparison-last-income", "lastIncome"],
    ["comparison-current-spend", "currentSpend"],
    ["comparison-last-spend", "lastSpend"],
  ].forEach(([id, key]) => {
    $(id).innerHTML = options;
    $(id).value = comparisonYears[key] || "";
  });
}

function renderCategoryCompare() {
  const years = availableYears();
  const yearOptions = `<option value="">None</option>${years.map((year) => `<option value="${year}">${year}</option>`).join("")}`;
  $("category-compare-type").innerHTML = `
    <option value="aggregate">Grouped</option>
    <option value="granular">Granular</option>
  `;
  $("category-compare-type").value = categoryCompare.categoryType;

  const categories = categoriesForType(categoryCompare.categoryType);
  $("category-compare-category").innerHTML = categories.length
    ? categories.map((category) => `<option value="${category}">${category}</option>`).join("")
    : `<option value="">No categories</option>`;
  $("category-compare-category").value = categoryCompare.category;
  $("category-compare-year-a").innerHTML = yearOptions;
  $("category-compare-year-b").innerHTML = yearOptions;
  $("category-compare-year-a").value = categoryCompare.yearA || "";
  $("category-compare-year-b").value = categoryCompare.yearB || "";

  $("label-category-year-a").textContent = categoryCompare.yearA ? `${categoryCompare.yearA} ${categoryCompare.category}` : "Year A";
  $("label-category-year-b").textContent = categoryCompare.yearB ? `${categoryCompare.yearB} ${categoryCompare.category}` : "Year B";
  renderLineChart($("category-compare-chart"), categoryCompareRows(), [
    categoryCompare.yearA ? { key: "yearA", name: `${categoryCompare.yearA} ${categoryCompare.category}`, color: "#126a8a" } : null,
    categoryCompare.yearB ? { key: "yearB", name: `${categoryCompare.yearB} ${categoryCompare.category}`, color: "#126a8a", dash: "8 7" } : null,
  ].filter(Boolean));
}

function renderMappings() {
  $("category-chips").innerHTML = state.granularCategories
    .map((category) => `<button class="chip ${selectedCategories.has(category) ? "selected" : ""}" data-category="${category}">${category}</button>`)
    .join("");
  $("mapping-list").innerHTML = state.mappings
    .map(
      (mapping) =>
        `<div class="list-row mapping-row">
          <div>
            <strong>${mapping.aggregateCategory}</strong>
            <span>${mapping.granularCategories.join(", ")}</span>
          </div>
          <div class="row-actions">
            <button title="Edit mapping" data-edit-mapping="${mapping.aggregateCategory}">Edit</button>
            <button title="Delete mapping" data-delete-mapping="${mapping.aggregateCategory}">Delete</button>
          </div>
        </div>`
    )
    .join("");
}

function renderBudgets() {
  renderBudgetCategoryOptions();

  $("budget-select").innerHTML =
    state.budgets.length === 0
      ? `<option value="">No budgets</option>`
      : state.budgets.map((budget) => `<option value="${budget.id}">${budget.category} ${budget.period}</option>`).join("");
  if (!selectedBudgetId && state.budgets[0]) selectedBudgetId = state.budgets[0].id;
  $("budget-select").value = selectedBudgetId;

  const selected = state.budgets.find((budget) => budget.id === selectedBudgetId) || state.budgets[0];
  renderBudgetCompareControls(selected);
  renderLineChart($("pacing-chart"), pacingRows(selected), [
    { key: "paced", name: "Paced budget", color: "#5f7f45" },
    { key: "actual", name: "Actual spend", color: "#b24a3b" },
  ]);

  $("budget-list").innerHTML = state.budgets
    .map(
      (budget) => {
        const periodLabel = budget.period === "monthly" ? "monthly recurring" : budget.period;
        return `<div class="list-row budget-row">
          <div><strong>${budget.category}</strong><span>${budget.year} · ${periodLabel} · ${money(budget.amount)}</span></div>
          <div class="row-actions">
            <button title="Edit budget" data-edit-budget="${budget.id}">Edit</button>
            <button title="Delete budget" data-delete-budget="${budget.id}">Delete</button>
          </div>
        </div>`;
      }
    )
    .join("");
}

function renderBudgetCategoryOptions() {
  const aggregateCategories = state.mappings.map((mapping) => mapping.aggregateCategory);
  const categoryOptions = ($("budget-category-type").value === "aggregate" ? aggregateCategories : state.granularCategories)
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("");
  $("budget-category").innerHTML = `<option value="">Category</option>${categoryOptions}`;
}

function renderBudgetCompareControls(selectedBudget) {
  const years = availableYears();
  const selectedYearOption = budgetCompare.year && !years.includes(Number(budgetCompare.year)) ? [Number(budgetCompare.year)] : [];
  const yearOptions = [...selectedYearOption, ...years]
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  $("budget-compare-year").innerHTML = yearOptions || `<option value="${selectedYear}">${selectedYear}</option>`;
  $("budget-compare-year").value = budgetCompare.year || selectedYear;

  $("budget-compare-month").innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return `<option value="${month}">${String(month).padStart(2, "0")}</option>`;
  }).join("");
  $("budget-compare-month").value = budgetCompare.month || new Date().getMonth() + 1;
  $("budget-compare-month-label").style.display = selectedBudget?.period === "monthly" ? "grid" : "none";
}

function renderIncome() {
  const rows = state.transactions
    .filter((row) => row.type === "income")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 18);
  $("income-list").innerHTML = rows
    .map(
      (row) => `<div class="list-row income-row">
        <div><strong>${row.date}</strong><span>${row.granularCategory} · ${row.note || row.source}</span></div>
        <div class="row-actions">
          <span>${money(row.amount)}</span>
          <button title="Edit income" data-edit-income="${row.id}">Edit</button>
          <button title="Delete income" data-delete-income="${row.id}">Delete</button>
        </div>
      </div>`
    )
    .join("");
}

async function saveMapping() {
  const name = $("mapping-name").value.trim();
  if (!name || selectedCategories.size === 0) return;
  const originalName = $("mapping-original-name").value.trim();
  const next = [
    ...state.mappings.filter((mapping) => mapping.aggregateCategory !== name && mapping.aggregateCategory !== originalName),
    {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      aggregateCategory: name,
      granularCategories: [...selectedCategories],
    },
  ];
  await api("/api/mappings", { method: "PUT", body: JSON.stringify(next) });
  $("mapping-original-name").value = "";
  $("mapping-name").value = "";
  $("save-mapping").textContent = "Save mapping";
  selectedCategories = new Set();
  await refresh();
}

async function deleteMapping(name) {
  const next = state.mappings.filter((mapping) => mapping.aggregateCategory !== name);
  await api("/api/mappings", { method: "PUT", body: JSON.stringify(next) });
  if ($("mapping-original-name").value === name) {
    $("mapping-original-name").value = "";
    $("mapping-name").value = "";
    $("save-mapping").textContent = "Save mapping";
    selectedCategories = new Set();
  }
  await refresh();
}

function editMapping(name) {
  const mapping = state.mappings.find((item) => item.aggregateCategory === name);
  if (!mapping) return;
  $("mapping-original-name").value = mapping.aggregateCategory;
  $("mapping-name").value = mapping.aggregateCategory;
  $("save-mapping").textContent = "Save changes";
  selectedCategories = new Set(mapping.granularCategories);
  renderMappings();
}

async function saveBudget() {
  const amount = Number($("budget-amount").value);
  const category = $("budget-category").value;
  if (!amount || !category) return;
  const budgetId = $("budget-id").value || crypto.randomUUID();
  const next = [
    ...state.budgets.filter((budget) => budget.id !== budgetId),
    {
      id: budgetId,
      categoryType: $("budget-category-type").value,
      category,
      period: $("budget-period").value,
      year: Number($("budget-year").value),
      amount,
    },
  ];
  await api("/api/budgets", { method: "PUT", body: JSON.stringify(next) });
  selectedBudgetId = budgetId;
  $("budget-id").value = "";
  $("budget-amount").value = "";
  $("save-budget").textContent = "Add budget";
  await refresh();
}

async function deleteBudget(id) {
  const next = state.budgets.filter((budget) => budget.id !== id);
  await api("/api/budgets", { method: "PUT", body: JSON.stringify(next) });
  if (selectedBudgetId === id) {
    selectedBudgetId = next[0]?.id || "";
  }
  if ($("budget-id").value === id) {
    $("budget-id").value = "";
    $("budget-amount").value = "";
    $("save-budget").textContent = "Add budget";
  }
  await refresh();
}

function editBudget(id) {
  const budget = state.budgets.find((item) => item.id === id);
  if (!budget) return;
  $("budget-id").value = budget.id;
  $("budget-category-type").value = budget.categoryType;
  renderBudgetCategoryOptions();
  $("budget-category").value = budget.category;
  $("budget-period").value = budget.period;
  $("budget-year").value = budget.year;
  $("budget-amount").value = budget.amount;
  $("save-budget").textContent = "Save budget";
  selectedBudgetId = budget.id;
  renderBudgets();
}

async function saveIncome() {
  const payload = {
    id: $("income-id").value || undefined,
    date: $("income-date").value,
    amount: Number($("income-amount").value),
    granularCategory: $("income-category").value || "工资",
    account: "manual",
    note: $("income-note").value,
  };
  if (!payload.date || !payload.amount) return;
  await api("/api/income", { method: "POST", body: JSON.stringify(payload) });
  ["income-id", "income-date", "income-amount", "income-note"].forEach((id) => ($(id).value = ""));
  $("income-category").value = "工资";
  $("save-income").textContent = "Add income";
  await refresh();
}

function wireEvents() {
  $("year-input").value = selectedYear;
  $("budget-year").value = selectedYear;
  $("year-input").addEventListener("change", () => {
    selectedYear = Number($("year-input").value);
    userSelectedYear = true;
    render();
  });
  [
    ["comparison-current-income", "currentIncome"],
    ["comparison-last-income", "lastIncome"],
    ["comparison-current-spend", "currentSpend"],
    ["comparison-last-spend", "lastSpend"],
  ].forEach(([id, key]) => {
    $(id).addEventListener("change", () => {
      comparisonYears[key] = $(id).value ? Number($(id).value) : null;
      render();
    });
  });

  const dropzone = $("dropzone");
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      const text = new TextDecoder("utf-16le").decode(await file.arrayBuffer());
      const result = await api("/api/import/sharkapp", { method: "POST", body: JSON.stringify({ text }) });
      $("status").textContent = `Imported ${result.imported} rows; skipped ${result.skippedDuplicates} duplicates.`;
      await refresh();
    } catch (error) {
      $("status").textContent = error.message;
    }
  });

  $("category-chips").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const category = button.dataset.category;
    selectedCategories.has(category) ? selectedCategories.delete(category) : selectedCategories.add(category);
    renderMappings();
  });

  $("mapping-list").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-mapping]");
    const deleteButton = event.target.closest("[data-delete-mapping]");
    if (editButton) {
      editMapping(editButton.dataset.editMapping);
    }
    if (deleteButton) {
      await deleteMapping(deleteButton.dataset.deleteMapping);
    }
  });

  $("budget-list").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-budget]");
    const deleteButton = event.target.closest("[data-delete-budget]");
    if (editButton) {
      editBudget(editButton.dataset.editBudget);
    }
    if (deleteButton) {
      await deleteBudget(deleteButton.dataset.deleteBudget);
    }
  });

  $("income-list").addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-income]");
    const editButton = event.target.closest("[data-edit-income]");
    if (deleteButton) {
      await api(`/api/income/${deleteButton.dataset.deleteIncome}`, { method: "DELETE" });
      await refresh();
    }
    if (editButton) {
      const row = state.transactions.find((item) => item.id === editButton.dataset.editIncome);
      if (!row) return;
      $("income-id").value = row.id;
      $("income-date").value = row.date;
      $("income-amount").value = row.amount;
      $("income-category").value = row.granularCategory;
      $("income-note").value = row.note;
      $("save-income").textContent = "Save income";
    }
  });

  $("save-mapping").addEventListener("click", () => saveMapping().catch((error) => ($("status").textContent = error.message)));
  $("save-budget").addEventListener("click", () => saveBudget().catch((error) => ($("status").textContent = error.message)));
  $("save-income").addEventListener("click", () => saveIncome().catch((error) => ($("status").textContent = error.message)));
  $("category-compare-type").addEventListener("change", () => {
    categoryCompare.categoryType = $("category-compare-type").value;
    categoryCompare.category = categoriesForType(categoryCompare.categoryType)[0] || "";
    render();
  });
  $("category-compare-category").addEventListener("change", () => {
    categoryCompare.category = $("category-compare-category").value;
    render();
  });
  $("category-compare-year-a").addEventListener("change", () => {
    categoryCompare.yearA = $("category-compare-year-a").value ? Number($("category-compare-year-a").value) : null;
    render();
  });
  $("category-compare-year-b").addEventListener("change", () => {
    categoryCompare.yearB = $("category-compare-year-b").value ? Number($("category-compare-year-b").value) : null;
    render();
  });
  $("import-local").addEventListener("click", async () => {
    try {
      const result = await api("/api/import/local-data", { method: "POST", body: "{}" });
      $("status").textContent = `Processed ${result.processedFiles.length} files; imported ${result.imported} rows; skipped ${result.skippedDuplicates} duplicates.`;
      await refresh();
    } catch (error) {
      $("status").textContent = error.message;
    }
  });
  $("budget-select").addEventListener("change", () => {
    selectedBudgetId = $("budget-select").value;
    render();
  });
  $("budget-compare-year").addEventListener("change", () => {
    budgetCompare.year = Number($("budget-compare-year").value);
    render();
  });
  $("budget-compare-month").addEventListener("change", () => {
    budgetCompare.month = Number($("budget-compare-month").value);
    render();
  });
  $("budget-category-type").addEventListener("change", renderBudgets);
  $("budget-period").addEventListener("change", renderBudgets);
  window.addEventListener("resize", render);
}

wireEvents();
refresh().catch((error) => ($("status").textContent = error.message));
