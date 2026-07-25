const STORAGE_KEYS = {
  endpoint: 'budgetApp.endpointUrl',
  token: 'budgetApp.apiToken',
  cache: 'budgetApp.cachedBootstrap'
};

const state = {
  endpointUrl: localStorage.getItem(STORAGE_KEYS.endpoint) || '',
  token: localStorage.getItem(STORAGE_KEYS.token) || '',
  transactions: [],
  categories: [],
  accounts: [],
  budgets: [],
  bucketAliases: [],
  bucketTransfers: [],
  bucketBalances: [],
  settings: {},
  activeView: 'dashboard'
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  endpointInput: $('#endpointInput'),
  tokenInput: $('#tokenInput'),
  settingsOutput: $('#settingsOutput'),
  setupNotice: $('#setupNotice'),
  sidebarStatusDot: $('#sidebarStatusDot'),
  sidebarStatusTitle: $('#sidebarStatusTitle'),
  sidebarStatusText: $('#sidebarStatusText'),
  viewTitle: $('#viewTitle'),
  transactionDialog: $('#transactionDialog'),
  addTransactionForm: $('#addTransactionForm'),
  toast: $('#toast')
};

function init() {
  elements.endpointInput.value = state.endpointUrl;
  elements.tokenInput.value = state.token;
  wireEvents();
  loadCachedData();
  setDefaultTransactionDate();
  setDefaultTransferDate();
  updateConnectionStatus();
  renderAll();
}

function wireEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-view-link]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
  $$('[data-jump-settings]').forEach((button) => button.addEventListener('click', () => switchView('settings')));

  $('#saveSettingsButton').addEventListener('click', saveSettings);
  $('#testHealthButton').addEventListener('click', testHealth);
  $('#loadDataButton').addEventListener('click', loadBootstrapData);
  $('#refreshButton').addEventListener('click', loadBootstrapData);
  $('#transactionSearch').addEventListener('input', renderTransactionsTable);
  $('#monthFilter').addEventListener('change', renderTransactionsTable);
  $('#categoryFilter').addEventListener('change', renderTransactionsTable);
  $('#budgetMonthFilter').addEventListener('change', renderBudgetsTable);
  const bucketMonthFilter = $('#bucketMonthFilter');
  if (bucketMonthFilter) bucketMonthFilter.addEventListener('change', renderBucketView);

  $('#fabAddTransaction').addEventListener('click', openTransactionDialog);

  $('#openAddTransactionButton').addEventListener('click', openTransactionDialog);
  $('#closeDialogButton').addEventListener('click', closeTransactionDialog);
  $('#cancelTransactionButton').addEventListener('click', closeTransactionDialog);
  elements.addTransactionForm.addEventListener('submit', submitTransaction);
  const transferForm = $('#transferForm');
  if (transferForm) transferForm.addEventListener('submit', submitBucketTransfer);
  const retireForm = $('#retireBucketForm');
  if (retireForm) retireForm.addEventListener('submit', submitRetireBucket);
}

function switchView(view) {
  state.activeView = view;
  $$('.view').forEach((section) => section.classList.remove('active'));
  $(`#${view}View`).classList.add('active');
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  elements.viewTitle.textContent = titleCase(view);
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function saveSettings() {
  state.endpointUrl = elements.endpointInput.value.trim();
  state.token = elements.tokenInput.value.trim();
  localStorage.setItem(STORAGE_KEYS.endpoint, state.endpointUrl);
  localStorage.setItem(STORAGE_KEYS.token, state.token);
  writeOutput('Settings saved locally in this browser.');
  updateConnectionStatus();
}

function requireSettings() {
  if (!state.endpointUrl || !state.token) {
    throw new Error('Missing Apps Script URL or API token. Open Settings and save both values.');
  }
}

async function testHealth() {
  try {
    saveSettings();
    if (!state.endpointUrl) throw new Error('Missing Apps Script URL.');
    const response = await fetch(`${state.endpointUrl}?action=health`, { method: 'GET', redirect: 'follow' });
    const data = await response.json();
    writeOutput(JSON.stringify(data, null, 2));
    if (data.ok) setConnected('Connected', 'Health check passed.');
    else setError(data.error || 'Health check failed.');
  } catch (error) {
    setError(error.message);
    writeOutput(error.message);
  }
}

async function loadBootstrapData() {
  try {
    saveSettings();
    requireSettings();
    setPending('Loading data', 'Fetching converted budget data...');
    const url = `${state.endpointUrl}?action=bootstrap&token=${encodeURIComponent(state.token)}`;
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Bootstrap failed.');
    applyBootstrap(result.data || {});
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(result.data || {}));
    setConnected('Connected', `${state.transactions.length.toLocaleString()} transactions loaded.`);
    writeOutput(JSON.stringify({ ok: true, loaded: summariseLoadedData() }, null, 2));
    showToast('Budget data loaded.');
  } catch (error) {
    setError(error.message);
    writeOutput(error.message);
  }
}

function applyBootstrap(data) {
  state.transactions = normaliseArray(data.transactions).map(normaliseTransaction);
  state.categories = normaliseArray(data.categories).map(normaliseCategory);
  state.accounts = normaliseArray(data.accounts).map(normaliseAccount);
  state.budgets = normaliseArray(data.budgets).map(normaliseBudget);
  state.bucketAliases = normaliseArray(data.bucketAliases || data.BucketAliases).map(normaliseBucketAlias);
  state.bucketTransfers = normaliseArray(data.bucketTransfers || data.BucketTransfers).map(normaliseBucketTransfer);
  state.bucketBalances = normaliseArray(data.bucketBalances || data.BucketBalances).map(normaliseBucketBalance);
  state.settings = data.settings || {};
  renderAll();
}

function normaliseTransaction(transaction) {
  const categoryId = transaction.categoryId || transaction.categoryID || transaction.CategoryId || transaction.CategoryID || '';
  const accountId = transaction.accountId || transaction.accountID || transaction.AccountId || transaction.AccountID || '';
  return {
    ...transaction,
    transactionDate: normaliseDateValue(transaction.transactionDate),
    amount: parseMoneyValue(transaction.amount),
    categoryId,
    accountId
  };
}

function normaliseBudget(budget) {
  return {
    ...budget,
    categoryId: budget.categoryId || budget.categoryID || budget.CategoryId || budget.CategoryID || '',
    budgetMonth: normaliseMonthValue(budget.budgetMonth),
    plannedAmount: parseMoneyValue(budget.plannedAmount)
  };
}

function normaliseCategory(category) {
  return { ...category, id: category.id || category.ID || '' };
}

function normaliseAccount(account) {
  return {
    ...account,
    id: account.id || account.ID || '',
    bucketId: account.bucketId || account.bucketID || account.BucketId || account.BucketID || bucketIdFromAny(account.id || account.name || ''),
    currentBalance: parseMoneyValue(account.currentBalance),
    isActive: normaliseBoolean(account.isActive),
    retiredAt: account.retiredAt || ''
  };
}

function normaliseBucketAlias(alias) {
  return {
    ...alias,
    alias: alias.alias || '',
    currentBucketId: alias.currentBucketId || alias.currentBucketID || '',
    currentBucketName: alias.currentBucketName || '',
    status: alias.status || '',
    netAmount: parseMoneyValue(alias.netAmount)
  };
}

function normaliseBucketTransfer(transfer) {
  return {
    ...transfer,
    id: transfer.id || '',
    transferDate: normaliseDateValue(transfer.transferDate),
    fromBucketId: transfer.fromBucketId || transfer.fromBucketID || '',
    toBucketId: transfer.toBucketId || transfer.toBucketID || '',
    amount: parseMoneyValue(transfer.amount),
    reason: transfer.reason || ''
  };
}

function normaliseBucketBalance(balance) {
  return {
    ...balance,
    bucketId: balance.bucketId || balance.bucketID || '',
    bucketName: balance.bucketName || '',
    currentBalance: parseMoneyValue(balance.currentBalance),
    totalFunded: parseMoneyValue(balance.totalFunded),
    totalSpent: parseMoneyValue(balance.totalSpent),
    transactionCount: Number(balance.transactionCount || 0)
  };
}

function normaliseBoolean(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return true;
  return !['false', 'no', '0', 'inactive'].includes(text);
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let text = String(value).trim();
  if (!text) return 0;
  let isNegative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    isNegative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$,\s]/g, '');
  if (text.startsWith('-')) {
    isNegative = true;
    text = text.slice(1);
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 0;
  return isNegative ? -parsed : parsed;
}

function normaliseDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function loadCachedData() {
  try {
    const cached = localStorage.getItem(STORAGE_KEYS.cache);
    if (cached) applyBootstrap(JSON.parse(cached));
  } catch (error) {
    console.warn('Unable to load cached data', error);
  }
}

function normaliseArray(value) {
  return Array.isArray(value) ? value : [];
}

function summariseLoadedData() {
  return {
    transactions: state.transactions.length,
    categories: state.categories.length,
    accounts: state.accounts.length,
    budgets: state.budgets.length,
    bucketAliases: state.bucketAliases.length,
    bucketTransfers: state.bucketTransfers.length,
    bucketBalances: state.bucketBalances.length
  };
}

async function callPost(action, payload) {
  requireSettings();
  const response = await fetch(state.endpointUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: state.token, action, payload })
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || `${action} failed.`);
  return result;
}

function openTransactionDialog() {
  populateTransactionSelects();
  setDefaultTransactionDate();
  setDefaultTransferDate();
  if (typeof elements.transactionDialog.showModal === 'function') elements.transactionDialog.showModal();
}

function closeTransactionDialog() {
  elements.transactionDialog.close();
  elements.addTransactionForm.reset();
  setDefaultTransactionDate();
  setDefaultTransferDate();
}

async function submitTransaction(event) {
  event.preventDefault();
  try {
    const payload = {
      transactionDate: $('#transactionDateInput').value,
      description: $('#descriptionInput').value.trim(),
      merchant: $('#merchantInput').value.trim(),
      amount: -Math.abs(parseMoneyValue($('#amountInput').value)),
      categoryId: $('#transactionCategoryInput').value || categoryIdForAccount(state.accounts.find((account) => account.id === $('#transactionAccountInput').value) || {}),
      accountId: $('#transactionAccountInput').value,
      notes: $('#notesInput').value.trim()
    };
    const result = await callPost('createTransaction', payload);
    state.transactions.push(result.transaction);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    closeTransactionDialog();
    showToast('Transaction saved to Google Sheets.');
  } catch (error) {
    showToast(error.message);
  }
}

async function submitBucketTransfer(event) {
  event.preventDefault();
  try {
    const fromBucketId = $('#transferFromBucketInput').value;
    const toBucketId = $('#transferToBucketInput').value;
    const amount = Math.abs(parseMoneyValue($('#transferAmountInput').value));
    if (!amount) throw new Error('Transfer amount is required.');
    if (fromBucketId === toBucketId) throw new Error('Choose two different buckets for a transfer.');
    const payload = {
      transferDate: $('#transferDateInput').value,
      fromBucketId,
      toBucketId,
      amount,
      reason: $('#transferReasonInput').value.trim()
    };
    const result = await callPost('createBucketTransfer', payload);
    if (result.transfer) state.bucketTransfers.push(normaliseBucketTransfer(result.transfer));
    if (Array.isArray(result.transactions)) state.transactions.push(...result.transactions.map(normaliseTransaction));
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    event.target.reset();
    setDefaultTransferDate();
    showToast('Bucket transfer saved.');
  } catch (error) {
    showToast(error.message);
  }
}

async function submitRetireBucket(event) {
  event.preventDefault();
  try {
    const sourceBucketId = $('#retireSourceBucketInput').value;
    const targetBucketId = $('#retireTargetBucketInput').value;
    if (!sourceBucketId || !targetBucketId) throw new Error('Choose a source and target bucket.');
    if (sourceBucketId === targetBucketId) throw new Error('A bucket cannot be retired into itself.');
    const payload = {
      sourceBucketId,
      targetBucketId,
      reason: $('#retireReasonInput').value.trim(),
      transferBalance: $('#transferRetiredBalanceInput').checked
    };
    await callPost('retireBucket', payload);
    showToast('Bucket retirement saved. Reloading data.');
    await loadBootstrapData();
  } catch (error) {
    showToast(error.message);
  }
}

function getCacheShape() {
  return {
    transactions: state.transactions,
    categories: state.categories,
    accounts: state.accounts,
    budgets: state.budgets,
    bucketAliases: state.bucketAliases,
    bucketTransfers: state.bucketTransfers,
    bucketBalances: state.bucketBalances,
    settings: state.settings
  };
}

function renderAll() {
  renderSetupNotice();
  renderFilters();
  renderDashboard();
  renderTransactionsTable();
  renderBudgetsTable();
  renderBucketView();
  renderTransferHistory();
  renderAliasTable();
  renderCategoriesAndAccounts();
  populateTransactionSelects();
  populateBucketControls();
}

function renderSetupNotice() {
  const isReady = Boolean(state.endpointUrl && state.token && state.transactions.length);
  elements.setupNotice.classList.toggle('hidden', isReady);
}

function renderFilters() {
  const months = unique(state.transactions.map((t) => transactionMonth(t.transactionDate)).filter(Boolean)).sort().reverse();
  fillSelect($('#monthFilter'), [{ value: '', label: 'All months' }, ...months.map((m) => ({ value: m, label: m }))]);
  fillSelect($('#budgetMonthFilter'), [{ value: '', label: 'All budget months' }, ...unique(state.budgets.map((b) => b.budgetMonth).filter(Boolean)).sort().reverse().map((m) => ({ value: m, label: m }))]);
  const bucketMonthFilter = $('#bucketMonthFilter');
  if (bucketMonthFilter) fillSelect(bucketMonthFilter, unique([...state.transactions.map((t) => transactionMonth(t.transactionDate)), ...state.budgets.map((b) => normaliseMonthValue(b.budgetMonth))].filter(Boolean)).sort().reverse().map((m) => ({ value: m, label: m })));
  fillSelect($('#categoryFilter'), [{ value: '', label: 'All categories' }, ...state.categories.map((c) => ({ value: c.id, label: c.name || c.id }))]);
}

function fillSelect(select, options) {
  const current = select.value;
  select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
  if (options.some((option) => option.value === current)) select.value = current;
}

function renderDashboard() {
  const currentMonth = getSelectedBucketMonth();
  const bucketRows = buildBucketRows(currentMonth);
  const planned = sum(bucketRows.map((row) => row.planned));
  const spent = sum(bucketRows.map((row) => row.spent));
  const funded = sum(bucketRows.map((row) => row.funded));
  const available = sum(bucketRows.map((row) => row.currentBalance));

  $('#metricIncome').textContent = formatCurrency(planned);
  $('#metricSpending').textContent = formatCurrency(spent);
  $('#metricNet').textContent = formatCurrency(available);
  $('#metricNet').parentElement.classList.toggle('negative', available < 0);
  $('#metricTransactions').textContent = bucketRows.length.toLocaleString();
  $('#categoryMonthLabel').textContent = currentMonth ? `Month: ${currentMonth}` : '';

  renderCategoryBreakdown(state.transactions.filter((t) => transactionMonth(t.transactionDate) === currentMonth));
  renderRecentTransactions();
}

function renderCategoryBreakdown(txns) {
  const container = $('#categoryBreakdown');
  const spending = txns.filter((t) => Number(t.amount) < 0);
  const byBucket = new Map();
  spending.forEach((txn) => {
    byBucket.set(txn.accountId, (byBucket.get(txn.accountId) || 0) + Math.abs(Number(txn.amount)));
  });
  const rows = Array.from(byBucket.entries()).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const max = rows.length ? rows[0][1] : 0;
  if (!rows.length) {
    container.className = 'breakdown-list empty-state';
    container.textContent = 'No spending transactions for the selected month.';
    return;
  }
  container.className = 'breakdown-list';
  container.innerHTML = rows.map(([accountId, amount]) => {
    const pct = max ? Math.max(4, Math.round((amount / max) * 100)) : 0;
    return `<div class="breakdown-row"><div class="breakdown-row-top"><strong>${escapeHtml(accountName(accountId))}</strong><span>${formatCurrency(amount)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
}

function renderRecentTransactions() {
  const container = $('#recentTransactions');
  const recent = [...state.transactions].filter((t) => t.transactionDate).sort((a,b) => String(b.transactionDate).localeCompare(String(a.transactionDate))).slice(0, 8);
  if (!recent.length) {
    container.className = 'compact-list empty-state';
    container.textContent = 'No transactions loaded yet.';
    return;
  }
  container.className = 'compact-list';
  container.innerHTML = recent.map((txn) => `<div class="compact-row"><div class="compact-row-top"><strong>${escapeHtml(txn.description || txn.merchant || 'Transaction')}</strong><span class="${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount))}</span></div><small>${escapeHtml(txn.transactionDate || '')} • ${escapeHtml(accountName(txn.accountId))}</small></div>`).join('');
}

function renderTransactionsTable() {
  const body = $('#transactionsTableBody');
  const query = $('#transactionSearch').value.trim().toLowerCase();
  const month = $('#monthFilter').value;
  const category = $('#categoryFilter').value;
  const filtered = state.transactions.filter((txn) => {
    const haystack = [txn.description, txn.merchant, txn.notes, txn.transactionDate].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!month || transactionMonth(txn.transactionDate) === month) && (!category || txn.categoryId === category);
  }).sort((a,b) => String(b.transactionDate).localeCompare(String(a.transactionDate))).slice(0, 500);
  body.innerHTML = filtered.map((txn) => `<tr><td>${escapeHtml(txn.transactionDate || '')}</td><td>${escapeHtml(txn.description || '')}</td><td>${escapeHtml(txn.merchant || '')}</td><td>${escapeHtml(categoryName(txn.categoryId))}</td><td>${escapeHtml(accountName(txn.accountId))}</td><td class="amount-col ${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount || 0))}</td></tr>`).join('') || `<tr><td colspan="6">No transactions match the current filters.</td></tr>`;
}

function renderBudgetsTable() {
  const body = $('#budgetsTableBody');
  const month = $('#budgetMonthFilter').value;
  const rows = state.budgets.filter((budget) => !month || budget.budgetMonth === month).sort((a,b) => String(b.budgetMonth).localeCompare(String(a.budgetMonth))).slice(0, 500);
  body.innerHTML = rows.map((budget) => `<tr><td>${escapeHtml(budget.budgetMonth || '')}</td><td>${escapeHtml(categoryName(budget.categoryId))}</td><td class="amount-col">${formatCurrency(Number(budget.plannedAmount || 0))}</td><td>${escapeHtml(budget.notes || '')}</td></tr>`).join('') || `<tr><td colspan="4">No budgets loaded.</td></tr>`;
}

function renderBucketView() {
  const body = $('#bucketsTableBody');
  if (!body) return;
  const month = getSelectedBucketMonth();
  const rows = buildBucketRows(month);
  $('#bucketMetricPlanned').textContent = formatCurrency(sum(rows.map((row) => row.planned)));
  $('#bucketMetricFunded').textContent = formatCurrency(sum(rows.map((row) => row.funded)));
  $('#bucketMetricSpent').textContent = formatCurrency(sum(rows.map((row) => row.spent)));
  $('#bucketMetricAvailable').textContent = formatCurrency(sum(rows.map((row) => row.currentBalance)));
  body.innerHTML = rows.map((row) => {
    const statusClass = row.currentBalance < 0 ? 'status-danger' : row.monthRemaining < 0 ? 'status-warning' : 'status-ok';
    const statusText = row.currentBalance < 0 ? 'Negative balance' : row.monthRemaining < 0 ? 'Over monthly plan' : 'On track';
    return `<tr><td class="bucket-name-cell"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.id)}</small></td><td class="amount-col">${formatCurrency(row.planned)}</td><td class="amount-col amount-positive">${formatCurrency(row.funded)}</td><td class="amount-col amount-negative">${formatCurrency(row.spent)}</td><td class="amount-col ${row.monthRemaining < 0 ? 'amount-negative' : ''}">${formatCurrency(row.monthRemaining)}</td><td class="amount-col ${row.currentBalance < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(row.currentBalance)}</td><td><span class="status-pill ${statusClass}">${statusText}</span></td></tr>`;
  }).join('') || `<tr><td colspan="7">No bucket data loaded.</td></tr>`;
}

function buildBucketRows(month) {
  const bucketAccounts = activeBucketAccounts();
  return bucketAccounts.map((account) => {
    const accountId = account.id;
    const bucketId = effectiveBucketId(account.bucketId || account.id);
    const categoryId = categoryIdForAccount(account);
    const monthTransactions = state.transactions.filter((txn) => effectiveBucketId(txn.bucketId || txn.accountId) === bucketId && transactionMonth(txn.transactionDate) === month);
    const allTransactions = state.transactions.filter((txn) => effectiveBucketId(txn.bucketId || txn.accountId) === bucketId);
    const planned = sum(state.budgets.filter((budget) => normaliseMonthValue(budget.budgetMonth) === month && (effectiveBucketId(budget.bucketId || budget.categoryId) === bucketId || budgetMatchesBucket(budget, account, categoryId))).map((budget) => Number(budget.plannedAmount) || 0));
    const funded = sum(monthTransactions.filter((txn) => Number(txn.amount) > 0).map((txn) => Number(txn.amount)));
    const spent = sum(monthTransactions.filter((txn) => Number(txn.amount) < 0).map((txn) => Math.abs(Number(txn.amount))));
    const currentBalance = sum(allTransactions.map((txn) => Number(txn.amount) || 0));
    return {
      id: bucketId,
      name: account.name || bucketId,
      planned,
      funded,
      spent,
      monthRemaining: planned - spent,
      currentBalance
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function isBudgetBucket(account) {
  const id = String(account.id || '').toLowerCase();
  const bucketId = String(account.bucketId || '').toLowerCase();
  const type = String(account.accountType || '').toLowerCase();
  return id !== 'acct_income' && bucketId !== 'income' && type !== 'income_source';
}

function categoryIdForAccount(account) {
  const fromAccount = 'cat_' + bucketIdFromAny(account.bucketId || account.id || account.name || '');
  if (state.categories.some((category) => category.id === fromAccount)) return fromAccount;
  const accountSlug = slugify(account.name || account.id || '');
  const match = state.categories.find((category) => slugify(category.name || category.id || '') === accountSlug);
  return match ? match.id : fromAccount;
}

function budgetMatchesBucket(budget, account, categoryId) {
  if (budget.categoryId === categoryId) return true;
  const budgetCategoryName = categoryName(budget.categoryId);
  return slugify(budgetCategoryName) === slugify(account.name || account.id || '');
}

function getSelectedBucketMonth() {
  const select = $('#bucketMonthFilter');
  return (select && select.value) || getMostRecentMonth() || currentYearMonth();
}

function normaliseMonthValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 7);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}/.test(text)) return text.slice(0, 7);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 7);
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function activeBucketAccounts() {
  return state.accounts.filter((account) => isBudgetBucket(account) && account.isActive !== false && !account.retiredAt);
}

function retiredBucketAccounts() {
  return state.accounts.filter((account) => isBudgetBucket(account) && (account.isActive === false || account.retiredAt));
}

function populateBucketControls() {
  const activeOptions = activeBucketAccounts().map((account) => ({ value: effectiveBucketId(account.bucketId || account.id), label: account.name || account.bucketId || account.id }));
  const allBucketOptions = state.accounts.filter(isBudgetBucket).map((account) => ({ value: account.bucketId || bucketIdFromAny(account.id || account.name), label: `${account.name || account.id}${account.isActive === false || account.retiredAt ? ' (retired)' : ''}` }));
  const transferFrom = $('#transferFromBucketInput');
  const transferTo = $('#transferToBucketInput');
  const retireSource = $('#retireSourceBucketInput');
  const retireTarget = $('#retireTargetBucketInput');
  if (transferFrom) fillSelect(transferFrom, activeOptions);
  if (transferTo) fillSelect(transferTo, activeOptions);
  if (retireSource) fillSelect(retireSource, allBucketOptions);
  if (retireTarget) fillSelect(retireTarget, activeOptions);
}

function renderTransferHistory() {
  const body = $('#transfersTableBody');
  if (!body) return;
  const rows = [...state.bucketTransfers].sort((a,b) => String(b.transferDate).localeCompare(String(a.transferDate))).slice(0, 200);
  body.innerHTML = rows.map((transfer) => `<tr><td>${escapeHtml(transfer.transferDate || '')}</td><td>${escapeHtml(bucketNameById(transfer.fromBucketId))}</td><td>${escapeHtml(bucketNameById(transfer.toBucketId))}</td><td class="amount-col">${formatCurrency(transfer.amount)}</td><td>${escapeHtml(transfer.reason || '')}</td></tr>`).join('') || `<tr><td colspan="5">No transfers recorded yet.</td></tr>`;
}

function renderAliasTable() {
  const body = $('#bucketAliasTableBody');
  if (!body) return;
  const rows = [...state.bucketAliases].sort((a,b) => String(a.status).localeCompare(String(b.status)) || String(a.alias).localeCompare(String(b.alias)));
  body.innerHTML = rows.map((alias) => {
    const statusClass = String(alias.status).toLowerCase() === 'active' ? 'alias-active' : 'alias-retired';
    return `<tr><td>${escapeHtml(alias.alias || '')}</td><td>${escapeHtml(alias.currentBucketName || bucketNameById(alias.currentBucketId))}</td><td class="${statusClass}">${escapeHtml(alias.status || '')}</td><td class="amount-col ${amountClass(alias.netAmount)}">${formatCurrency(alias.netAmount)}</td></tr>`;
  }).join('') || `<tr><td colspan="4">No aliases loaded.</td></tr>`;
}

function effectiveBucketId(bucketIdOrAlias) {
  const raw = bucketIdFromAny(bucketIdOrAlias);
  const alias = state.bucketAliases.find((entry) => bucketIdFromAny(entry.alias) === raw || bucketIdFromAny(entry.sourceAccountId) === raw || bucketIdFromAny(entry.sourceCategoryId) === raw);
  return alias && alias.currentBucketId ? alias.currentBucketId : raw;
}

function bucketNameById(bucketId) {
  const effective = effectiveBucketId(bucketId);
  const account = state.accounts.find((item) => bucketIdFromAny(item.bucketId || item.id) === effective);
  if (account) return account.name || effective;
  const alias = state.bucketAliases.find((item) => item.currentBucketId === effective);
  return alias ? alias.currentBucketName || effective : effective;
}

function bucketIdFromAny(value) {
  let text = String(value || '').trim();
  text = text.replace(/^acct_/, '').replace(/^cat_/, '');
  return slugify(text);
}

function renderCategoriesAndAccounts() {
  $('#categoriesList').className = state.categories.length ? 'tag-list' : 'tag-list empty-state';
  $('#categoriesList').innerHTML = state.categories.length ? state.categories.map((c) => `<div class="tag-pill"><strong>${escapeHtml(c.name || c.id)}</strong><span>${escapeHtml(c.type || '')}</span></div>`).join('') : 'No categories loaded.';

  $('#accountsList').className = state.accounts.length ? 'tag-list' : 'tag-list empty-state';
  $('#accountsList').innerHTML = state.accounts.length ? state.accounts.map((a) => `<div class="tag-pill"><strong>${escapeHtml(a.name || a.id)}</strong><span>${escapeHtml(a.accountType || '')}</span></div>`).join('') : 'No accounts loaded.';

  $('#accountsTableBody').innerHTML = state.accounts.map((a) => `<tr><td>${escapeHtml(a.name || '')}</td><td>${escapeHtml(a.accountType || '')}</td><td>${escapeHtml(a.institution || '')}</td><td>${String(a.isActive)}</td></tr>`).join('') || `<tr><td colspan="4">No accounts loaded.</td></tr>`;
}

function populateTransactionSelects() {
  fillSelect($('#transactionCategoryInput'), state.categories.map((c) => ({ value: c.id, label: c.name || c.id })));
  fillSelect($('#transactionAccountInput'), activeBucketAccounts().map((a) => ({ value: a.id, label: a.name || a.id })));
}

function categoryName(id) {
  const found = state.categories.find((c) => c.id === id);
  return found ? found.name || id : id || '';
}

function accountName(id) {
  const found = state.accounts.find((a) => a.id === id);
  return found ? found.name || id : id || '';
}

function getMostRecentMonth() {
  return unique(state.transactions.map((t) => transactionMonth(t.transactionDate)).filter(Boolean)).sort().pop();
}

function transactionMonth(dateText) {
  return typeof dateText === 'string' && /^\d{4}-\d{2}/.test(dateText) ? dateText.slice(0, 7) : '';
}

function currentYearMonth() {
  return new Date().toISOString().slice(0,7);
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function unique(values) {
  return Array.from(new Set(values));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

function amountClass(value) {
  const number = Number(value) || 0;
  if (number < 0) return 'amount-negative';
  if (number > 0) return 'amount-positive';
  return '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function setDefaultTransactionDate() {
  const input = $('#transactionDateInput');
  if (input) input.value = new Date().toISOString().slice(0, 10);
}

function setDefaultTransferDate() {
  const input = $('#transferDateInput');
  if (input) input.value = new Date().toISOString().slice(0, 10);
}

function updateConnectionStatus() {
  if (state.endpointUrl && state.token) setPending('Ready to load', 'Settings are saved. Load data to connect.');
  else setPending('Not connected', 'Add Apps Script URL and API token.');
}

function setPending(title, text) {
  elements.sidebarStatusDot.className = 'status-dot';
  elements.sidebarStatusTitle.textContent = title;
  elements.sidebarStatusText.textContent = text;
}

function setConnected(title, text) {
  elements.sidebarStatusDot.className = 'status-dot connected';
  elements.sidebarStatusTitle.textContent = title;
  elements.sidebarStatusText.textContent = text;
}

function setError(message) {
  elements.sidebarStatusDot.className = 'status-dot error';
  elements.sidebarStatusTitle.textContent = 'Connection issue';
  elements.sidebarStatusText.textContent = message;
  showToast(message);
}

function writeOutput(message) {
  elements.settingsOutput.textContent = message;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  window.setTimeout(() => elements.toast.classList.remove('show'), 3200);
}

document.addEventListener('DOMContentLoaded', init);

// --- v6 overrides: active-bucket repair, budget builder, and removed categories/accounts views ---
const ACTIVE_BUCKET_NAMES_V6 = ['Career', 'Tithing', 'Food', 'Savings', 'Car', 'Other Expenses', 'Fun', 'Taxes', 'Rent', '401K', 'Stocks'];
const ACTIVE_BUCKET_IDS_V6 = new Set(ACTIVE_BUCKET_NAMES_V6.map((name) => slugify(name)));

function normaliseTransaction(transaction) {
  const categoryId = transaction.categoryId || transaction.categoryID || transaction.CategoryId || transaction.CategoryID || '';
  const accountId = transaction.accountId || transaction.accountID || transaction.AccountId || transaction.AccountID || '';
  const bucketId = transaction.bucketId || transaction.bucketID || transaction.BucketId || transaction.BucketID || bucketIdFromAny(accountId || categoryId || '');
  return {
    ...transaction,
    transactionDate: normaliseDateValue(transaction.transactionDate),
    amount: parseMoneyValue(transaction.amount),
    transactionType: transaction.transactionType || transaction.type || '',
    bucketId: bucketIdFromAny(bucketId),
    categoryId,
    accountId
  };
}

function normaliseBudget(budget) {
  const categoryId = budget.categoryId || budget.categoryID || budget.CategoryId || budget.CategoryID || '';
  const bucketId = budget.bucketId || budget.bucketID || budget.BucketId || budget.BucketID || bucketIdFromAny(categoryId || '');
  return {
    ...budget,
    bucketId: bucketIdFromAny(bucketId),
    categoryId,
    budgetMonth: normaliseMonthValue(budget.budgetMonth),
    plannedAmount: parseMoneyValue(budget.plannedAmount),
    notes: budget.notes || ''
  };
}

function normaliseCategory(category) {
  return {
    ...category,
    id: category.id || category.ID || '',
    bucketId: bucketIdFromAny(category.bucketId || category.bucketID || category.id || category.name || ''),
    isActive: normaliseBoolean(category.isActive),
    retiredAt: safeRetiredAt(category.retiredAt)
  };
}

function normaliseAccount(account) {
  return {
    ...account,
    id: account.id || account.ID || '',
    bucketId: bucketIdFromAny(account.bucketId || account.bucketID || account.BucketId || account.BucketID || account.id || account.name || ''),
    currentBalance: parseMoneyValue(account.currentBalance),
    isActive: normaliseBoolean(account.isActive),
    retiredAt: safeRetiredAt(account.retiredAt)
  };
}

function safeRetiredAt(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function isBudgetBucket(account) {
  const id = String(account.id || '').toLowerCase();
  const bucketId = bucketIdFromAny(account.bucketId || account.id || account.name || '');
  const type = String(account.accountType || '').toLowerCase();
  return id !== 'acct_income' && bucketId !== 'income' && type !== 'income_source' && ACTIVE_BUCKET_IDS_V6.has(bucketId);
}

function isAccountRetired(account) {
  const bucketId = bucketIdFromAny(account.bucketId || account.id || account.name || '');
  const aliasRetired = state.bucketAliases.some((alias) => String(alias.status || '').toLowerCase() === 'retired' && (
    bucketIdFromAny(alias.alias) === bucketId ||
    bucketIdFromAny(alias.sourceAccountId) === bucketId ||
    bucketIdFromAny(alias.sourceCategoryId) === bucketId
  ));
  if (ACTIVE_BUCKET_IDS_V6.has(bucketId) && account.isActive !== false && !aliasRetired) return false;
  return account.isActive === false || aliasRetired;
}

function activeBucketAccounts() {
  return state.accounts
    .filter((account) => isBudgetBucket(account) && !isAccountRetired(account))
    .sort((a, b) => ACTIVE_BUCKET_NAMES_V6.indexOf(a.name) - ACTIVE_BUCKET_NAMES_V6.indexOf(b.name));
}

function retiredBucketAccounts() {
  return state.accounts.filter((account) => isBudgetBucket(account) && isAccountRetired(account));
}

function effectiveBucketId(bucketIdOrAlias) {
  const raw = bucketIdFromAny(bucketIdOrAlias);
  const alias = state.bucketAliases.find((entry) => String(entry.status || '').toLowerCase() === 'retired' && (
    bucketIdFromAny(entry.alias) === raw ||
    bucketIdFromAny(entry.sourceAccountId) === raw ||
    bucketIdFromAny(entry.sourceCategoryId) === raw
  ));
  return alias && alias.currentBucketId ? bucketIdFromAny(alias.currentBucketId) : raw;
}

function bucketNameById(bucketId) {
  const effective = effectiveBucketId(bucketId);
  const account = state.accounts.find((item) => bucketIdFromAny(item.bucketId || item.id || item.name) === effective);
  if (account) return account.name || effective;
  const byActive = ACTIVE_BUCKET_NAMES_V6.find((name) => slugify(name) === effective);
  return byActive || effective;
}

function buildBucketRows(month) {
  return activeBucketAccounts().map((account) => {
    const bucketId = effectiveBucketId(account.bucketId || account.id || account.name);
    const monthTransactions = state.transactions.filter((txn) => effectiveBucketId(txn.bucketId || txn.accountId) === bucketId && transactionMonth(txn.transactionDate) === month);
    const allTransactions = state.transactions.filter((txn) => effectiveBucketId(txn.bucketId || txn.accountId) === bucketId);
    const planned = sum(state.budgets
      .filter((budget) => normaliseMonthValue(budget.budgetMonth) === month && effectiveBucketId(budget.bucketId || budget.categoryId) === bucketId)
      .map((budget) => Number(budget.plannedAmount) || 0));
    const funded = sum(monthTransactions.filter((txn) => Number(txn.amount) > 0).map((txn) => Number(txn.amount)));
    const spent = sum(monthTransactions.filter((txn) => Number(txn.amount) < 0).map((txn) => Math.abs(Number(txn.amount))));
    const currentBalance = sum(allTransactions.map((txn) => Number(txn.amount) || 0));
    return {
      id: bucketId,
      name: account.name || bucketNameById(bucketId),
      planned,
      funded,
      spent,
      monthRemaining: planned - spent,
      currentBalance
    };
  });
}

function populateBucketControls() {
  const activeOptions = activeBucketAccounts().map((account) => ({
    value: effectiveBucketId(account.bucketId || account.id || account.name),
    label: account.name || bucketNameById(account.bucketId || account.id)
  }));
  const transferFrom = $('#transferFromBucketInput');
  const transferTo = $('#transferToBucketInput');
  const retireSource = $('#retireSourceBucketInput');
  const retireTarget = $('#retireTargetBucketInput');
  if (transferFrom) fillSelect(transferFrom, activeOptions);
  if (transferTo) fillSelect(transferTo, activeOptions);
  if (retireSource) fillSelect(retireSource, activeOptions);
  if (retireTarget) fillSelect(retireTarget, activeOptions);
}

function renderCategoryBreakdown(txns) {
  const container = $('#categoryBreakdown');
  const spending = txns.filter((t) => Number(t.amount) < 0);
  const byBucket = new Map();
  spending.forEach((txn) => {
    const bucketId = effectiveBucketId(txn.bucketId || txn.accountId);
    byBucket.set(bucketId, (byBucket.get(bucketId) || 0) + Math.abs(Number(txn.amount)));
  });
  const rows = Array.from(byBucket.entries()).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const max = rows.length ? rows[0][1] : 0;
  if (!rows.length) {
    container.className = 'breakdown-list empty-state';
    container.textContent = 'No spending transactions for the selected month.';
    return;
  }
  container.className = 'breakdown-list';
  container.innerHTML = rows.map(([bucketId, amount]) => {
    const pct = max ? Math.max(4, Math.round((amount / max) * 100)) : 0;
    return `<div class="breakdown-row"><div class="breakdown-row-top"><strong>${escapeHtml(bucketNameById(bucketId))}</strong><span>${formatCurrency(amount)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
}

function renderCategoriesAndAccounts() {
  // Removed from the UI. Kept as a no-op so older cached pages do not break.
}

function budgetMonthOptions() {
  const months = unique([
    ...state.budgets.map((budget) => normaliseMonthValue(budget.budgetMonth)),
    ...state.transactions.map((transaction) => transactionMonth(transaction.transactionDate)),
    currentYearMonth()
  ].filter(Boolean)).sort().reverse();
  return months.map((month) => ({ value: month, label: month }));
}

function renderBudgetsTable() {
  renderBudgetBuilder();
}

function renderBudgetBuilder() {
  const body = $('#budgetBuilderTableBody');
  if (!body) return;
  const monthSelect = $('#budgetMonthFilter');
  const month = (monthSelect && monthSelect.value) || getMostRecentMonth() || currentYearMonth();
  const activeAccounts = activeBucketAccounts();
  const existingByBucket = new Map();
  state.budgets.filter((budget) => normaliseMonthValue(budget.budgetMonth) === month).forEach((budget) => {
    existingByBucket.set(effectiveBucketId(budget.bucketId || budget.categoryId), budget);
  });
  body.innerHTML = activeAccounts.map((account) => {
    const bucketId = effectiveBucketId(account.bucketId || account.id || account.name);
    const existing = existingByBucket.get(bucketId) || {};
    return `<tr data-budget-bucket-id="${escapeHtml(bucketId)}"><td class="bucket-name-cell"><strong>${escapeHtml(account.name || bucketNameById(bucketId))}</strong><small>${escapeHtml(bucketId)}</small></td><td class="amount-col"><input class="budget-planned-input" type="number" step="0.01" min="0" value="${Number(existing.plannedAmount || 0)}" /></td><td><input class="budget-notes-input" type="text" value="${escapeHtml(existing.notes || '')}" placeholder="Optional notes" /></td></tr>`;
  }).join('') || `<tr><td colspan="3">No active buckets loaded.</td></tr>`;
  const count = $('#budgetBuilderBucketCount');
  if (count) count.textContent = activeAccounts.length.toLocaleString();
  const monthLabel = $('#budgetBuilderMonthLabel');
  if (monthLabel) monthLabel.textContent = month || '--';
  updateBudgetBuilderTotal();
  $$('.budget-planned-input').forEach((input) => input.addEventListener('input', updateBudgetBuilderTotal));
}

function updateBudgetBuilderTotal() {
  const total = sum($$('.budget-planned-input').map((input) => parseMoneyValue(input.value)));
  const totalNode = $('#budgetBuilderTotal');
  if (totalNode) totalNode.textContent = formatCurrency(total);
  const statusNode = $('#budgetBuilderStatus');
  if (statusNode) statusNode.textContent = total > 0 ? 'Draft' : 'Ready';
}

function useCurrentBudgetMonth() {
  const select = $('#budgetMonthFilter');
  if (!select) return;
  const current = currentYearMonth();
  if (![...select.options].some((option) => option.value === current)) {
    select.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(current)}">${escapeHtml(current)}</option>`);
  }
  select.value = current;
  renderBudgetBuilder();
}

async function saveBudgetPlan() {
  try {
    const month = ($('#budgetMonthFilter') && $('#budgetMonthFilter').value) || currentYearMonth();
    const rows = $$('#budgetBuilderTableBody tr[data-budget-bucket-id]').map((row) => {
      const bucketId = row.dataset.budgetBucketId;
      return {
        bucketId,
        categoryId: `cat_${bucketId}`,
        plannedAmount: parseMoneyValue(row.querySelector('.budget-planned-input').value),
        notes: row.querySelector('.budget-notes-input').value.trim()
      };
    });
    const result = await callPost('saveBudgetPlan', { budgetMonth: month, rows });
    if (Array.isArray(result.budgets)) {
      state.budgets = state.budgets.filter((budget) => normaliseMonthValue(budget.budgetMonth) !== month).concat(result.budgets.map(normaliseBudget));
      localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
      renderAll();
    }
    showToast('Budget plan saved.');
  } catch (error) {
    showToast(error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const saveBudgetPlanButton = $('#saveBudgetPlanButton');
  if (saveBudgetPlanButton) saveBudgetPlanButton.addEventListener('click', saveBudgetPlan);
  const addBudgetMonthButton = $('#addBudgetMonthButton');
  if (addBudgetMonthButton) addBudgetMonthButton.addEventListener('click', useCurrentBudgetMonth);
  const budgetMonthFilter = $('#budgetMonthFilter');
  if (budgetMonthFilter) budgetMonthFilter.addEventListener('change', renderBudgetBuilder);
});

// --- v7 detailed budget planner overrides ---
const BUDGET_BUCKETS_V7 = ['career', 'tithing', 'food', 'savings', 'car', 'other_expenses', 'fun', 'taxes', 'rent', '401k', 'stocks'];
const BUDGET_BUCKET_LABELS_V7 = {
  career: 'Career',
  tithing: 'Tithing',
  food: 'Food',
  savings: 'Savings',
  car: 'Car',
  other_expenses: 'Other Expenses',
  fun: 'Fun',
  taxes: 'Taxes',
  rent: 'Rent',
  '401k': '401K',
  stocks: 'Stocks'
};

const DEFAULT_BUDGET_LINES_V7 = [
  { sortOrder: 10, lineType: 'income', section: 'Income', label: 'Pay', bucketId: '', calculationType: 'fixed', calculationValue: 8081.68, multiplier: 1, basisLineId: '', actualOverride: 8178.61 },
  { sortOrder: 20, lineType: 'deduction', section: 'Pre-Take-Home', label: 'Taxes', bucketId: 'taxes', calculationType: 'percentage', calculationValue: 19.67, multiplier: 1, basisLineId: 'pay', actualOverride: 1589.90 },
  { sortOrder: 30, lineType: 'deduction', section: 'Pre-Take-Home', label: '401K', bucketId: '401k', calculationType: 'percentage', calculationValue: 10, multiplier: 1, basisLineId: 'pay', actualOverride: 808.17 },
  { sortOrder: 40, lineType: 'subtotal', section: 'Subtotal', label: 'Subtotal (Take-Home Pay)', bucketId: '', calculationType: 'subtotal', calculationValue: 0, multiplier: 1, basisLineId: '' },
  { sortOrder: 50, lineType: 'expense', section: 'Fixed Expenses', label: 'Rent', bucketId: 'rent', calculationType: 'fixed', calculationValue: 275, multiplier: 4, basisLineId: '', actualOverride: 941.10 },
  { sortOrder: 60, lineType: 'deduction', section: 'Fixed Expenses', label: 'Tithing', bucketId: 'tithing', calculationType: 'percentage', calculationValue: 10, multiplier: 1, basisLineId: 'subtotal_take_home_pay', actualOverride: 568.36 },
  { sortOrder: 70, lineType: 'expense', section: 'Fixed Expenses', label: 'Car Payment', bucketId: 'car', calculationType: 'fixed', calculationValue: 329.09, multiplier: 1, basisLineId: '', actualOverride: 329.09 },
  { sortOrder: 80, lineType: 'expense', section: 'Fixed Expenses', label: 'Car Insurance', bucketId: 'car', calculationType: 'fixed', calculationValue: 222.91, multiplier: 1, basisLineId: '', actualOverride: 0 },
  { sortOrder: 90, lineType: 'subtotal', section: 'Subtotal', label: 'Subtotal (After Fixed Expenses)', bucketId: '', calculationType: 'subtotal', calculationValue: 0, multiplier: 1, basisLineId: '' },
  { sortOrder: 100, lineType: 'allocation', section: 'Savings & Investing', label: 'Career', bucketId: 'career', calculationType: 'percentage', calculationValue: 5, multiplier: 1, basisLineId: 'subtotal_take_home_pay', actualOverride: 0 },
  { sortOrder: 110, lineType: 'allocation', section: 'Savings & Investing', label: 'Savings', bucketId: 'savings', calculationType: 'percentage', calculationValue: 30, multiplier: 1, basisLineId: 'subtotal_take_home_pay', actualOverride: 1802.02 },
  { sortOrder: 120, lineType: 'allocation', section: 'Savings & Investing', label: 'Stocks', bucketId: 'stocks', calculationType: 'fixed', calculationValue: 50, multiplier: 5, basisLineId: '', actualOverride: 225 },
  { sortOrder: 130, lineType: 'subtotal', section: 'Subtotal', label: 'Subtotal (After Savings)', bucketId: '', calculationType: 'subtotal', calculationValue: 0, multiplier: 1, basisLineId: '' },
  { sortOrder: 140, lineType: 'expense', section: 'Necessities', label: 'Food', bucketId: 'food', calculationType: 'fixed', calculationValue: 50, multiplier: 5, basisLineId: '', actualOverride: 142.44 },
  { sortOrder: 150, lineType: 'expense', section: 'Necessities', label: 'Car Charging', bucketId: 'car', calculationType: 'fixed', calculationValue: 10, multiplier: 5, basisLineId: '', actualOverride: 7.30 },
  { sortOrder: 160, lineType: 'subtotal', section: 'Subtotal', label: 'Subtotal (After Necessities)', bucketId: '', calculationType: 'subtotal', calculationValue: 0, multiplier: 1, basisLineId: '' },
  { sortOrder: 170, lineType: 'expense', section: 'Discretionary', label: 'Fun', bucketId: 'fun', calculationType: 'fixed', calculationValue: 30, multiplier: 5, basisLineId: '', actualOverride: 125.54 },
  { sortOrder: 180, lineType: 'expense', section: 'Discretionary', label: 'Other Spending', bucketId: 'other_expenses', calculationType: 'fixed', calculationValue: 25, multiplier: 5, basisLineId: '', actualOverride: 221.93 },
  { sortOrder: 190, lineType: 'total', section: 'Total', label: 'Total', bucketId: '', calculationType: 'subtotal', calculationValue: 0, multiplier: 1, basisLineId: '' }
].map((line) => ({ ...line, lineId: budgetLineIdFromLabelV7(line.label), notes: '' }));

async function rawCallPostV7(action, payload) {
  requireSettings();
  const response = await fetch(state.endpointUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: state.token, action, payload })
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || `${action} failed.`);
  return result;
}

async function callPost(action, payload) {
  try {
    return await rawCallPostV7(action, payload);
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes('Unknown POST action') || message.includes('Save POST action')) {
      throw new Error(`Backend does not recognise the '${action}' action. Replace/deploy the included Code.gs, then reload the web app.`);
    }
    throw error;
  }
}

function applyBootstrap(data) {
  state.transactions = normaliseArray(data.transactions).map(normaliseTransaction);
  state.categories = normaliseArray(data.categories).map(normaliseCategory);
  state.accounts = normaliseArray(data.accounts).map(normaliseAccount);
  state.budgets = normaliseArray(data.budgets).map(normaliseBudget);
  state.budgetPlanRows = normaliseArray(data.budgetPlanRows || data.BudgetPlanRows || data.budgetPlans).map(normaliseBudgetPlanRowV7);
  state.bucketAliases = normaliseArray(data.bucketAliases || data.BucketAliases).map(normaliseBucketAlias);
  state.bucketTransfers = normaliseArray(data.bucketTransfers || data.BucketTransfers).map(normaliseBucketTransfer);
  state.bucketBalances = normaliseArray(data.bucketBalances || data.BucketBalances).map(normaliseBucketBalance);
  state.settings = data.settings || {};
  renderAll();
}

function getCacheShape() {
  return {
    transactions: state.transactions,
    categories: state.categories,
    accounts: state.accounts,
    budgets: state.budgets,
    budgetPlanRows: state.budgetPlanRows || [],
    bucketAliases: state.bucketAliases,
    bucketTransfers: state.bucketTransfers,
    bucketBalances: state.bucketBalances,
    settings: state.settings
  };
}

function summariseLoadedData() {
  return {
    transactions: state.transactions.length,
    categories: state.categories.length,
    accounts: state.accounts.length,
    budgets: state.budgets.length,
    budgetPlanRows: (state.budgetPlanRows || []).length,
    bucketAliases: state.bucketAliases.length,
    bucketTransfers: state.bucketTransfers.length,
    bucketBalances: state.bucketBalances.length
  };
}

function renderFilters() {
  const months = unique(state.transactions.map((t) => transactionMonth(t.transactionDate)).filter(Boolean)).sort().reverse();
  safeFillSelect($('#monthFilter'), [{ value: '', label: 'All months' }, ...months.map((m) => ({ value: m, label: m }))]);
  const budgetMonths = budgetMonthOptionsV7();
  safeFillSelect($('#budgetMonthFilter'), budgetMonths);
  const bucketMonthFilter = $('#bucketMonthFilter');
  if (bucketMonthFilter) safeFillSelect(bucketMonthFilter, unique([...months, ...budgetMonths.map((m) => m.value)]).filter(Boolean).sort().reverse().map((m) => ({ value: m, label: m })));
  safeFillSelect($('#categoryFilter'), [{ value: '', label: 'All categories' }, ...state.categories.map((c) => ({ value: c.id, label: c.name || c.id }))]);
  const monthInput = $('#budgetPlannerMonthInput');
  if (monthInput && $('#budgetMonthFilter')) monthInput.value = $('#budgetMonthFilter').value || currentYearMonth();
}

function safeFillSelect(select, options) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
  if (options.some((option) => option.value === current)) select.value = current;
}

function budgetMonthOptionsV7() {
  const months = unique([
    ...(state.budgetPlanRows || []).map((row) => normaliseMonthValue(row.budgetMonth)),
    ...state.budgets.map((budget) => normaliseMonthValue(budget.budgetMonth)),
    ...state.transactions.map((transaction) => transactionMonth(transaction.transactionDate)),
    currentYearMonth()
  ].filter(Boolean)).sort().reverse();
  return months.map((month) => ({ value: month, label: month }));
}

function normaliseBudgetPlanRowV7(row) {
  return {
    ...row,
    id: row.id || '',
    budgetMonth: normaliseMonthValue(row.budgetMonth),
    lineId: row.lineId || budgetLineIdFromLabelV7(row.label || ''),
    parentLineId: row.parentLineId || '',
    lineType: row.lineType || 'expense',
    section: row.section || '',
    sortOrder: Number(row.sortOrder || 0),
    label: row.label || '',
    bucketId: bucketIdFromAny(row.bucketId || ''),
    categoryId: row.categoryId || (row.bucketId ? `cat_${bucketIdFromAny(row.bucketId)}` : ''),
    calculationType: row.calculationType || 'fixed',
    calculationValue: parseMoneyValue(row.calculationValue),
    multiplier: Number(row.multiplier || 1),
    basisLineId: row.basisLineId || '',
    plannedAmount: parseMoneyValue(row.plannedAmount),
    actualOverride: row.actualOverride === '' || row.actualOverride === undefined ? '' : parseMoneyValue(row.actualOverride),
    actualAmount: parseMoneyValue(row.actualAmount),
    variance: parseMoneyValue(row.variance),
    notes: row.notes || ''
  };
}

function renderBudgetsTable() {
  renderBudgetPlannerV7();
}

function renderBudgetPlannerV7() {
  const body = $('#budgetPlannerTableBody');
  if (!body) return;
  const select = $('#budgetMonthFilter');
  const selectedMonth = (select && select.value) || currentYearMonth();
  const monthInput = $('#budgetPlannerMonthInput');
  if (monthInput) monthInput.value = selectedMonth;
  const notesInput = $('#budgetPlannerNotesInput');
  if (notesInput) notesInput.value = monthlyBudgetNoteV7(selectedMonth);
  const rows = getBudgetRowsForMonthV7(selectedMonth);
  const computed = computeBudgetRowsV7(rows, selectedMonth);
  body.innerHTML = computed.map((line, index) => renderBudgetPlannerRowV7(line, index, computed)).join('');
  wireBudgetPlannerInputsV7();
  updateBudgetPlannerSummaryV7(computed);
}

function getBudgetRowsForMonthV7(month) {
  const direct = (state.budgetPlanRows || []).filter((row) => normaliseMonthValue(row.budgetMonth) === month);
  if (direct.length) return direct.map((row) => ({ ...row })).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  const priorMonth = previousBudgetMonthV7(month);
  if (priorMonth) {
    return (state.budgetPlanRows || [])
      .filter((row) => normaliseMonthValue(row.budgetMonth) === priorMonth)
      .map((row) => ({ ...row, id: '', budgetMonth: month }))
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  }
  if (month === '2026-07' || !(state.budgetPlanRows || []).length) {
    return DEFAULT_BUDGET_LINES_V7.map((row) => ({ ...row, id: '', budgetMonth: month }));
  }
  return DEFAULT_BUDGET_LINES_V7.map((row) => ({ ...row, id: '', budgetMonth: month, actualOverride: '' }));
}

function previousBudgetMonthV7(month) {
  const candidates = unique((state.budgetPlanRows || []).map((row) => normaliseMonthValue(row.budgetMonth)).filter((m) => m && m < month)).sort();
  return candidates.length ? candidates[candidates.length - 1] : '';
}

function monthlyBudgetNoteV7(month) {
  const row = (state.budgetPlanRows || []).find((line) => normaliseMonthValue(line.budgetMonth) === month && line.notes && line.lineType === 'monthNote');
  return row ? row.notes : '';
}

function computeBudgetRowsV7(rows, month) {
  const sorted = rows.map((row, index) => ({ ...row, sortOrder: Number(row.sortOrder || (index + 1) * 10) })).sort((a, b) => a.sortOrder - b.sortOrder);
  const byId = new Map();
  let plannedRunning = 0;
  let actualRunning = 0;
  return sorted.map((row) => {
    const lineId = row.lineId || budgetLineIdFromLabelV7(row.label || `line_${row.sortOrder}`);
    let planned = 0;
    let actual = 0;
    const calculationType = row.calculationType || 'fixed';
    if (row.lineType === 'subtotal' || row.lineType === 'total') {
      planned = plannedRunning;
      actual = actualRunning;
    } else if (calculationType === 'percentage') {
      const basisLine = byId.get(row.basisLineId);
      const basis = basisLine ? Number(basisLine.plannedAmount || 0) : plannedRunning;
      planned = basis * (Number(row.calculationValue || 0) / 100) * Number(row.multiplier || 1);
      actual = actualForBudgetLineV7(row, month);
    } else {
      planned = Number(row.calculationValue || 0) * Number(row.multiplier || 1);
      actual = actualForBudgetLineV7(row, month);
    }
    planned = roundCurrencyV7(planned);
    actual = roundCurrencyV7(actual);
    const sign = budgetLineSignV7(row.lineType);
    if (row.lineType !== 'subtotal' && row.lineType !== 'total') {
      plannedRunning += sign * planned;
      actualRunning += sign * actual;
    }
    const computed = {
      ...row,
      lineId,
      plannedAmount: planned,
      actualAmount: actual,
      variance: roundCurrencyV7(planned - actual),
      runningPlanned: roundCurrencyV7(plannedRunning),
      runningActual: roundCurrencyV7(actualRunning)
    };
    byId.set(lineId, computed);
    return computed;
  });
}

function budgetLineSignV7(lineType) {
  if (lineType === 'income') return 1;
  if (lineType === 'subtotal' || lineType === 'total') return 0;
  return -1;
}

function actualForBudgetLineV7(row, month) {
  if (row.actualOverride !== '' && row.actualOverride !== undefined && row.actualOverride !== null) return Number(row.actualOverride || 0);
  if (!row.bucketId) return 0;
  const bucketId = effectiveBucketId(row.bucketId);
  const txns = state.transactions.filter((txn) => transactionMonth(txn.transactionDate) === month && effectiveBucketId(txn.bucketId || txn.accountId) === bucketId);
  const label = String(row.label || '').toLowerCase();
  const matching = txns.filter((txn) => {
    const text = [txn.description, txn.merchant, txn.notes, txn.sourceBucket].join(' ').toLowerCase();
    if (['food', 'fun', 'rent', 'tithing', 'stocks', 'savings', 'career'].includes(label)) return true;
    return text.includes(label.replace(/\s+/g, ' ')) || text.includes(label.split(' ')[0]);
  });
  const candidates = matching.length ? matching : txns;
  return candidates.filter((txn) => Number(txn.amount) < 0).reduce((total, txn) => total + Math.abs(Number(txn.amount || 0)), 0);
}

function renderBudgetPlannerRowV7(line, index, allLines) {
  const rowClass = `budget-line-${escapeHtml(line.lineType)}`;
  const basisOptions = allLines
    .filter((basis) => ['income', 'subtotal', 'total'].includes(basis.lineType))
    .map((basis) => `<option value="${escapeHtml(basis.lineId)}" ${basis.lineId === line.basisLineId ? 'selected' : ''}>${escapeHtml(basis.label)}</option>`)
    .join('');
  const bucketOptions = [''].concat(BUDGET_BUCKETS_V7).map((bucket) => `<option value="${escapeHtml(bucket)}" ${bucket === line.bucketId ? 'selected' : ''}>${escapeHtml(bucket ? BUDGET_BUCKET_LABELS_V7[bucket] || bucket : 'None')}</option>`).join('');
  const varianceClass = line.variance >= 0 ? 'budget-variance-good' : 'budget-variance-bad';
  return `<tr class="${rowClass}" data-budget-row-index="${index}">
    <td><input class="budget-sort-input" type="number" value="${Number(line.sortOrder || 0)}" /></td>
    <td><select class="budget-type-input">${budgetTypeOptionsV7(line.lineType)}</select></td>
    <td><input class="section-input" type="text" value="${escapeHtml(line.section || '')}" /></td>
    <td><input class="line-label-input" type="text" value="${escapeHtml(line.label || '')}" /></td>
    <td><select class="budget-bucket-input">${bucketOptions}</select></td>
    <td><select class="budget-calc-input">${budgetCalcOptionsV7(line.calculationType)}</select></td>
    <td class="amount-col"><input class="budget-value-input" type="number" step="0.01" value="${Number(line.calculationValue || 0)}" /></td>
    <td class="amount-col"><input class="budget-multiplier-input" type="number" step="0.01" value="${Number(line.multiplier || 1)}" /></td>
    <td><select class="budget-basis-input"><option value="">Running subtotal</option>${basisOptions}</select></td>
    <td class="amount-col">${formatCurrency(line.plannedAmount)}</td>
    <td class="amount-col"><input class="budget-actual-input" type="number" step="0.01" value="${line.actualOverride === '' ? Number(line.actualAmount || 0) : Number(line.actualOverride || 0)}" /></td>
    <td class="amount-col ${varianceClass}">${formatCurrency(line.variance)}</td>
    <td><div class="budget-action-buttons"><button type="button" class="small-button" data-budget-row-action="duplicate">Copy</button><button type="button" class="small-button" data-budget-row-action="delete">Delete</button></div></td>
  </tr>`;
}

function budgetTypeOptionsV7(value) {
  return ['income', 'deduction', 'expense', 'allocation', 'subtotal', 'total'].map((option) => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('');
}

function budgetCalcOptionsV7(value) {
  return ['fixed', 'percentage', 'subtotal'].map((option) => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('');
}

function readBudgetPlannerRowsFromDomV7() {
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || ($('#budgetMonthFilter') && $('#budgetMonthFilter').value) || currentYearMonth();
  return $$('#budgetPlannerTableBody tr[data-budget-row-index]').map((tr, idx) => {
    const label = tr.querySelector('.line-label-input').value.trim() || `Line ${idx + 1}`;
    const lineId = budgetLineIdFromLabelV7(label);
    return {
      budgetMonth: month,
      lineId,
      parentLineId: '',
      lineType: tr.querySelector('.budget-type-input').value,
      section: tr.querySelector('.section-input').value.trim(),
      sortOrder: Number(tr.querySelector('.budget-sort-input').value || ((idx + 1) * 10)),
      label,
      bucketId: tr.querySelector('.budget-bucket-input').value,
      categoryId: tr.querySelector('.budget-bucket-input').value ? `cat_${tr.querySelector('.budget-bucket-input').value}` : '',
      calculationType: tr.querySelector('.budget-calc-input').value,
      calculationValue: parseMoneyValue(tr.querySelector('.budget-value-input').value),
      multiplier: Number(tr.querySelector('.budget-multiplier-input').value || 1),
      basisLineId: tr.querySelector('.budget-basis-input').value,
      actualOverride: tr.querySelector('.budget-actual-input').value === '' ? '' : parseMoneyValue(tr.querySelector('.budget-actual-input').value),
      notes: ''
    };
  });
}

function wireBudgetPlannerInputsV7() {
  $$('#budgetPlannerTableBody input, #budgetPlannerTableBody select').forEach((input) => input.addEventListener('input', () => {
    const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
    const rows = readBudgetPlannerRowsFromDomV7();
    const computed = computeBudgetRowsV7(rows, month);
    updateBudgetPlannerSummaryV7(computed);
  }));
  $$('#budgetPlannerTableBody button[data-budget-row-action]').forEach((button) => button.addEventListener('click', handleBudgetRowActionV7));
}

function handleBudgetRowActionV7(event) {
  const action = event.currentTarget.dataset.budgetRowAction;
  const rows = readBudgetPlannerRowsFromDomV7();
  const index = Number(event.currentTarget.closest('tr').dataset.budgetRowIndex);
  if (action === 'delete') rows.splice(index, 1);
  if (action === 'duplicate') rows.splice(index + 1, 0, { ...rows[index], sortOrder: Number(rows[index].sortOrder || 0) + 1, label: `${rows[index].label} Copy`, lineId: budgetLineIdFromLabelV7(`${rows[index].label} Copy`) });
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
  state.budgetPlanRows = state.budgetPlanRows.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(rows.map((row) => normaliseBudgetPlanRowV7(row)));
  renderBudgetPlannerV7();
}

function updateBudgetPlannerSummaryV7(rows) {
  const pay = rows.find((row) => row.lineType === 'income');
  const total = [...rows].reverse().find((row) => row.lineType === 'total') || [...rows].reverse().find((row) => row.lineType === 'subtotal');
  const plannedRemaining = total ? Number(total.plannedAmount || 0) : 0;
  const actualRemaining = total ? Number(total.actualAmount || 0) : 0;
  setTextV7('#plannerBudgetPay', formatCurrency(pay ? pay.plannedAmount : 0));
  setTextV7('#plannerActualPay', formatCurrency(pay ? pay.actualAmount : 0));
  setTextV7('#plannerRemainingBudget', formatCurrency(plannedRemaining));
  setTextV7('#plannerTotalVariance', formatCurrency(plannedRemaining - actualRemaining));
}

function setTextV7(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

function addBudgetLineV7() {
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
  const rows = readBudgetPlannerRowsFromDomV7();
  rows.push({ budgetMonth: month, lineId: `line_${Date.now()}`, lineType: 'expense', section: 'New Section', sortOrder: rows.length ? Math.max(...rows.map((r) => Number(r.sortOrder || 0))) + 10 : 10, label: 'New Budget Line', bucketId: '', categoryId: '', calculationType: 'fixed', calculationValue: 0, multiplier: 1, basisLineId: '', actualOverride: '', notes: '' });
  state.budgetPlanRows = state.budgetPlanRows.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(rows.map(normaliseBudgetPlanRowV7));
  renderBudgetPlannerV7();
}

function copyPreviousBudgetV7() {
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
  const prior = previousBudgetMonthV7(month);
  const rows = prior ? getBudgetRowsForMonthV7(prior).map((row) => ({ ...row, id: '', budgetMonth: month, actualOverride: '' })) : DEFAULT_BUDGET_LINES_V7.map((row) => ({ ...row, budgetMonth: month, actualOverride: '' }));
  state.budgetPlanRows = state.budgetPlanRows.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(rows.map(normaliseBudgetPlanRowV7));
  renderFilters();
  renderBudgetPlannerV7();
}

async function saveBudgetPlan() {
  try {
    const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || ($('#budgetMonthFilter') && $('#budgetMonthFilter').value) || currentYearMonth();
    const rows = computeBudgetRowsV7(readBudgetPlannerRowsFromDomV7(), month);
    const monthNote = $('#budgetPlannerNotesInput') ? $('#budgetPlannerNotesInput').value.trim() : '';
    const result = await callPost('saveDetailedBudgetPlan', { budgetMonth: month, rows, monthNote });
    if (Array.isArray(result.budgetPlanRows)) {
      state.budgetPlanRows = state.budgetPlanRows.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(result.budgetPlanRows.map(normaliseBudgetPlanRowV7));
      localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
      renderAll();
    }
    showToast('Detailed budget plan saved.');
  } catch (error) {
    showToast(error.message);
  }
}

function budgetLineIdFromLabelV7(label) {
  return slugify(label || 'line');
}

function roundCurrencyV7(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

document.addEventListener('DOMContentLoaded', () => {
  const addLine = $('#addBudgetLineButton');
  if (addLine) addLine.addEventListener('click', addBudgetLineV7);
  const copyPrevious = $('#copyPreviousBudgetButton');
  if (copyPrevious) copyPrevious.addEventListener('click', copyPreviousBudgetV7);
  const monthInput = $('#budgetPlannerMonthInput');
  if (monthInput) monthInput.addEventListener('change', () => {
    const select = $('#budgetMonthFilter');
    if (select) {
      if (![...select.options].some((option) => option.value === monthInput.value)) {
        select.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(monthInput.value)}">${escapeHtml(monthInput.value)}</option>`);
      }
      select.value = monthInput.value;
    }
    renderBudgetPlannerV7();
  });
});

// --- v8: 25 Ducats responsive Budgets tab ---
function renderBudgetPlannerV7() {
  const list = $('#budgetPlannerCardList');
  const legacyBody = $('#budgetPlannerTableBody');
  if (!list && !legacyBody) return;
  const select = $('#budgetMonthFilter');
  const selectedMonth = (select && select.value) || currentYearMonth();
  const monthInput = $('#budgetPlannerMonthInput');
  if (monthInput) monthInput.value = selectedMonth;
  const notesInput = $('#budgetPlannerNotesInput');
  if (notesInput) notesInput.value = monthlyBudgetNoteV7(selectedMonth);
  const rows = getBudgetRowsForMonthV7(selectedMonth);
  const computed = computeBudgetRowsV7(rows, selectedMonth);
  if (list) list.innerHTML = computed.map((line, index) => renderBudgetPlannerCardV8(line, index, computed)).join('');
  if (legacyBody) legacyBody.innerHTML = '';
  wireBudgetPlannerInputsV7();
  updateBudgetPlannerSummaryV7(computed);
}

function renderBudgetPlannerCardV8(line, index, allLines) {
  const basisOptions = allLines
    .filter((basis) => ['income', 'subtotal', 'total'].includes(basis.lineType))
    .map((basis) => `<option value="${escapeHtml(basis.lineId)}" ${basis.lineId === line.basisLineId ? 'selected' : ''}>${escapeHtml(basis.label)}</option>`)
    .join('');
  const bucketOptions = [''].concat(BUDGET_BUCKETS_V7).map((bucket) => `<option value="${escapeHtml(bucket)}" ${bucket === line.bucketId ? 'selected' : ''}>${escapeHtml(bucket ? BUDGET_BUCKET_LABELS_V7[bucket] || bucket : 'None')}</option>`).join('');
  const varianceClass = Number(line.variance || 0) >= 0 ? 'budget-variance-good' : 'budget-variance-bad';
  const typeClass = `is-${escapeHtml(line.lineType || 'expense')}`;
  return `<section class="budget-line-card ${typeClass}" data-budget-row-index="${index}">
    <div class="budget-line-main">
      <label>Order<input class="budget-sort-input" type="number" value="${Number(line.sortOrder || 0)}" /></label>
      <label class="budget-line-title">Line / sub-category<input class="line-label-input" type="text" list="budgetLinePresets" value="${escapeHtml(line.label || '')}" /></label>
      <label>Type<select class="budget-type-input">${budgetTypeOptionsV7(line.lineType)}</select></label>
      <label class="budget-bucket-wrap">Bucket<select class="budget-bucket-input">${bucketOptions}</select></label>
      <label>Actual<input class="budget-actual-input" type="number" step="0.01" value="${line.actualOverride === '' ? Number(line.actualAmount || 0) : Number(line.actualOverride || 0)}" /></label>
    </div>
    <div class="budget-line-results">
      <div class="budget-result-pill"><span>Budget</span><strong>${formatCurrency(line.plannedAmount)}</strong></div>
      <div class="budget-result-pill"><span>Actual</span><strong>${formatCurrency(line.actualAmount)}</strong></div>
      <div class="budget-result-pill"><span>Variance</span><strong class="${varianceClass}">${formatCurrency(line.variance)}</strong></div>
    </div>
    <div class="budget-line-advanced">
      <label>Section<select class="section-input">${budgetSectionOptionsV8(line.section)}</select></label>
      <label>Calculation<select class="budget-calc-input">${budgetCalcOptionsV7(line.calculationType)}</select></label>
      <label>Value<input class="budget-value-input" type="number" step="0.01" value="${Number(line.calculationValue || 0)}" /></label>
      <label>Count / multiplier<input class="budget-multiplier-input" type="number" step="0.01" value="${Number(line.multiplier || 1)}" /></label>
      <label>Basis<select class="budget-basis-input"><option value="">Running subtotal</option>${basisOptions}</select></label>
    </div>
    <div class="budget-line-actions">
      <button type="button" class="budget-toggle-advanced" data-budget-row-action="toggle">Details</button>
      <button type="button" class="budget-card-button" data-budget-row-action="duplicate">Copy</button>
      <button type="button" class="budget-card-button danger" data-budget-row-action="delete">Delete</button>
    </div>
  </section>`;
}

function budgetSectionOptionsV8(value) {
  const presetSections = ['Income', 'Pre-Take-Home', 'Fixed Expenses', 'Savings & Investing', 'Necessities', 'Discretionary', 'Subtotal', 'Total', 'New Section'];
  return presetSections.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
}

function readBudgetPlannerRowsFromDomV7() {
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || ($('#budgetMonthFilter') && $('#budgetMonthFilter').value) || currentYearMonth();
  return $$('.budget-line-card[data-budget-row-index]').map((card, idx) => {
    const label = card.querySelector('.line-label-input').value.trim() || `Line ${idx + 1}`;
    const bucket = card.querySelector('.budget-bucket-input').value;
    return {
      budgetMonth: month,
      lineId: budgetLineIdFromLabelV7(label),
      parentLineId: '',
      lineType: card.querySelector('.budget-type-input').value,
      section: card.querySelector('.section-input').value,
      sortOrder: Number(card.querySelector('.budget-sort-input').value || ((idx + 1) * 10)),
      label,
      bucketId: bucket,
      categoryId: bucket ? `cat_${bucket}` : '',
      calculationType: card.querySelector('.budget-calc-input').value,
      calculationValue: parseMoneyValue(card.querySelector('.budget-value-input').value),
      multiplier: Number(card.querySelector('.budget-multiplier-input').value || 1),
      basisLineId: card.querySelector('.budget-basis-input').value,
      actualOverride: card.querySelector('.budget-actual-input').value === '' ? '' : parseMoneyValue(card.querySelector('.budget-actual-input').value),
      notes: ''
    };
  });
}

function wireBudgetPlannerInputsV7() {
  $$('.budget-line-card input, .budget-line-card select').forEach((input) => input.addEventListener('input', () => {
    const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
    const rows = readBudgetPlannerRowsFromDomV7();
    const computed = computeBudgetRowsV7(rows, month);
    updateBudgetPlannerSummaryV7(computed);
  }));
  $$('.budget-line-card button[data-budget-row-action]').forEach((button) => button.addEventListener('click', handleBudgetRowActionV7));
}

function handleBudgetRowActionV7(event) {
  const action = event.currentTarget.dataset.budgetRowAction;
  const card = event.currentTarget.closest('.budget-line-card');
  if (action === 'toggle') {
    card.classList.toggle('expanded');
    return;
  }
  const rows = readBudgetPlannerRowsFromDomV7();
  const index = Number(card.dataset.budgetRowIndex);
  if (action === 'delete') rows.splice(index, 1);
  if (action === 'duplicate') rows.splice(index + 1, 0, { ...rows[index], sortOrder: Number(rows[index].sortOrder || 0) + 1, label: `${rows[index].label} Copy`, lineId: budgetLineIdFromLabelV7(`${rows[index].label} Copy`) });
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
  state.budgetPlanRows = (state.budgetPlanRows || []).filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(rows.map((row) => normaliseBudgetPlanRowV7(row)));
  renderBudgetPlannerV7();
}

function addBudgetLineV7() {
  const month = ($('#budgetPlannerMonthInput') && $('#budgetPlannerMonthInput').value) || currentYearMonth();
  const rows = readBudgetPlannerRowsFromDomV7();
  rows.push({ budgetMonth: month, lineId: `line_${Date.now()}`, lineType: 'expense', section: 'New Section', sortOrder: rows.length ? Math.max(...rows.map((r) => Number(r.sortOrder || 0))) + 10 : 10, label: 'New Budget Line', bucketId: '', categoryId: '', calculationType: 'fixed', calculationValue: 0, multiplier: 1, basisLineId: '', actualOverride: '', notes: '' });
  state.budgetPlanRows = (state.budgetPlanRows || []).filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(rows.map(normaliseBudgetPlanRowV7));
  renderBudgetPlannerV7();
}

function showDucatsEasterEggV8() {
  let toast = $('#ducatsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ducatsToast';
    toast.className = 'ducats-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = "I hand my cousin twenty-five ducats, I'm sweating buckets. He hands me a sandwich bag with some little green nuggets.";
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 4200);
}

document.addEventListener('DOMContentLoaded', () => {
  const egg = $('#ducatsEasterEgg');
  if (egg) egg.addEventListener('click', showDucatsEasterEggV8);
  const existingDatalist = $('#budgetLinePresets');
  if (!existingDatalist) {
    const datalist = document.createElement('datalist');
    datalist.id = 'budgetLinePresets';
    ['Pay','Taxes','401K','Rent','Tithing','Car Payment','Car Insurance','Career','Savings','Stocks','Food','Car Charging','Fun','Other Spending','Subtotal (Take-Home Pay)','Subtotal (After Fixed Expenses)','Subtotal (After Savings)','Subtotal (After Necessities)','Total'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      datalist.appendChild(option);
    });
    document.body.appendChild(datalist);
  }
});

// --- v9: full mobile app shell and card-first rendering ---
function switchView(view) {
  state.activeView = view;
  $$('.view').forEach((section) => section.classList.remove('active'));
  const target = $(`#${view}View`) || $('#dashboardView');
  target.classList.add('active');
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { dashboard: 'Dashboard', buckets: 'Buckets', transfers: 'Transfers', admin: 'Bucket Admin', transactions: 'Transactions', budgets: 'Budgets', settings: 'Settings' };
  if (elements.viewTitle) elements.viewTitle.textContent = titles[view] || titleCase(view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTransactionsTable() {
  const body = $('#transactionsTableBody');
  const cardList = $('#transactionsCardList');
  const query = ($('#transactionSearch') && $('#transactionSearch').value.trim().toLowerCase()) || '';
  const month = ($('#monthFilter') && $('#monthFilter').value) || '';
  const category = ($('#categoryFilter') && $('#categoryFilter').value) || '';
  const filtered = state.transactions.filter((txn) => {
    const haystack = [txn.description, txn.merchant, txn.notes, txn.transactionDate].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!month || transactionMonth(txn.transactionDate) === month) && (!category || txn.categoryId === category);
  }).sort((a,b) => String(b.transactionDate).localeCompare(String(a.transactionDate))).slice(0, 500);
  if (body) {
    body.innerHTML = filtered.map((txn) => `<tr><td>${escapeHtml(txn.transactionDate || '')}</td><td>${escapeHtml(txn.description || '')}</td><td>${escapeHtml(txn.merchant || '')}</td><td>${escapeHtml(categoryName(txn.categoryId))}</td><td>${escapeHtml(accountName(txn.accountId))}</td><td class="amount-col ${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount || 0))}</td></tr>`).join('') || `<tr><td colspan="6">No transactions match the current filters.</td></tr>`;
  }
  if (cardList) {
    cardList.innerHTML = filtered.map((txn) => `<article class="mobile-data-card"><div class="mobile-card-head"><strong>${escapeHtml(txn.description || txn.merchant || 'Transaction')}</strong><span class="${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount || 0))}</span></div><div class="mobile-card-row"><span>Date</span><strong>${escapeHtml(txn.transactionDate || '')}</strong></div><div class="mobile-card-row"><span>Merchant</span><strong>${escapeHtml(txn.merchant || '—')}</strong></div><div class="mobile-card-row"><span>Bucket</span><strong>${escapeHtml(bucketNameById(txn.bucketId || txn.accountId) || accountName(txn.accountId) || '—')}</strong></div></article>`).join('') || `<div class="empty-state">No transactions match the current filters.</div>`;
  }
}

function renderBucketView() {
  const body = $('#bucketsTableBody');
  const cardList = $('#bucketsCardList');
  const month = getSelectedBucketMonth();
  const rows = buildBucketRows(month);
  setTextV9('#bucketMetricPlanned', formatCurrency(sum(rows.map((row) => row.planned))));
  setTextV9('#bucketMetricFunded', formatCurrency(sum(rows.map((row) => row.funded))));
  setTextV9('#bucketMetricSpent', formatCurrency(sum(rows.map((row) => row.spent))));
  setTextV9('#bucketMetricAvailable', formatCurrency(sum(rows.map((row) => row.currentBalance))));
  const tableRows = rows.map((row) => {
    const statusClass = row.currentBalance < 0 ? 'status-danger' : row.monthRemaining < 0 ? 'status-warning' : 'status-ok';
    const statusText = row.currentBalance < 0 ? 'Negative balance' : row.monthRemaining < 0 ? 'Over monthly plan' : 'On track';
    return `<tr><td class="bucket-name-cell"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.id)}</small></td><td class="amount-col">${formatCurrency(row.planned)}</td><td class="amount-col amount-positive">${formatCurrency(row.funded)}</td><td class="amount-col amount-negative">${formatCurrency(row.spent)}</td><td class="amount-col ${row.monthRemaining < 0 ? 'amount-negative' : ''}">${formatCurrency(row.monthRemaining)}</td><td class="amount-col ${row.currentBalance < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(row.currentBalance)}</td><td><span class="status-pill ${statusClass}">${statusText}</span></td></tr>`;
  }).join('') || `<tr><td colspan="7">No bucket data loaded.</td></tr>`;
  if (body) body.innerHTML = tableRows;
  if (cardList) {
    cardList.innerHTML = rows.map((row) => {
      const statusClass = row.currentBalance < 0 ? 'status-danger' : row.monthRemaining < 0 ? 'status-warning' : 'status-ok';
      const statusText = row.currentBalance < 0 ? 'Negative balance' : row.monthRemaining < 0 ? 'Over monthly plan' : 'On track';
      return `<article class="mobile-data-card"><div class="mobile-card-head"><strong>${escapeHtml(row.name)}</strong><span class="status-pill ${statusClass}">${statusText}</span></div><div class="mobile-card-row"><span>Available</span><strong class="${row.currentBalance < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(row.currentBalance)}</strong></div><div class="mobile-card-row"><span>Planned</span><strong>${formatCurrency(row.planned)}</strong></div><div class="mobile-card-row"><span>Spent</span><strong class="amount-negative">${formatCurrency(row.spent)}</strong></div><div class="mobile-card-row"><span>Remaining</span><strong class="${row.monthRemaining < 0 ? 'amount-negative' : ''}">${formatCurrency(row.monthRemaining)}</strong></div></article>`;
    }).join('') || `<div class="empty-state">No bucket data loaded.</div>`;
  }
}

function renderTransferHistory() {
  const body = $('#transfersTableBody');
  const cardList = $('#transfersCardList');
  const rows = [...state.bucketTransfers].sort((a,b) => String(b.transferDate).localeCompare(String(a.transferDate))).slice(0, 200);
  if (body) body.innerHTML = rows.map((transfer) => `<tr><td>${escapeHtml(transfer.transferDate || '')}</td><td>${escapeHtml(bucketNameById(transfer.fromBucketId))}</td><td>${escapeHtml(bucketNameById(transfer.toBucketId))}</td><td class="amount-col">${formatCurrency(transfer.amount)}</td><td>${escapeHtml(transfer.reason || '')}</td></tr>`).join('') || `<tr><td colspan="5">No transfers recorded yet.</td></tr>`;
  if (cardList) cardList.innerHTML = rows.map((transfer) => `<article class="mobile-data-card"><div class="mobile-card-head"><strong>${formatCurrency(transfer.amount)}</strong><small>${escapeHtml(transfer.transferDate || '')}</small></div><div class="mobile-card-row"><span>From</span><strong>${escapeHtml(bucketNameById(transfer.fromBucketId))}</strong></div><div class="mobile-card-row"><span>To</span><strong>${escapeHtml(bucketNameById(transfer.toBucketId))}</strong></div>${transfer.reason ? `<div class="mobile-card-row"><span>Reason</span><strong>${escapeHtml(transfer.reason)}</strong></div>` : ''}</article>`).join('') || `<div class="empty-state">No transfers recorded yet.</div>`;
}

function renderAliasTable() {
  const body = $('#bucketAliasTableBody');
  const cardList = $('#bucketAliasCardList');
  const rows = [...state.bucketAliases].sort((a,b) => String(a.status).localeCompare(String(b.status)) || String(a.alias).localeCompare(String(b.alias)));
  if (body) body.innerHTML = rows.map((alias) => {
    const statusClass = String(alias.status).toLowerCase() === 'active' ? 'alias-active' : 'alias-retired';
    return `<tr><td>${escapeHtml(alias.alias || '')}</td><td>${escapeHtml(alias.currentBucketName || bucketNameById(alias.currentBucketId))}</td><td class="${statusClass}">${escapeHtml(alias.status || '')}</td><td class="amount-col ${amountClass(alias.netAmount)}">${formatCurrency(alias.netAmount)}</td></tr>`;
  }).join('') || `<tr><td colspan="4">No aliases loaded.</td></tr>`;
  if (cardList) cardList.innerHTML = rows.map((alias) => `<article class="mobile-data-card"><div class="mobile-card-head"><strong>${escapeHtml(alias.alias || 'Alias')}</strong><span>${escapeHtml(alias.status || '')}</span></div><div class="mobile-card-row"><span>Current Bucket</span><strong>${escapeHtml(alias.currentBucketName || bucketNameById(alias.currentBucketId))}</strong></div><div class="mobile-card-row"><span>Net</span><strong class="${amountClass(alias.netAmount)}">${formatCurrency(alias.netAmount)}</strong></div></article>`).join('') || `<div class="empty-state">No aliases loaded.</div>`;
}

function setTextV9(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

// Add native-feeling Pull-to-Refresh
let touchStartY = 0;

document.addEventListener('touchstart', (e) => {
  if (window.scrollY <= 0) {
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (window.scrollY <= 0 && touchStartY > 0) {
    const touchEndY = e.changedTouches[0].clientY;
    // If the user pulled down more than 110 pixels from the top, trigger a refresh
    if (touchEndY - touchStartY > 110) {
      loadBootstrapData();
    }
  }
  touchStartY = 0; // Reset
}, { passive: true });