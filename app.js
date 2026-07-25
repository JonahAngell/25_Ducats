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
  toast.textContent = "25 Ducats: plan the buckets, count the ducats, and keep the little green nuggets in order.";
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
// --- v12 simplified monthly budgets with supporting tables ---
state.budgetIncome = state.budgetIncome || [];
state.budgetPlannedExpenses = state.budgetPlannedExpenses || [];
state.budgetGeneratedTransactions = state.budgetGeneratedTransactions || [];

const BUDGET_BASIS_LABELS_V12 = {
  gross_income: 'Gross income',
  net_income: 'Net income',
  after_taxes: 'After taxes',
  after_401k: 'After 401K',
  after_fixed_expenses: 'After fixed expenses',
  remaining_income: 'Remaining available'
};

function applyBootstrap(data) {
  state.transactions = normaliseArray(data.transactions).map(normaliseTransaction);
  state.categories = normaliseArray(data.categories).map(normaliseCategory);
  state.accounts = normaliseArray(data.accounts).map(normaliseAccount);
  state.budgets = normaliseArray(data.budgets).map(normaliseBudgetV12);
  state.budgetIncome = normaliseArray(data.budgetIncome || data.BudgetIncome).map(normaliseBudgetIncomeV12);
  state.budgetPlannedExpenses = normaliseArray(data.budgetPlannedExpenses || data.BudgetPlannedExpenses).map(normalisePlannedExpenseV12);
  state.budgetGeneratedTransactions = normaliseArray(data.budgetGeneratedTransactions || data.BudgetGeneratedTransactions).map(normaliseGeneratedTransactionV12);
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
    budgetIncome: state.budgetIncome || [],
    budgetPlannedExpenses: state.budgetPlannedExpenses || [],
    budgetGeneratedTransactions: state.budgetGeneratedTransactions || [],
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
    budgetIncome: (state.budgetIncome || []).length,
    budgetPlannedExpenses: (state.budgetPlannedExpenses || []).length,
    budgetGeneratedTransactions: (state.budgetGeneratedTransactions || []).length,
    bucketAliases: state.bucketAliases.length,
    bucketTransfers: state.bucketTransfers.length,
    bucketBalances: state.bucketBalances.length
  };
}

function normaliseBudgetV12(budget) {
  const bucketId = budget.bucketId || budget.bucketID || budget.BucketId || budget.BucketID || bucketIdFromAny(budget.categoryId || budget.categoryID || '');
  return {
    ...budget,
    id: budget.id || '',
    budgetMonth: normaliseMonthValue(budget.budgetMonth),
    bucketId: bucketIdFromAny(bucketId),
    categoryId: budget.categoryId || budget.categoryID || (bucketId ? `cat_${bucketIdFromAny(bucketId)}` : ''),
    allocationType: budget.allocationType || budget.type || 'fixed',
    allocationValue: parseMoneyValue(budget.allocationValue !== undefined ? budget.allocationValue : budget.plannedAmount),
    allocationBasis: budget.allocationBasis || 'net_income',
    plannedAmount: parseMoneyValue(budget.plannedAmount),
    notes: budget.notes || ''
  };
}

function normaliseBudgetIncomeV12(row) {
  return {
    ...row,
    id: row.id || '',
    incomeName: row.incomeName || row.name || 'Income',
    amount: parseMoneyValue(row.amount),
    amountBasis: row.amountBasis || 'net',
    frequency: row.frequency || 'weekly',
    dayOfWeek: row.dayOfWeek === '' || row.dayOfWeek === undefined ? '' : String(row.dayOfWeek),
    dayOfMonth: Number(row.dayOfMonth || 1),
    effectiveStartDate: normaliseDateValue(row.effectiveStartDate || row.effectiveStart || todayIsoV12()),
    effectiveEndDate: normaliseDateValue(row.effectiveEndDate || ''),
    isActive: normaliseBoolean(row.isActive),
    notes: row.notes || ''
  };
}

function normalisePlannedExpenseV12(row) {
  return {
    ...row,
    id: row.id || '',
    budgetMonth: normaliseMonthValue(row.budgetMonth),
    bucketId: bucketIdFromAny(row.bucketId || row.bucketID || ''),
    expenseName: row.expenseName || row.name || '',
    frequency: row.frequency || 'monthly',
    dayOfWeek: row.dayOfWeek === '' || row.dayOfWeek === undefined ? '' : String(row.dayOfWeek),
    amount: parseMoneyValue(row.amount),
    monthlyCalculatedAmount: parseMoneyValue(row.monthlyCalculatedAmount),
    autoGenerateTransaction: normaliseBoolean(row.autoGenerateTransaction),
    requiresManualActual: String(row.requiresManualActual || '').toLowerCase() === 'true' || row.requiresManualActual === true,
    startDate: normaliseDateValue(row.startDate || ''),
    endDate: normaliseDateValue(row.endDate || ''),
    notes: row.notes || ''
  };
}

function normaliseGeneratedTransactionV12(row) {
  return {
    ...row,
    id: row.id || '',
    sourceExpenseId: row.sourceExpenseId || '',
    budgetMonth: normaliseMonthValue(row.budgetMonth),
    transactionDate: normaliseDateValue(row.transactionDate),
    bucketId: bucketIdFromAny(row.bucketId || ''),
    amount: parseMoneyValue(row.amount),
    status: row.status || '',
    createdTransactionId: row.createdTransactionId || ''
  };
}

function renderBudgetsTable() {
  renderSimpleBudgetsV12();
}

function renderSimpleBudgetsV12() {
  const list = $('#budgetBucketsList');
  if (!list) return;
  const month = getSelectedBudgetMonthV12();
  const forecast = calculateIncomeForecastV12(month);
  const budgetRows = getBudgetRowsForMonthV12(month);
  const bucketCards = activeBucketAccounts().map((account) => buildBudgetBucketCardV12(account, month, budgetRows, forecast));
  const totalPlanned = sum(bucketCards.map((row) => row.plannedAmount));
  const totalActual = sum(bucketCards.map((row) => row.actualAmount));
  const remaining = forecast.net - totalPlanned;
  setTextV12('#budgetForecastGross', formatCurrency(forecast.gross));
  setTextV12('#budgetForecastNet', formatCurrency(forecast.net));
  setTextV12('#budgetTotalPlanned', formatCurrency(totalPlanned));
  setTextV12('#budgetRemainingIncome', formatCurrency(remaining));
  renderIncomeSummaryV12(month, forecast);
  renderBudgetAlertV12(forecast, totalPlanned, bucketCards);
  list.innerHTML = bucketCards.map((card) => budgetBucketCardHtmlV12(card)).join('') || `<div class="empty-state">No active buckets were found.</div>`;
  wireBudgetCardsV12();
}

function getSelectedBudgetMonthV12() {
  const select = $('#budgetMonthFilter');
  return (select && select.value) || getMostRecentMonth() || currentYearMonth();
}

function renderFilters() {
  const months = unique(state.transactions.map((t) => transactionMonth(t.transactionDate)).filter(Boolean)).sort().reverse();
  safeFillSelect($('#monthFilter'), [{ value: '', label: 'All months' }, ...months.map((m) => ({ value: m, label: m }))]);
  const budgetMonths = unique([
    ...state.budgets.map((b) => normaliseMonthValue(b.budgetMonth)),
    ...(state.budgetPlannedExpenses || []).map((e) => normaliseMonthValue(e.budgetMonth)),
    ...months,
    currentYearMonth()
  ].filter(Boolean)).sort().reverse();
  safeFillSelect($('#budgetMonthFilter'), budgetMonths.map((m) => ({ value: m, label: m })));
  const bucketMonthFilter = $('#bucketMonthFilter');
  if (bucketMonthFilter) safeFillSelect(bucketMonthFilter, budgetMonths.map((m) => ({ value: m, label: m })));
  safeFillSelect($('#categoryFilter'), [{ value: '', label: 'All categories' }, ...state.categories.map((c) => ({ value: c.id, label: c.name || c.id }))]);
}

function getBudgetRowsForMonthV12(month) {
  const exact = state.budgets.filter((b) => normaliseMonthValue(b.budgetMonth) === month);
  if (exact.length) return exact;
  const prior = unique(state.budgets.map((b) => normaliseMonthValue(b.budgetMonth)).filter((m) => m && m < month)).sort().pop();
  if (!prior) return [];
  return state.budgets.filter((b) => normaliseMonthValue(b.budgetMonth) === prior).map((b) => ({ ...b, id: '', budgetMonth: month }));
}

function getPlannedExpensesForMonthV12(month, bucketId) {
  const exact = (state.budgetPlannedExpenses || []).filter((e) => normaliseMonthValue(e.budgetMonth) === month && (!bucketId || e.bucketId === bucketId));
  if (exact.length) return exact;
  const prior = unique((state.budgetPlannedExpenses || []).map((e) => normaliseMonthValue(e.budgetMonth)).filter((m) => m && m < month)).sort().pop();
  return prior ? state.budgetPlannedExpenses.filter((e) => normaliseMonthValue(e.budgetMonth) === prior && (!bucketId || e.bucketId === bucketId)).map((e) => ({ ...e, budgetMonth: month, id: '' })) : [];
}

function buildBudgetBucketCardV12(account, month, budgetRows, forecast) {
  const bucketId = effectiveBucketId(account.bucketId || account.id || account.name);
  const row = budgetRows.find((budget) => effectiveBucketId(budget.bucketId || budget.categoryId) === bucketId) || { bucketId, allocationType: 'fixed', allocationValue: 0, allocationBasis: 'net_income', plannedAmount: 0 };
  const plannedAmount = calculateBudgetPlannedAmountV12(row, forecast, budgetRows);
  const expenses = getPlannedExpensesForMonthV12(month, bucketId).map((expense) => ({ ...expense, monthlyCalculatedAmount: calculatePlannedExpenseMonthlyAmountV12(expense, month) }));
  const expenseTotal = sum(expenses.map((expense) => expense.monthlyCalculatedAmount));
  const actualAmount = calculateActualForBucketV12(bucketId, month);
  return {
    account,
    bucketId,
    bucketName: account.name || bucketNameById(bucketId),
    allocationType: row.allocationType || 'fixed',
    allocationValue: Number(row.allocationValue || row.plannedAmount || 0),
    allocationBasis: row.allocationBasis || 'net_income',
    plannedAmount,
    expenses,
    expenseTotal,
    actualAmount,
    remainingAmount: plannedAmount - actualAmount,
    overExpenseAmount: Math.max(0, expenseTotal - plannedAmount),
    notes: row.notes || ''
  };
}

function calculateBudgetPlannedAmountV12(row, forecast, allBudgetRows) {
  const value = Number(row.allocationValue || row.plannedAmount || 0);
  if ((row.allocationType || 'fixed') !== 'percentage') return roundCurrencyV12(value);
  return roundCurrencyV12(getBasisAmountV12(row.allocationBasis || 'net_income', forecast, allBudgetRows) * (value / 100));
}

function getBasisAmountV12(basis, forecast, budgetRows) {
  const gross = forecast.gross || 0;
  const net = forecast.net || 0;
  if (basis === 'gross_income') return gross;
  if (basis === 'after_taxes') return net || gross;
  if (basis === 'after_401k') return net || gross;
  if (basis === 'after_fixed_expenses') {
    const fixed = sum((budgetRows || []).filter((b) => ['rent', 'car', 'taxes', '401k', 'tithing'].includes(effectiveBucketId(b.bucketId || b.categoryId))).map((b) => Number(b.plannedAmount || b.allocationValue || 0)));
    return Math.max(0, net - fixed);
  }
  if (basis === 'remaining_income') return Math.max(0, net - sum((budgetRows || []).map((b) => Number(b.plannedAmount || 0))));
  return net || gross;
}

function calculateActualForBucketV12(bucketId, month) {
  return state.transactions
    .filter((txn) => transactionMonth(txn.transactionDate) === month && effectiveBucketId(txn.bucketId || txn.accountId) === bucketId && Number(txn.amount) < 0)
    .reduce((total, txn) => total + Math.abs(Number(txn.amount || 0)), 0);
}

function calculatePlannedExpenseMonthlyAmountV12(expense, month) {
  const amount = Number(expense.amount || 0);
  if (expense.frequency === 'weekly') return roundCurrencyV12(amount * countWeekdayInMonthV12(month, Number(expense.dayOfWeek || 0)));
  return roundCurrencyV12(amount);
}

function calculateIncomeForecastV12(month) {
  const schedules = (state.budgetIncome || []).filter((row) => row.isActive !== false && isIncomeScheduleRelevantV12(row, month));
  let gross = 0;
  let net = 0;
  schedules.forEach((schedule) => {
    const amount = calculateIncomeForScheduleV12(schedule, month);
    if (schedule.amountBasis === 'gross') gross += amount;
    else net += amount;
  });
  if (!gross && net) gross = net;
  if (!net && gross) net = gross;
  return { gross: roundCurrencyV12(gross), net: roundCurrencyV12(net), schedules };
}

function isIncomeScheduleRelevantV12(schedule, month) {
  const monthStart = new Date(`${month}-01T00:00:00`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const start = schedule.effectiveStartDate ? new Date(`${schedule.effectiveStartDate}T00:00:00`) : monthStart;
  const end = schedule.effectiveEndDate ? new Date(`${schedule.effectiveEndDate}T00:00:00`) : null;
  return start <= monthEnd && (!end || end >= monthStart);
}

function calculateIncomeForScheduleV12(schedule, month) {
  const amount = Number(schedule.amount || 0);
  if (schedule.frequency === 'monthly') return amount;
  if (schedule.frequency === 'weekly') return amount * countWeekdayInMonthV12(month, Number(schedule.dayOfWeek || 0), schedule.effectiveStartDate, schedule.effectiveEndDate);
  if (schedule.frequency === 'biweekly') return amount * countBiweeklyDatesInMonthV12(month, schedule.effectiveStartDate || `${month}-01`);
  return amount;
}

function countWeekdayInMonthV12(month, weekday, startDate, endDate) {
  const start = new Date(`${month}-01T00:00:00`);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const min = startDate ? new Date(`${startDate}T00:00:00`) : start;
  const max = endDate ? new Date(`${endDate}T00:00:00`) : last;
  let count = 0;
  for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
    if (d >= min && d <= max && d.getDay() === weekday) count += 1;
  }
  return count;
}

function countBiweeklyDatesInMonthV12(month, anchorDateText) {
  const start = new Date(`${month}-01T00:00:00`);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  let anchor = new Date(`${anchorDateText}T00:00:00`);
  while (anchor > start) anchor.setDate(anchor.getDate() - 14);
  let count = 0;
  for (let d = new Date(anchor); d <= last; d.setDate(d.getDate() + 14)) {
    if (d >= start && d <= last) count += 1;
  }
  return count;
}

function renderIncomeSummaryV12(month, forecast) {
  const container = $('#budgetIncomeSummary');
  if (!container) return;
  const schedules = forecast.schedules || [];
  container.innerHTML = schedules.length ? schedules.map((s) => `<div class="budget-income-pill"><span>${escapeHtml(s.incomeName)}</span><strong>${formatCurrency(calculateIncomeForScheduleV12(s, month))}</strong><small>${escapeHtml(titleCase(s.frequency))} • ${escapeHtml(s.amountBasis)}</small></div>`).join('') : `<div class="empty-state">No income schedule saved yet. Add income to forecast available money.</div>`;
}

function renderBudgetAlertV12(forecast, totalPlanned, bucketCards) {
  const alert = $('#budgetAlert');
  if (!alert) return;
  const overIncome = totalPlanned - forecast.net;
  const overBuckets = bucketCards.filter((card) => card.overExpenseAmount > 0);
  if (overIncome > 0 || overBuckets.length) {
    const bucketText = overBuckets.length ? ` ${overBuckets.length} bucket(s) also have planned expenses above their bucket budget.` : '';
    alert.hidden = false;
    alert.className = 'budget-alert';
    alert.textContent = overIncome > 0 ? `You have budgeted ${formatCurrency(totalPlanned)} against ${formatCurrency(forecast.net)} available. You are over budget by ${formatCurrency(overIncome)}.${bucketText}` : bucketText.trim();
  } else {
    alert.hidden = true;
  }
}

function budgetBucketCardHtmlV12(card) {
  const pct = card.plannedAmount ? Math.min(100, Math.round((card.actualAmount / card.plannedAmount) * 100)) : 0;
  const overClass = card.overExpenseAmount > 0 ? 'over' : '';
  const expenseRows = card.expenses.length ? card.expenses.map((expense) => plannedExpenseHtmlV12(expense, card.bucketId)).join('') : `<div class="empty-state">No planned expenses for this bucket.</div>`;
  return `<section class="budget-bucket-card ${overClass}" data-budget-bucket-id="${escapeHtml(card.bucketId)}">
    <div class="budget-bucket-head"><div><h4>${escapeHtml(card.bucketName)}</h4><small>${escapeHtml(card.bucketId)}</small></div>${card.overExpenseAmount > 0 ? `<span class="budget-chip danger">Expenses over by ${formatCurrency(card.overExpenseAmount)}</span>` : `<span class="budget-chip">On plan</span>`}</div>
    <div class="budget-bucket-edit">
      <label>Type<select class="budget-allocation-type"><option value="fixed" ${card.allocationType === 'fixed' ? 'selected' : ''}>Fixed $</option><option value="percentage" ${card.allocationType === 'percentage' ? 'selected' : ''}>Percentage %</option></select></label>
      <label>Budget Value<input class="budget-allocation-value" type="number" step="0.01" min="0" value="${Number(card.allocationValue || 0)}" /></label>
      <label>Percentage Basis<select class="budget-allocation-basis">${Object.entries(BUDGET_BASIS_LABELS_V12).map(([value,label]) => `<option value="${value}" ${card.allocationBasis === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    </div>
    <div class="budget-bucket-metrics"><div class="budget-bucket-metric"><span>Planned</span><strong>${formatCurrency(card.plannedAmount)}</strong></div><div class="budget-bucket-metric"><span>Actual</span><strong>${formatCurrency(card.actualAmount)}</strong></div><div class="budget-bucket-metric"><span>Remaining</span><strong class="${card.remainingAmount < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(card.remainingAmount)}</strong></div></div>
    <div class="budget-progress-row"><div class="budget-progress-label"><span>Used</span><strong>${pct}%</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,pct)}%"></div></div></div>
    <div class="budget-section-heading"><div><strong>Planned expenses</strong><p class="card-subtitle">Monthly total: ${formatCurrency(card.expenseTotal)}</p></div><button class="secondary-button add-planned-expense-button" data-bucket-id="${escapeHtml(card.bucketId)}" type="button">Add Expense</button></div>
    <div class="planned-expense-list">${expenseRows}</div>
  </section>`;
}

function plannedExpenseHtmlV12(expense, bucketId) {
  const frequency = expense.frequency === 'weekly' ? `Weekly ${weekdayNameV12(expense.dayOfWeek)}` : titleCase(expense.frequency || 'monthly');
  const flags = `${expense.autoGenerateTransaction ? 'Auto allocation' : 'No auto allocation'}${expense.requiresManualActual ? ' • Manual actual' : ''}`;
  return `<div class="planned-expense-row" data-expense-id="${escapeHtml(expense.id)}"><div><strong>${escapeHtml(expense.expenseName)}</strong><small>${escapeHtml(frequency)} • ${formatCurrency(expense.amount)} • Month ${formatCurrency(expense.monthlyCalculatedAmount)}</small><small>${escapeHtml(flags)}</small></div><button class="text-button edit-planned-expense-button" type="button" data-expense-id="${escapeHtml(expense.id)}" data-bucket-id="${escapeHtml(bucketId)}">Edit</button></div>`;
}

function wireBudgetCardsV12() {
  $$('.budget-allocation-type, .budget-allocation-value, .budget-allocation-basis').forEach((input) => input.addEventListener('input', debounceV12(saveBudgetPlan, 650)));
  $$('.add-planned-expense-button').forEach((button) => button.addEventListener('click', () => openPlannedExpenseDialogV12(button.dataset.bucketId)));
  $$('.edit-planned-expense-button').forEach((button) => button.addEventListener('click', () => openPlannedExpenseDialogV12(button.dataset.bucketId, button.dataset.expenseId)));
}

function readBucketBudgetsFromDomV12() {
  const month = getSelectedBudgetMonthV12();
  return $$('.budget-bucket-card[data-budget-bucket-id]').map((card) => {
    const bucketId = card.dataset.budgetBucketId;
    const allocationType = card.querySelector('.budget-allocation-type').value;
    const allocationValue = parseMoneyValue(card.querySelector('.budget-allocation-value').value);
    const allocationBasis = card.querySelector('.budget-allocation-basis').value;
    const forecast = calculateIncomeForecastV12(month);
    const plannedAmount = allocationType === 'percentage' ? roundCurrencyV12(getBasisAmountV12(allocationBasis, forecast, []) * allocationValue / 100) : allocationValue;
    return { budgetMonth: month, bucketId, categoryId: `cat_${bucketId}`, allocationType, allocationValue, allocationBasis, plannedAmount, notes: '' };
  });
}

async function saveBudgetPlan() {
  try {
    const month = getSelectedBudgetMonthV12();
    const rows = readBucketBudgetsFromDomV12();
    const result = await callPost('saveSimplifiedBudgetPlan', { budgetMonth: month, rows });
    if (Array.isArray(result.budgets)) state.budgets = state.budgets.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(result.budgets.map(normaliseBudgetV12));
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    showToast('Budget saved.');
  } catch (error) {
    showToast(error.message);
  }
}

function openIncomeDialogV12() {
  const dialog = $('#incomeDialog');
  const first = (state.budgetIncome || [])[0];
  $('#incomeNameInput').value = first ? first.incomeName : 'Primary Pay';
  $('#incomeAmountInput').value = first ? Number(first.amount || 0) : '';
  $('#incomeBasisInput').value = first ? first.amountBasis : 'net';
  $('#incomeFrequencyInput').value = first ? first.frequency : 'weekly';
  $('#incomeDayOfWeekInput').value = first && first.dayOfWeek !== '' ? first.dayOfWeek : '5';
  $('#incomeDayOfMonthInput').value = first ? Number(first.dayOfMonth || 1) : 1;
  $('#incomeEffectiveStartInput').value = first ? first.effectiveStartDate : todayIsoV12();
  $('#incomeNotesInput').value = first ? first.notes : '';
  dialog.showModal();
}

async function submitIncomeV12(event) {
  event.preventDefault();
  try {
    const payload = {
      incomeName: $('#incomeNameInput').value.trim(),
      amount: parseMoneyValue($('#incomeAmountInput').value),
      amountBasis: $('#incomeBasisInput').value,
      frequency: $('#incomeFrequencyInput').value,
      dayOfWeek: $('#incomeDayOfWeekInput').value,
      dayOfMonth: $('#incomeDayOfMonthInput').value,
      effectiveStartDate: $('#incomeEffectiveStartInput').value,
      notes: $('#incomeNotesInput').value.trim()
    };
    const result = await callPost('saveBudgetIncome', payload);
    state.budgetIncome = (state.budgetIncome || []).filter((row) => row.id !== result.income.id).concat([normaliseBudgetIncomeV12(result.income)]);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    $('#incomeDialog').close();
    renderAll();
    showToast('Income schedule saved.');
  } catch (error) { showToast(error.message); }
}

function openPlannedExpenseDialogV12(bucketId, expenseId) {
  const expense = (state.budgetPlannedExpenses || []).find((row) => row.id === expenseId);
  $('#plannedExpenseIdInput').value = expense ? expense.id : '';
  $('#plannedExpenseNameInput').value = expense ? expense.expenseName : '';
  populatePlannedExpenseBucketSelectV12(bucketId || (expense && expense.bucketId));
  $('#plannedExpenseFrequencyInput').value = expense ? expense.frequency : 'monthly';
  $('#plannedExpenseDayOfWeekInput').value = expense ? expense.dayOfWeek : '';
  $('#plannedExpenseAmountInput').value = expense ? Number(expense.amount || 0) : '';
  $('#plannedExpenseStartDateInput').value = expense ? expense.startDate : `${getSelectedBudgetMonthV12()}-01`;
  $('#plannedExpenseAutoGenerateInput').checked = expense ? expense.autoGenerateTransaction : true;
  $('#plannedExpenseManualActualInput').checked = expense ? expense.requiresManualActual : false;
  $('#plannedExpenseNotesInput').value = expense ? expense.notes : '';
  $('#plannedExpenseDialog').showModal();
}

function populatePlannedExpenseBucketSelectV12(selectedBucketId) {
  const options = activeBucketAccounts().map((account) => ({ value: effectiveBucketId(account.bucketId || account.id || account.name), label: account.name || bucketNameById(account.bucketId || account.id) }));
  safeFillSelect($('#plannedExpenseBucketInput'), options);
  if (selectedBucketId) $('#plannedExpenseBucketInput').value = selectedBucketId;
}

async function submitPlannedExpenseV12(event) {
  event.preventDefault();
  try {
    const month = getSelectedBudgetMonthV12();
    const payload = {
      id: $('#plannedExpenseIdInput').value,
      budgetMonth: month,
      expenseName: $('#plannedExpenseNameInput').value.trim(),
      bucketId: $('#plannedExpenseBucketInput').value,
      frequency: $('#plannedExpenseFrequencyInput').value,
      dayOfWeek: $('#plannedExpenseDayOfWeekInput').value,
      amount: parseMoneyValue($('#plannedExpenseAmountInput').value),
      startDate: $('#plannedExpenseStartDateInput').value,
      autoGenerateTransaction: $('#plannedExpenseAutoGenerateInput').checked,
      requiresManualActual: $('#plannedExpenseManualActualInput').checked,
      notes: $('#plannedExpenseNotesInput').value.trim()
    };
    const result = await callPost('saveBudgetPlannedExpense', payload);
    state.budgetPlannedExpenses = (state.budgetPlannedExpenses || []).filter((row) => row.id !== result.expense.id).concat([normalisePlannedExpenseV12(result.expense)]);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    $('#plannedExpenseDialog').close();
    renderAll();
    showToast('Planned expense saved.');
  } catch (error) { showToast(error.message); }
}

async function generatePlannedTransactionsV12() {
  try {
    const month = getSelectedBudgetMonthV12();
    const result = await callPost('generatePlannedTransactions', { budgetMonth: month });
    if (Array.isArray(result.generatedTransactions)) state.budgetGeneratedTransactions = result.generatedTransactions.map(normaliseGeneratedTransactionV12);
    if (Array.isArray(result.transactions)) state.transactions = state.transactions.concat(result.transactions.map(normaliseTransaction));
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    showToast(`Generated ${result.generatedCount || 0} planned allocation transaction(s).`);
  } catch (error) { showToast(error.message); }
}

function copyPreviousBudgetV7() {
  const month = getSelectedBudgetMonthV12();
  const priorBudgetMonth = unique(state.budgets.map((b) => normaliseMonthValue(b.budgetMonth)).filter((m) => m && m < month)).sort().pop();
  if (!priorBudgetMonth) return showToast('No previous budget month found.');
  const copied = state.budgets.filter((b) => normaliseMonthValue(b.budgetMonth) === priorBudgetMonth).map((b) => ({ ...b, id: '', budgetMonth: month }));
  state.budgets = state.budgets.filter((b) => normaliseMonthValue(b.budgetMonth) !== month).concat(copied);
  const priorExpenseMonth = unique((state.budgetPlannedExpenses || []).map((e) => normaliseMonthValue(e.budgetMonth)).filter((m) => m && m < month)).sort().pop();
  if (priorExpenseMonth) {
    const copiedExpenses = state.budgetPlannedExpenses.filter((e) => normaliseMonthValue(e.budgetMonth) === priorExpenseMonth).map((e) => ({ ...e, id: '', budgetMonth: month }));
    state.budgetPlannedExpenses = state.budgetPlannedExpenses.filter((e) => normaliseMonthValue(e.budgetMonth) !== month).concat(copiedExpenses);
  }
  renderAll();
  showToast('Previous month copied locally. Save Budget to persist.');
}

function weekdayNameV12(value) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(value)] || '';
}

function roundCurrencyV12(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function todayIsoV12() { return new Date().toISOString().slice(0, 10); }
function setTextV12(selector, text) { const node = $(selector); if (node) node.textContent = text; }
function debounceV12(fn, ms) { let timer; return (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), ms); }; }

function showDucatsEasterEggV8() {
  let toast = $('#ducatsToast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'ducatsToast'; toast.className = 'ducats-toast'; document.body.appendChild(toast); }
  toast.textContent = '25 Ducats: plan the buckets, count the ducats, and keep the little green nuggets in order.';
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 4200);
}

document.addEventListener('DOMContentLoaded', () => {
  const addIncome = $('#addIncomeScheduleButton');
  if (addIncome) addIncome.addEventListener('click', openIncomeDialogV12);
  const closeIncome = $('#closeIncomeDialogButton');
  if (closeIncome) closeIncome.addEventListener('click', () => $('#incomeDialog').close());
  const cancelIncome = $('#cancelIncomeButton');
  if (cancelIncome) cancelIncome.addEventListener('click', () => $('#incomeDialog').close());
  const incomeForm = $('#incomeForm');
  if (incomeForm) incomeForm.addEventListener('submit', submitIncomeV12);
  const closeExpense = $('#closePlannedExpenseDialogButton');
  if (closeExpense) closeExpense.addEventListener('click', () => $('#plannedExpenseDialog').close());
  const cancelExpense = $('#cancelPlannedExpenseButton');
  if (cancelExpense) cancelExpense.addEventListener('click', () => $('#plannedExpenseDialog').close());
  const expenseForm = $('#plannedExpenseForm');
  if (expenseForm) expenseForm.addEventListener('submit', submitPlannedExpenseV12);
  const generateButton = $('#generatePlannedTransactionsButton');
  if (generateButton) generateButton.addEventListener('click', generatePlannedTransactionsV12);
});

// --- v13 budget ordering, local draft backup, and deferred Google Sheets sync ---
const BUDGET_DRAFT_KEY_V13 = 'budgetApp.budgetDraftV13';
const BUDGET_LAYOUT_KEY_V13 = 'budgetApp.budgetLayoutV13';
const BUDGET_GROUPS_V13 = [
  { id: 'gross', title: '1. Gross', description: 'Total forecast pay before deductions.' },
  { id: 'take_home', title: '2. Take-Home', description: 'Taxes and 401K before take-home pay.' },
  { id: 'fixed_expenses', title: '3. Fixed Expenses', description: 'Rent, tithing, car payment, and car insurance.' },
  { id: 'savings', title: '4. Savings', description: 'Career, savings, and stocks.' },
  { id: 'necessities', title: '5. Necessities', description: 'Food and variable car necessities such as charging.' },
  { id: 'other', title: '6. Other', description: 'Fun spending and other expenses.' }
];
const DEFAULT_BUCKET_GROUPS_V13 = {
  taxes: 'take_home',
  '401k': 'take_home',
  rent: 'fixed_expenses',
  tithing: 'fixed_expenses',
  car: 'fixed_expenses',
  career: 'savings',
  savings: 'savings',
  stocks: 'savings',
  food: 'necessities',
  fun: 'other',
  other_expenses: 'other'
};
const DEFAULT_EXPENSE_GROUPS_V13 = {
  car_payment: 'fixed_expenses',
  car_insurance: 'fixed_expenses',
  car_charging: 'necessities',
  rent: 'fixed_expenses',
  tithing: 'fixed_expenses',
  food: 'necessities',
  fun: 'other',
  other_spending: 'other'
};
state.budgetDraftDirty = false;

function renderSimpleBudgetsV12() {
  applyBudgetDraftIfCurrentMonthV13();
  const list = $('#budgetBucketsList');
  if (!list) return;
  const month = getSelectedBudgetMonthV12();
  const forecast = calculateIncomeForecastV12(month);
  const budgetRows = getBudgetRowsForMonthV12(month);
  const bucketCards = activeBucketAccounts().map((account) => buildBudgetBucketCardV12(account, month, budgetRows, forecast));
  const grouped = groupBudgetCardsV13(bucketCards, month);
  const totalPlanned = sum(bucketCards.map((row) => row.plannedAmount));
  const remaining = forecast.net - totalPlanned;
  setTextV12('#budgetForecastGross', formatCurrency(forecast.gross));
  setTextV12('#budgetForecastNet', formatCurrency(forecast.net));
  setTextV12('#budgetTotalPlanned', formatCurrency(totalPlanned));
  setTextV12('#budgetRemainingIncome', formatCurrency(remaining));
  renderIncomeSummaryV12(month, forecast);
  renderBudgetAlertV12(forecast, totalPlanned, bucketCards);
  list.innerHTML = BUDGET_GROUPS_V13.map((group) => budgetGroupSectionHtmlV13(group, grouped[group.id] || [], forecast)).join('');
  renderDraftIndicatorV13();
  wireBudgetCardsV12();
}

function groupBudgetCardsV13(bucketCards, month) {
  const grouped = Object.fromEntries(BUDGET_GROUPS_V13.map((group) => [group.id, []]));
  bucketCards.forEach((card) => {
    const groupId = getBucketGroupV13(card.bucketId);
    (grouped[groupId] || grouped.other).push(card);
  });
  Object.values(grouped).forEach((cards) => cards.sort(compareBudgetCardsV13));
  return grouped;
}

function compareBudgetCardsV13(a, b) {
  const order = ['taxes','401k','rent','tithing','car','career','savings','stocks','food','fun','other_expenses'];
  return (order.indexOf(a.bucketId) === -1 ? 999 : order.indexOf(a.bucketId)) - (order.indexOf(b.bucketId) === -1 ? 999 : order.indexOf(b.bucketId)) || a.bucketName.localeCompare(b.bucketName);
}

function budgetGroupSectionHtmlV13(group, cards, forecast) {
  if (group.id === 'gross') {
    return `<section class="budget-group-section"><div class="budget-group-heading"><div><h4>${escapeHtml(group.title)}</h4><p>${escapeHtml(group.description)}</p></div><span class="budget-group-total">${formatCurrency(forecast.gross)}</span></div>${grossCardHtmlV13(forecast)}</section>`;
  }
  const groupTotal = sum(cards.map((card) => card.plannedAmount));
  const cardsHtml = cards.length ? cards.map((card) => budgetBucketCardHtmlV13(card, group.id)).join('') : `<div class="empty-state">No items assigned to this category.</div>`;
  return `<section class="budget-group-section" data-budget-group="${escapeHtml(group.id)}"><div class="budget-group-heading"><div><h4>${escapeHtml(group.title)}</h4><p>${escapeHtml(group.description)}</p></div><span class="budget-group-total">${formatCurrency(groupTotal)}</span></div>${cardsHtml}</section>`;
}

function grossCardHtmlV13(forecast) {
  const rows = (forecast.schedules || []).map((schedule) => `<div class="planned-expense-row"><div><strong>${escapeHtml(schedule.incomeName)}</strong><small>${escapeHtml(titleCase(schedule.frequency))} ${schedule.dayOfWeek !== '' ? 'on ' + weekdayNameV12(schedule.dayOfWeek) : ''} - ${escapeHtml(schedule.amountBasis)}</small></div><strong>${formatCurrency(calculateIncomeForScheduleV12(schedule, getSelectedBudgetMonthV12()))}</strong></div>`).join('');
  return `<section class="budget-bucket-card budget-group-gross"><div class="budget-bucket-head"><div><h4>Total Pay</h4><small>Forecast income for this month</small></div><span class="budget-mode-pill budget-mode-fixed">Income</span></div><div class="budget-bucket-metrics"><div class="budget-bucket-metric"><span>Gross</span><strong>${formatCurrency(forecast.gross)}</strong></div><div class="budget-bucket-metric"><span>Net</span><strong>${formatCurrency(forecast.net)}</strong></div><div class="budget-bucket-metric"><span>Schedules</span><strong>${(forecast.schedules || []).length}</strong></div></div><div class="planned-expense-list">${rows || '<div class="empty-state">Add income to forecast available money.</div>'}</div></section>`;
}

function budgetBucketCardHtmlV13(card, groupId) {
  const pct = card.plannedAmount ? Math.min(100, Math.round((card.actualAmount / card.plannedAmount) * 100)) : 0;
  const overClass = card.overExpenseAmount > 0 ? 'over' : '';
  const modeClass = card.allocationType === 'percentage' ? 'budget-mode-percentage' : 'budget-mode-fixed';
  const modeText = card.allocationType === 'percentage' ? `${Number(card.allocationValue || 0)}% of ${BUDGET_BASIS_LABELS_V12[card.allocationBasis] || card.allocationBasis}` : `Fixed ${formatCurrency(card.allocationValue || 0)}`;
  const expenseRows = card.expenses.length ? card.expenses.map((expense) => plannedExpenseHtmlV13(expense, card.bucketId)).join('') : `<div class="empty-state">No planned expenses for this bucket.</div>`;
  const editModeClass = card.allocationType === 'percentage' ? 'percentage-mode' : 'fixed-mode';
  return `<section class="budget-bucket-card budget-group-${escapeHtml(groupId)} ${overClass}" data-budget-bucket-id="${escapeHtml(card.bucketId)}">
    <div class="budget-bucket-head"><div><h4>${escapeHtml(card.bucketName)}</h4><small>${escapeHtml(groupTitleV13(groupId))}</small></div><span class="budget-mode-pill ${modeClass}">${escapeHtml(modeText)}</span></div>
    <div class="budget-bucket-edit ${editModeClass}">
      <label>Spending type<select class="budget-allocation-type"><option value="fixed" ${card.allocationType === 'fixed' ? 'selected' : ''}>Fixed dollar amount</option><option value="percentage" ${card.allocationType === 'percentage' ? 'selected' : ''}>Percentage based</option></select></label>
      <label class="budget-allocation-value-wrap">Budget value<input class="budget-allocation-value" type="number" step="0.01" min="0" value="${Number(card.allocationValue || 0)}" /></label>
      <label class="budget-allocation-basis-wrap">Percentage basis<select class="budget-allocation-basis">${Object.entries(BUDGET_BASIS_LABELS_V12).map(([value,label]) => `<option value="${value}" ${card.allocationBasis === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    </div>
    <div class="budget-bucket-metrics"><div class="budget-bucket-metric"><span>Planned</span><strong>${formatCurrency(card.plannedAmount)}</strong></div><div class="budget-bucket-metric"><span>Actual</span><strong>${formatCurrency(card.actualAmount)}</strong></div><div class="budget-bucket-metric"><span>Remaining</span><strong class="${card.remainingAmount < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(card.remainingAmount)}</strong></div></div>
    <div class="budget-progress-row"><div class="budget-progress-label"><span>Used</span><strong>${pct}%</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,pct)}%"></div></div></div>
    <div class="budget-section-heading"><div><strong>Planned expenses</strong><p class="card-subtitle">Monthly total: ${formatCurrency(card.expenseTotal)}${card.bucketId === 'car' ? ' - includes fixed and variable car items.' : ''}</p></div><button class="secondary-button add-planned-expense-button" data-bucket-id="${escapeHtml(card.bucketId)}" type="button">Add Expense</button></div>
    <div class="planned-expense-list">${expenseRows}</div>
  </section>`;
}

function plannedExpenseHtmlV13(expense, bucketId) {
  const frequency = expense.frequency === 'weekly' ? `Weekly ${weekdayNameV12(expense.dayOfWeek)}` : titleCase(expense.frequency || 'monthly');
  const flags = `${expense.autoGenerateTransaction ? 'Auto allocation' : 'No auto allocation'}${expense.requiresManualActual ? ' - Manual actual' : ''}`;
  const groupId = getExpenseGroupV13(expense);
  return `<div class="planned-expense-row" data-expense-id="${escapeHtml(expense.id)}"><div><strong>${escapeHtml(expense.expenseName)}</strong><small>${escapeHtml(frequency)} - ${formatCurrency(expense.amount)} - Month ${formatCurrency(expense.monthlyCalculatedAmount)}</small><small>${escapeHtml(flags)}</small><span class="expense-group-tag">${escapeHtml(groupTitleV13(groupId))}</span></div><button class="text-button edit-planned-expense-button" type="button" data-expense-id="${escapeHtml(expense.id)}" data-bucket-id="${escapeHtml(bucketId)}">Edit</button></div>`;
}

function getBudgetLayoutV13() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BUDGET_LAYOUT_KEY_V13) || '{}');
    return { bucketGroups: { ...DEFAULT_BUCKET_GROUPS_V13, ...(parsed.bucketGroups || {}) }, expenseGroups: { ...DEFAULT_EXPENSE_GROUPS_V13, ...(parsed.expenseGroups || {}) } };
  } catch {
    return { bucketGroups: { ...DEFAULT_BUCKET_GROUPS_V13 }, expenseGroups: { ...DEFAULT_EXPENSE_GROUPS_V13 } };
  }
}
function saveBudgetLayoutV13(layout) { localStorage.setItem(BUDGET_LAYOUT_KEY_V13, JSON.stringify(layout)); }
function getBucketGroupV13(bucketId) { return normaliseGroupV13(getBudgetLayoutV13().bucketGroups[bucketId] || DEFAULT_BUCKET_GROUPS_V13[bucketId] || 'other'); }
function getExpenseGroupV13(expense) { const key = budgetItemKeyV13(expense.expenseName || ''); return normaliseGroupV13(getBudgetLayoutV13().expenseGroups[key] || DEFAULT_EXPENSE_GROUPS_V13[key] || DEFAULT_BUCKET_GROUPS_V13[expense.bucketId] || 'other'); }
function normaliseGroupV13(value) { return BUDGET_GROUPS_V13.some((group) => group.id === value) ? value : 'other'; }
function groupTitleV13(groupId) { return (BUDGET_GROUPS_V13.find((group) => group.id === groupId) || BUDGET_GROUPS_V13[BUDGET_GROUPS_V13.length - 1]).title.replace(/^\d+\.\s*/, ''); }
function budgetItemKeyV13(value) { return slugify(value || '').replace(/^acct_/, '').replace(/^cat_/, ''); }

function wireBudgetCardsV12() {
  $$('.budget-allocation-type, .budget-allocation-value, .budget-allocation-basis').forEach((input) => {
    input.addEventListener('input', recordBudgetDraftV13);
    input.addEventListener('change', () => { applyBudgetDraftToStateV13(); renderSimpleBudgetsV12(); });
  });
  $$('.add-planned-expense-button').forEach((button) => button.addEventListener('click', () => openPlannedExpenseDialogV12(button.dataset.bucketId)));
  $$('.edit-planned-expense-button').forEach((button) => button.addEventListener('click', () => openPlannedExpenseDialogV12(button.dataset.bucketId, button.dataset.expenseId)));
}

function recordBudgetDraftV13() {
  const month = getSelectedBudgetMonthV12();
  const rows = readBucketBudgetsFromDomV12();
  localStorage.setItem(BUDGET_DRAFT_KEY_V13, JSON.stringify({ month, rows, savedAt: new Date().toISOString() }));
  state.budgetDraftDirty = true;
  renderDraftIndicatorV13();
}
function applyBudgetDraftToStateV13() {
  const month = getSelectedBudgetMonthV12();
  const rows = readBucketBudgetsFromDomV12();
  state.budgets = state.budgets.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(rows.map(normaliseBudgetV12));
  localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
}
function applyBudgetDraftIfCurrentMonthV13() {
  try {
    const draft = JSON.parse(localStorage.getItem(BUDGET_DRAFT_KEY_V13) || '{}');
    if (!draft.month || !Array.isArray(draft.rows)) return;
    const current = getSelectedBudgetMonthV12();
    if (draft.month !== current) return;
    const hasDraft = draft.rows.length > 0;
    if (hasDraft) state.budgets = state.budgets.filter((row) => normaliseMonthValue(row.budgetMonth) !== current).concat(draft.rows.map(normaliseBudgetV12));
  } catch {}
}
function renderDraftIndicatorV13() {
  const heading = $('#budgetsView .card-heading .filter-row');
  if (!heading) return;
  let note = $('#budgetDraftNote');
  if (!note) {
    note = document.createElement('span');
    note.id = 'budgetDraftNote';
    note.className = 'budget-draft-note';
    heading.prepend(note);
  }
  note.hidden = !state.budgetDraftDirty;
  note.textContent = 'Local draft saved';
}

async function saveBudgetPlan() {
  try {
    applyBudgetDraftToStateV13();
    const month = getSelectedBudgetMonthV12();
    const rows = readBucketBudgetsFromDomV12();
    const result = await callPost('saveSimplifiedBudgetPlan', { budgetMonth: month, rows });
    if (Array.isArray(result.budgets)) state.budgets = state.budgets.filter((row) => normaliseMonthValue(row.budgetMonth) !== month).concat(result.budgets.map(normaliseBudgetV12));
    state.budgetDraftDirty = false;
    localStorage.removeItem(BUDGET_DRAFT_KEY_V13);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    showToast('Budget saved to Google Sheets.');
  } catch (error) { showToast(error.message); }
}

async function switchView(view) {
  const leavingBudget = state.activeView === 'budgets' && view !== 'budgets';
  if (leavingBudget && state.budgetDraftDirty) await saveBudgetPlan();
  state.activeView = view;
  $$('.view').forEach((section) => section.classList.remove('active'));
  const target = $(`#${view}View`) || $('#dashboardView');
  target.classList.add('active');
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { dashboard: 'Dashboard', buckets: 'Buckets', transfers: 'Transfers', admin: 'Bucket Admin', transactions: 'Transactions', budgets: 'Budgets', settings: 'Settings' };
  if (elements.viewTitle) elements.viewTitle.textContent = titles[view] || titleCase(view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openBudgetLayoutDialogV13() {
  renderBudgetLayoutEditorV13();
  $('#budgetLayoutDialog').showModal();
}
function renderBudgetLayoutEditorV13() {
  const container = $('#budgetLayoutEditor');
  if (!container) return;
  const layout = getBudgetLayoutV13();
  const month = getSelectedBudgetMonthV12();
  const rows = [];
  activeBucketAccounts().forEach((account) => {
    const bucketId = effectiveBucketId(account.bucketId || account.id || account.name);
    rows.push(layoutRowHtmlV13('bucket', bucketId, account.name || bucketNameById(bucketId), 'Bucket', layout.bucketGroups[bucketId] || getBucketGroupV13(bucketId)));
    getPlannedExpensesForMonthV12(month, bucketId).forEach((expense) => {
      const key = budgetItemKeyV13(expense.expenseName);
      rows.push(layoutRowHtmlV13('expense', key, expense.expenseName, `Planned expense in ${account.name || bucketId}`, layout.expenseGroups[key] || getExpenseGroupV13(expense)));
    });
  });
  container.innerHTML = rows.join('') || '<div class="empty-state">No budget items are available to organise yet.</div>';
}
function layoutRowHtmlV13(type, key, label, subtitle, selectedGroup) {
  return `<div class="budget-layout-row ${type === 'expense' ? 'expense' : ''}" data-layout-type="${escapeHtml(type)}" data-layout-key="${escapeHtml(key)}"><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(subtitle)}</small></div><select class="budget-layout-select">${BUDGET_GROUPS_V13.map((group) => `<option value="${group.id}" ${selectedGroup === group.id ? 'selected' : ''}>${group.title}</option>`).join('')}</select></div>`;
}
function applyBudgetLayoutV13(event) {
  event.preventDefault();
  const layout = { bucketGroups: {}, expenseGroups: {} };
  $$('#budgetLayoutEditor .budget-layout-row').forEach((row) => {
    const type = row.dataset.layoutType;
    const key = row.dataset.layoutKey;
    const value = row.querySelector('.budget-layout-select').value;
    if (type === 'bucket') layout.bucketGroups[key] = value;
    if (type === 'expense') layout.expenseGroups[key] = value;
  });
  saveBudgetLayoutV13(layout);
  $('#budgetLayoutDialog').close();
  renderSimpleBudgetsV12();
  showToast('Budget layout updated.');
}
function resetBudgetLayoutV13() {
  localStorage.removeItem(BUDGET_LAYOUT_KEY_V13);
  renderBudgetLayoutEditorV13();
  renderSimpleBudgetsV12();
  showToast('Budget layout reset.');
}

document.addEventListener('DOMContentLoaded', () => {
  const layoutButton = $('#openBudgetLayoutButton');
  if (layoutButton) layoutButton.addEventListener('click', openBudgetLayoutDialogV13);
  const layoutForm = $('#budgetLayoutForm');
  if (layoutForm) layoutForm.addEventListener('submit', applyBudgetLayoutV13);
  const closeLayout = $('#closeBudgetLayoutDialogButton');
  if (closeLayout) closeLayout.addEventListener('click', () => $('#budgetLayoutDialog').close());
  const cancelLayout = $('#cancelBudgetLayoutButton');
  if (cancelLayout) cancelLayout.addEventListener('click', () => $('#budgetLayoutDialog').close());
  const resetLayout = $('#resetBudgetLayoutButton');
  if (resetLayout) resetLayout.addEventListener('click', resetBudgetLayoutV13);
});

// --- v14: drill-down screens, editable transactions, editable income, and budget line-item pane ---
state.selectedBucketId = '';
state.selectedTransactionId = '';
state.previousView = 'dashboard';

function normalisePlannedExpenseV12(row) {
  return {
    ...row,
    id: row.id || '',
    budgetMonth: normaliseMonthValue(row.budgetMonth),
    bucketId: bucketIdFromAny(row.bucketId || row.bucketID || ''),
    expenseName: row.expenseName || row.name || '',
    budgetCategory: row.budgetCategory || row.groupId || 'other',
    allocationType: row.allocationType || 'fixed',
    allocationBasis: row.allocationBasis || 'net_income',
    frequency: row.frequency || 'monthly',
    dayOfWeek: row.dayOfWeek === '' || row.dayOfWeek === undefined ? '' : String(row.dayOfWeek),
    amount: parseMoneyValue(row.amount),
    monthlyCalculatedAmount: parseMoneyValue(row.monthlyCalculatedAmount),
    autoGenerateTransaction: normaliseBoolean(row.autoGenerateTransaction),
    requiresManualActual: String(row.requiresManualActual || '').toLowerCase() === 'true' || row.requiresManualActual === true,
    startDate: normaliseDateValue(row.startDate || ''),
    endDate: normaliseDateValue(row.endDate || ''),
    notes: row.notes || ''
  };
}

function calculatePlannedExpenseMonthlyAmountV12(expense, month) {
  const basisForecast = calculateIncomeForecastV12(month);
  const baseAmount = expense.allocationType === 'percentage' ? getBasisAmountV12(expense.allocationBasis || 'net_income', basisForecast, []) * (Number(expense.amount || 0) / 100) : Number(expense.amount || 0);
  if (expense.frequency === 'weekly') return roundCurrencyV12(baseAmount * countWeekdayInMonthV12(month, Number(expense.dayOfWeek || 0)));
  return roundCurrencyV12(baseAmount);
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
    return `<button type="button" class="breakdown-row clickable-card" data-open-bucket="${escapeHtml(bucketId)}"><div class="breakdown-row-top"><strong>${escapeHtml(bucketNameById(bucketId))}</strong><span>${formatCurrency(amount)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></button>`;
  }).join('');
  wireDrilldownLinksV14();
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
  container.innerHTML = recent.map((txn) => `<button type="button" class="compact-row clickable-card" data-open-transaction="${escapeHtml(txn.id)}"><div class="compact-row-top"><strong>${escapeHtml(txn.description || txn.merchant || 'Transaction')}</strong><span class="${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount))}</span></div><small>${escapeHtml(txn.transactionDate || '')} • ${escapeHtml(bucketNameById(txn.bucketId || txn.accountId))}</small></button>`).join('');
  wireDrilldownLinksV14();
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
  if (body) body.innerHTML = filtered.map((txn) => `<tr class="clickable-row" data-open-transaction="${escapeHtml(txn.id)}"><td>${escapeHtml(txn.transactionDate || '')}</td><td>${escapeHtml(txn.description || '')}</td><td>${escapeHtml(txn.merchant || '')}</td><td>${escapeHtml(categoryName(txn.categoryId))}</td><td>${escapeHtml(bucketNameById(txn.bucketId || txn.accountId) || accountName(txn.accountId))}</td><td class="amount-col ${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount || 0))}</td></tr>`).join('') || `<tr><td colspan="6">No transactions match the current filters.</td></tr>`;
  if (cardList) cardList.innerHTML = filtered.map((txn) => `<article class="mobile-data-card clickable-card" data-open-transaction="${escapeHtml(txn.id)}"><div class="mobile-card-head"><strong>${escapeHtml(txn.description || txn.merchant || 'Transaction')}</strong><span class="${amountClass(txn.amount)}">${formatCurrency(Number(txn.amount || 0))}</span></div><div class="mobile-card-row"><span>Date</span><strong>${escapeHtml(txn.transactionDate || '')}</strong></div><div class="mobile-card-row"><span>Merchant</span><strong>${escapeHtml(txn.merchant || '—')}</strong></div><div class="mobile-card-row"><span>Bucket</span><strong>${escapeHtml(bucketNameById(txn.bucketId || txn.accountId) || accountName(txn.accountId) || '—')}</strong></div></article>`).join('') || `<div class="empty-state">No transactions match the current filters.</div>`;
  wireDrilldownLinksV14();
}

function renderBucketView() {
  const cardList = $('#bucketsCardList');
  const body = $('#bucketsTableBody');
  const month = getSelectedBucketMonth();
  const rows = buildBucketRows(month);
  const totalAvailable = sum(rows.map((row) => row.currentBalance));
  const totalChange = sum(rows.map((row) => monthChangeForBucketV14(row.id, month)));
  setTextV9('#bucketMetricPlanned', formatCurrency(totalAvailable));
  setTextV9('#bucketMetricFunded', formatCurrency(totalChange));
  setTextV9('#bucketMetricSpent', `${rows.length}`);
  setTextV9('#bucketMetricAvailable', formatCurrency(totalAvailable));
  const metrics = $$('#bucketsView .mini-metric span');
  if (metrics[0]) metrics[0].textContent = 'Total Stored';
  if (metrics[1]) metrics[1].textContent = 'Month Change';
  if (metrics[2]) metrics[2].textContent = 'Buckets';
  if (metrics[3]) metrics[3].textContent = 'Available';
  const cards = rows.map((row) => {
    const change = monthChangeForBucketV14(row.id, month);
    const cls = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
    return `<article class="bucket-focus-card clickable-card" data-open-bucket="${escapeHtml(row.id)}"><div><h4>${escapeHtml(row.name)}</h4><small>${escapeHtml(row.id)}</small><span class="bucket-change-pill ${cls}">${change >= 0 ? '+' : ''}${formatCurrency(change)} since previous month</span></div><div class="bucket-focus-balance ${row.currentBalance < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(row.currentBalance)}</div></article>`;
  }).join('') || `<div class="empty-state">No bucket data loaded.</div>`;
  if (cardList) { cardList.className = 'bucket-focus-list'; cardList.innerHTML = cards; }
  if (body) body.innerHTML = rows.map((row) => `<tr class="clickable-row" data-open-bucket="${escapeHtml(row.id)}"><td>${escapeHtml(row.name)}</td><td class="amount-col ${row.currentBalance < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(row.currentBalance)}</td><td class="amount-col ${monthChangeForBucketV14(row.id, month) < 0 ? 'amount-negative' : 'amount-positive'}">${formatCurrency(monthChangeForBucketV14(row.id, month))}</td></tr>`).join('');
  wireDrilldownLinksV14();
}

function monthChangeForBucketV14(bucketId, month) {
  const prev = previousMonthV14(month);
  const currentNet = sum(state.transactions.filter((txn) => transactionMonth(txn.transactionDate) === month && effectiveBucketId(txn.bucketId || txn.accountId) === bucketId).map((txn) => Number(txn.amount || 0)));
  const previousNet = sum(state.transactions.filter((txn) => transactionMonth(txn.transactionDate) === prev && effectiveBucketId(txn.bucketId || txn.accountId) === bucketId).map((txn) => Number(txn.amount || 0)));
  return roundCurrencyV12(currentNet - previousNet);
}
function previousMonthV14(month) { const d = new Date(`${month || currentYearMonth()}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0,7); }

function wireDrilldownLinksV14() {
  $$('[data-open-bucket]').forEach((node) => { if (!node.dataset.drillWired) { node.dataset.drillWired = 'true'; node.addEventListener('click', () => openBucketDetailV14(node.dataset.openBucket)); } });
  $$('[data-open-transaction]').forEach((node) => { if (!node.dataset.drillWired) { node.dataset.drillWired = 'true'; node.addEventListener('click', () => openTransactionDetailV14(node.dataset.openTransaction)); } });
}

function openBucketDetailV14(bucketId) {
  state.previousView = state.activeView || 'buckets';
  state.selectedBucketId = bucketId;
  const monthFilter = $('#bucketDetailMonthFilter');
  const bucketMonth = $('#bucketMonthFilter');
  if (monthFilter && bucketMonth) { monthFilter.innerHTML = bucketMonth.innerHTML; monthFilter.value = bucketMonth.value || getSelectedBucketMonth(); }
  renderBucketDetailV14();
  switchView('bucketDetail');
}
function renderBucketDetailV14() {
  const bucketId = state.selectedBucketId;
  const month = ($('#bucketDetailMonthFilter') && $('#bucketDetailMonthFilter').value) || getSelectedBucketMonth();
  const all = state.transactions.filter((txn) => effectiveBucketId(txn.bucketId || txn.accountId) === bucketId);
  const monthTxns = all.filter((txn) => transactionMonth(txn.transactionDate) === month);
  const balance = sum(all.map((txn) => Number(txn.amount || 0)));
  $('#bucketDetailTitle').textContent = bucketNameById(bucketId);
  $('#bucketDetailSubtitle').textContent = `Recent activity for ${month}`;
  $('#bucketDetailBalance').textContent = formatCurrency(balance);
  $('#bucketDetailMonthChange').textContent = formatCurrency(monthChangeForBucketV14(bucketId, month));
  $('#bucketDetailFunded').textContent = formatCurrency(sum(monthTxns.filter((txn) => Number(txn.amount) > 0).map((txn) => Number(txn.amount))));
  $('#bucketDetailSpent').textContent = formatCurrency(sum(monthTxns.filter((txn) => Number(txn.amount) < 0).map((txn) => Math.abs(Number(txn.amount)))));
  const list = $('#bucketDetailTransactions');
  list.innerHTML = monthTxns.sort((a,b) => String(b.transactionDate).localeCompare(String(a.transactionDate))).map((txn) => `<article class="mobile-data-card clickable-card" data-open-transaction="${escapeHtml(txn.id)}"><div class="mobile-card-head"><strong>${escapeHtml(txn.description || txn.merchant || 'Transaction')}</strong><span class="${amountClass(txn.amount)}">${formatCurrency(txn.amount)}</span></div><div class="mobile-card-row"><span>Date</span><strong>${escapeHtml(txn.transactionDate)}</strong></div><div class="mobile-card-row"><span>Merchant</span><strong>${escapeHtml(txn.merchant || '—')}</strong></div></article>`).join('') || '<div class="empty-state">No transactions for this bucket in the selected month.</div>';
  wireDrilldownLinksV14();
}

function openTransactionDetailV14(transactionId) {
  const txn = state.transactions.find((item) => item.id === transactionId);
  if (!txn) return showToast('Transaction not found.');
  state.previousView = state.activeView || 'transactions';
  state.selectedTransactionId = transactionId;
  populateTransactionDetailSelectsV14();
  $('#transactionDetailIdInput').value = txn.id;
  $('#transactionDetailDateInput').value = txn.transactionDate || '';
  $('#transactionDetailAmountInput').value = Number(txn.amount || 0);
  $('#transactionDetailMerchantInput').value = txn.merchant || '';
  $('#transactionDetailDescriptionInput').value = txn.description || '';
  $('#transactionDetailCategoryInput').value = txn.categoryId || '';
  $('#transactionDetailBucketInput').value = effectiveBucketId(txn.bucketId || txn.accountId);
  $('#transactionDetailNotesInput').value = txn.notes || '';
  $('#transactionDetailTitle').textContent = txn.description || txn.merchant || 'Transaction';
  switchView('transactionDetail');
}
function populateTransactionDetailSelectsV14() {
  safeFillSelect($('#transactionDetailCategoryInput'), state.categories.map((c) => ({ value: c.id, label: c.name || c.id })));
  safeFillSelect($('#transactionDetailBucketInput'), activeBucketAccounts().map((a) => ({ value: effectiveBucketId(a.bucketId || a.id || a.name), label: a.name || bucketNameById(a.bucketId || a.id) })));
}
async function submitTransactionDetailV14(event) {
  event.preventDefault();
  try {
    const id = $('#transactionDetailIdInput').value;
    const bucketId = $('#transactionDetailBucketInput').value;
    const payload = {
      id,
      transactionDate: $('#transactionDetailDateInput').value,
      amount: parseMoneyValue($('#transactionDetailAmountInput').value),
      merchant: $('#transactionDetailMerchantInput').value.trim(),
      description: $('#transactionDetailDescriptionInput').value.trim(),
      categoryId: $('#transactionDetailCategoryInput').value || `cat_${bucketId}`,
      accountId: `acct_${bucketId}`,
      bucketId,
      notes: $('#transactionDetailNotesInput').value.trim()
    };
    const result = await callPost('updateTransaction', payload);
    const updated = normaliseTransaction(result.transaction || payload);
    state.transactions = state.transactions.map((txn) => txn.id === id ? updated : txn);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    showToast('Transaction updated.');
    switchView(state.previousView || 'transactions');
  } catch (error) { showToast(error.message); }
}

function renderIncomeSummaryV12(month, forecast) {
  const container = $('#budgetIncomeSummary');
  if (!container) return;
  const schedules = forecast.schedules || [];
  container.innerHTML = schedules.length ? schedules.map((s) => `<button type="button" class="budget-income-pill clickable-card" data-edit-income="${escapeHtml(s.id)}"><span>${escapeHtml(s.incomeName)}</span><strong>${formatCurrency(calculateIncomeForScheduleV12(s, month))}</strong><small>${escapeHtml(titleCase(s.frequency))} • ${escapeHtml(s.amountBasis)}</small></button>`).join('') : `<div class="empty-state">No income schedule saved yet. Add income to forecast available money.</div>`;
  $$('[data-edit-income]').forEach((button) => button.addEventListener('click', () => openIncomeDialogV14(button.dataset.editIncome)));
}
function openIncomeDialogV14(id) {
  const first = id ? (state.budgetIncome || []).find((row) => row.id === id) : (state.budgetIncome || [])[0];
  $('#incomeIdInput').value = first ? first.id : '';
  $('#incomeNameInput').value = first ? first.incomeName : 'Primary Pay';
  $('#incomeAmountInput').value = first ? Number(first.amount || 0) : '';
  $('#incomeBasisInput').value = first ? first.amountBasis : 'net';
  $('#incomeFrequencyInput').value = first ? first.frequency : 'weekly';
  $('#incomeDayOfWeekInput').value = first && first.dayOfWeek !== '' ? first.dayOfWeek : '5';
  $('#incomeDayOfMonthInput').value = first ? Number(first.dayOfMonth || 1) : 1;
  $('#incomeEffectiveStartInput').value = first ? first.effectiveStartDate : todayIsoV12();
  $('#incomeNotesInput').value = first ? first.notes : '';
  $('#deleteIncomeButton').hidden = !first;
  $('#incomeDialog').showModal();
}
function openIncomeDialogV12() { openIncomeDialogV14(''); }
async function submitIncomeV12(event) {
  event.preventDefault();
  try {
    const payload = { id: $('#incomeIdInput').value, incomeName: $('#incomeNameInput').value.trim(), amount: parseMoneyValue($('#incomeAmountInput').value), amountBasis: $('#incomeBasisInput').value, frequency: $('#incomeFrequencyInput').value, dayOfWeek: $('#incomeDayOfWeekInput').value, dayOfMonth: $('#incomeDayOfMonthInput').value, effectiveStartDate: $('#incomeEffectiveStartInput').value, notes: $('#incomeNotesInput').value.trim() };
    const result = await callPost('saveBudgetIncome', payload);
    state.budgetIncome = (state.budgetIncome || []).filter((row) => row.id !== result.income.id).concat([normaliseBudgetIncomeV12(result.income)]);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    $('#incomeDialog').close(); renderAll(); showToast('Income schedule saved.');
  } catch (error) { showToast(error.message); }
}
async function deleteIncomeV14() {
  try {
    const id = $('#incomeIdInput').value;
    if (!id) return;
    await callPost('deleteBudgetIncome', { id });
    state.budgetIncome = (state.budgetIncome || []).filter((row) => row.id !== id);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    $('#incomeDialog').close(); renderAll(); showToast('Income schedule deleted.');
  } catch (error) { showToast(error.message); }
}

function renderSimpleBudgetsV12() {
  const list = $('#budgetBucketsList');
  if (!list) return;
  const month = getSelectedBudgetMonthV12();
  const forecast = calculateIncomeForecastV12(month);
  const lineItems = getPlannedExpensesForMonthV12(month).map((expense) => ({ ...expense, monthlyCalculatedAmount: calculatePlannedExpenseMonthlyAmountV12(expense, month) }));
  const totalPlanned = sum(lineItems.map((row) => row.monthlyCalculatedAmount));
  const remaining = forecast.net - totalPlanned;
  setTextV12('#budgetForecastGross', formatCurrency(forecast.gross));
  setTextV12('#budgetForecastNet', formatCurrency(forecast.net));
  setTextV12('#budgetTotalPlanned', formatCurrency(totalPlanned));
  setTextV12('#budgetRemainingIncome', formatCurrency(remaining));
  renderIncomeSummaryV12(month, forecast);
  renderBudgetLineAlertV14(forecast, totalPlanned);
  list.innerHTML = BUDGET_GROUPS_V13.map((group) => budgetLineGroupHtmlV14(group, lineItems, forecast)).join('');
  renderDraftIndicatorV13 && renderDraftIndicatorV13();
  wireBudgetLineItemsV14();
}
function renderBudgetLineAlertV14(forecast, totalPlanned) {
  const alert = $('#budgetAlert');
  if (!alert) return;
  const overIncome = totalPlanned - forecast.net;
  alert.hidden = overIncome <= 0;
  if (overIncome > 0) alert.textContent = `You have allocated ${formatCurrency(totalPlanned)} against ${formatCurrency(forecast.net)} available. You are over budget by ${formatCurrency(overIncome)}.`;
}
function budgetLineGroupHtmlV14(group, lineItems, forecast) {
  if (group.id === 'gross') return budgetGroupSectionHtmlV13(group, [], forecast);
  const rows = lineItems.filter((item) => normaliseGroupV13(item.budgetCategory || getExpenseGroupV13(item)) === group.id);
  const total = sum(rows.map((row) => row.monthlyCalculatedAmount));
  return `<section class="budget-group-section"><div class="budget-group-heading"><div><h4>${escapeHtml(group.title)}</h4><p>${escapeHtml(group.description)}</p></div><span class="budget-group-total">${formatCurrency(total)}</span></div>${rows.length ? rows.map(budgetLineItemHtmlV14).join('') : '<div class="empty-state">No budget line items in this category.</div>'}<button class="secondary-button add-budget-line-button" data-budget-category="${escapeHtml(group.id)}" type="button">Add Line Item</button></section>`;
}
function budgetLineItemHtmlV14(item) {
  const mode = item.allocationType === 'percentage' ? `${Number(item.amount || 0)}% of ${BUDGET_BASIS_LABELS_V12[item.allocationBasis] || item.allocationBasis}` : formatCurrency(item.amount);
  const modeClass = item.allocationType === 'percentage' ? 'percent' : '';
  const freq = item.frequency === 'weekly' ? `Weekly ${weekdayNameV12(item.dayOfWeek)}` : titleCase(item.frequency || 'monthly');
  return `<article class="budget-line-item-card clickable-card" data-edit-budget-line="${escapeHtml(item.id)}"><div class="budget-line-item-head"><div><h4>${escapeHtml(item.expenseName)}</h4><small>${escapeHtml(freq)} • ${escapeHtml(bucketNameById(item.bucketId))}</small></div><strong>${formatCurrency(item.monthlyCalculatedAmount)}</strong></div><div class="budget-line-meta"><span class="budget-line-pill ${modeClass}">${escapeHtml(mode)}</span><span class="budget-line-pill bucket">Bucket: ${escapeHtml(bucketNameById(item.bucketId))}</span>${item.requiresManualActual ? '<span class="budget-line-pill">Manual actual</span>' : ''}</div></article>`;
}
function wireBudgetLineItemsV14() {
  $$('.add-budget-line-button').forEach((button) => button.addEventListener('click', () => openPlannedExpenseDialogV14('', button.dataset.budgetCategory)));
  $$('[data-edit-budget-line]').forEach((button) => button.addEventListener('click', () => openPlannedExpenseDialogV14(button.dataset.editBudgetLine)));
}
function openPlannedExpenseDialogV14(expenseId, groupId) {
  const expense = (state.budgetPlannedExpenses || []).find((row) => row.id === expenseId);
  $('#plannedExpenseIdInput').value = expense ? expense.id : '';
  $('#plannedExpenseNameInput').value = expense ? expense.expenseName : '';
  $('#plannedExpenseBudgetCategoryInput').value = expense ? (expense.budgetCategory || getExpenseGroupV13(expense)) : (groupId || 'other');
  populatePlannedExpenseBucketSelectV12(expense ? expense.bucketId : '');
  $('#plannedExpenseFrequencyInput').value = expense ? expense.frequency : 'monthly';
  $('#plannedExpenseDayOfWeekInput').value = expense ? expense.dayOfWeek : '';
  $('#plannedExpenseAmountInput').value = expense ? Number(expense.amount || 0) : '';
  $('#plannedExpenseBasisInput').value = expense ? (expense.allocationBasis || 'net_income') : 'net_income';
  setAllocationTypeV14(expense ? (expense.allocationType || 'fixed') : 'fixed');
  $('#plannedExpenseStartDateInput').value = expense ? expense.startDate : `${getSelectedBudgetMonthV12()}-01`;
  $('#plannedExpenseAutoGenerateInput').checked = expense ? expense.autoGenerateTransaction : true;
  $('#plannedExpenseManualActualInput').checked = expense ? expense.requiresManualActual : false;
  $('#plannedExpenseNotesInput').value = expense ? expense.notes : '';
  $('#plannedExpenseDialog').showModal();
}
function openPlannedExpenseDialogV12(bucketId, expenseId) { openPlannedExpenseDialogV14(expenseId, getBucketGroupV13(bucketId || 'other')); if (bucketId) $('#plannedExpenseBucketInput').value = bucketId; }
function setAllocationTypeV14(type) {
  $('#plannedExpenseAllocationTypeInput').value = type;
  $$('.allocation-type-button').forEach((button) => button.classList.toggle('active', button.dataset.allocationType === type));
  const basis = $('#plannedExpenseBasisWrap');
  if (basis) basis.hidden = type !== 'percentage';
}
async function submitPlannedExpenseV12(event) {
  event.preventDefault();
  try {
    const month = getSelectedBudgetMonthV12();
    const payload = { id: $('#plannedExpenseIdInput').value, budgetMonth: month, expenseName: $('#plannedExpenseNameInput').value.trim(), budgetCategory: $('#plannedExpenseBudgetCategoryInput').value, allocationType: $('#plannedExpenseAllocationTypeInput').value || 'fixed', allocationBasis: $('#plannedExpenseBasisInput').value, bucketId: $('#plannedExpenseBucketInput').value, frequency: $('#plannedExpenseFrequencyInput').value, dayOfWeek: $('#plannedExpenseDayOfWeekInput').value, amount: parseMoneyValue($('#plannedExpenseAmountInput').value), startDate: $('#plannedExpenseStartDateInput').value, autoGenerateTransaction: $('#plannedExpenseAutoGenerateInput').checked, requiresManualActual: $('#plannedExpenseManualActualInput').checked, notes: $('#plannedExpenseNotesInput').value.trim() };
    const result = await callPost('saveBudgetPlannedExpense', payload);
    state.budgetPlannedExpenses = (state.budgetPlannedExpenses || []).filter((row) => row.id !== result.expense.id).concat([normalisePlannedExpenseV12(result.expense)]);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    $('#plannedExpenseDialog').close(); renderAll(); showToast('Budget line item saved.');
  } catch (error) { showToast(error.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  const detailForm = $('#transactionDetailForm');
  if (detailForm) detailForm.addEventListener('submit', submitTransactionDetailV14);
  const detailMonth = $('#bucketDetailMonthFilter');
  if (detailMonth) detailMonth.addEventListener('change', renderBucketDetailV14);
  $$('[data-back-view]').forEach((button) => button.addEventListener('click', () => switchView(state.previousView || button.dataset.backView || 'dashboard')));
  const deleteIncome = $('#deleteIncomeButton');
  if (deleteIncome) deleteIncome.addEventListener('click', deleteIncomeV14);
  $$('.allocation-type-button').forEach((button) => button.addEventListener('click', () => setAllocationTypeV14(button.dataset.allocationType)));
});

// --- v15: delete from Transaction Detail and show bucket name in the app header ---
async function deleteTransactionDetailV15() {
  try {
    const id = $('#transactionDetailIdInput') ? $('#transactionDetailIdInput').value : state.selectedTransactionId;
    if (!id) return showToast('No transaction is selected.');
    const transaction = state.transactions.find((item) => item.id === id);
    const label = transaction ? (transaction.description || transaction.merchant || 'this transaction') : 'this transaction';
    const confirmed = window.confirm(`Delete ${label}? This will remove it from active views but keep the audit trail in Google Sheets.`);
    if (!confirmed) return;
    await callPost('deleteTransaction', { id });
    state.transactions = state.transactions.filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(getCacheShape()));
    renderAll();
    showToast('Transaction deleted.');
    switchView(state.previousView || 'transactions');
  } catch (error) {
    showToast(error.message);
  }
}

function openBucketDetailV14(bucketId) {
  state.previousView = state.activeView || 'buckets';
  state.selectedBucketId = bucketId;
  const monthFilter = $('#bucketDetailMonthFilter');
  const bucketMonth = $('#bucketMonthFilter');
  if (monthFilter && bucketMonth) {
    monthFilter.innerHTML = bucketMonth.innerHTML;
    monthFilter.value = bucketMonth.value || getSelectedBucketMonth();
  }
  renderBucketDetailV14();
  switchView('bucketDetail');
  const bucketName = bucketNameById(bucketId);
  if (elements.viewTitle) elements.viewTitle.textContent = bucketName;
  const title = $('#bucketDetailTitle');
  if (title) title.textContent = bucketName;
}

function renderBucketDetailV14() {
  const bucketId = state.selectedBucketId;
  const month = ($('#bucketDetailMonthFilter') && $('#bucketDetailMonthFilter').value) || getSelectedBucketMonth();
  const all = state.transactions.filter((txn) => effectiveBucketId(txn.bucketId || txn.accountId) === bucketId);
  const monthTxns = all.filter((txn) => transactionMonth(txn.transactionDate) === month);
  const balance = sum(all.map((txn) => Number(txn.amount || 0)));
  const bucketName = bucketNameById(bucketId);
  if ($('#bucketDetailTitle')) $('#bucketDetailTitle').textContent = bucketName;
  if (elements.viewTitle && state.activeView === 'bucketDetail') elements.viewTitle.textContent = bucketName;
  $('#bucketDetailSubtitle').textContent = `Recent activity for ${month}`;
  $('#bucketDetailBalance').textContent = formatCurrency(balance);
  $('#bucketDetailMonthChange').textContent = formatCurrency(monthChangeForBucketV14(bucketId, month));
  $('#bucketDetailFunded').textContent = formatCurrency(sum(monthTxns.filter((txn) => Number(txn.amount) > 0).map((txn) => Number(txn.amount))));
  $('#bucketDetailSpent').textContent = formatCurrency(sum(monthTxns.filter((txn) => Number(txn.amount) < 0).map((txn) => Math.abs(Number(txn.amount)))));
  const list = $('#bucketDetailTransactions');
  list.innerHTML = monthTxns.sort((a,b) => String(b.transactionDate).localeCompare(String(a.transactionDate))).map((txn) => `<article class="mobile-data-card clickable-card" data-open-transaction="${escapeHtml(txn.id)}"><div class="mobile-card-head"><strong>${escapeHtml(txn.description || txn.merchant || 'Transaction')}</strong><span class="${amountClass(txn.amount)}">${formatCurrency(txn.amount)}</span></div><div class="mobile-card-row"><span>Date</span><strong>${escapeHtml(txn.transactionDate)}</strong></div><div class="mobile-card-row"><span>Merchant</span><strong>${escapeHtml(txn.merchant || '—')}</strong></div></article>`).join('') || '<div class="empty-state">No transactions for this bucket in the selected month.</div>';
  wireDrilldownLinksV14();
}

document.addEventListener('DOMContentLoaded', () => {
  const deleteButton = $('#deleteTransactionButton');
  if (deleteButton) deleteButton.addEventListener('click', deleteTransactionDetailV15);
});

// --- v16 Home screen: spent vs budget by bucket ---
function renderCategoryBreakdown(txns) {
  const container = $('#categoryBreakdown');
  if (!container) return;
  const month = getSelectedBucketMonth();
  const rows = buildSpentVsBudgetRowsV16(month, txns);
  if (!rows.length) {
    container.className = 'spent-budget-list empty-state';
    container.textContent = 'No bucket spending or budget data for the selected month.';
    return;
  }
  container.className = 'spent-budget-list';
  container.innerHTML = rows.map(spentVsBudgetRowHtmlV16).join('');
  if (typeof wireDrilldownLinksV14 === 'function') wireDrilldownLinksV14();
}

function buildSpentVsBudgetRowsV16(month, txns) {
  const spendingByBucket = new Map();
  txns.filter((txn) => Number(txn.amount) < 0).forEach((txn) => {
    const bucketId = effectiveBucketId(txn.bucketId || txn.accountId);
    spendingByBucket.set(bucketId, (spendingByBucket.get(bucketId) || 0) + Math.abs(Number(txn.amount || 0)));
  });
  const bucketRows = activeBucketAccounts().map((account) => {
    const bucketId = effectiveBucketId(account.bucketId || account.id || account.name);
    const spent = roundCurrencyV12(spendingByBucket.get(bucketId) || 0);
    const budget = roundCurrencyV12(homeBudgetAmountForBucketV16(bucketId, month));
    const percent = budget > 0 ? Math.round((spent / budget) * 100) : (spent > 0 ? 999 : 0);
    return {
      bucketId,
      bucketName: account.name || bucketNameById(bucketId),
      spent,
      budget,
      remaining: roundCurrencyV12(budget - spent),
      percent,
      status: spentBudgetStatusV16(percent, budget, spent)
    };
  });
  return bucketRows
    .filter((row) => row.spent > 0 || row.budget > 0)
    .sort((a, b) => {
      const aRatio = a.budget > 0 ? a.spent / a.budget : (a.spent > 0 ? 999 : 0);
      const bRatio = b.budget > 0 ? b.spent / b.budget : (b.spent > 0 ? 999 : 0);
      return bRatio - aRatio || b.spent - a.spent || a.bucketName.localeCompare(b.bucketName);
    });
}

function homeBudgetAmountForBucketV16(bucketId, month) {
  const lineItems = getPlannedExpensesForMonthV16(month, bucketId);
  if (lineItems.length) {
    return sum(lineItems.map((item) => calculatePlannedExpenseMonthlyAmountV12(item, month)));
  }
  const directBudgets = getBudgetRowsForMonthV12(month).filter((budget) => effectiveBucketId(budget.bucketId || budget.categoryId) === bucketId);
  return sum(directBudgets.map((budget) => Number(budget.plannedAmount || budget.allocationValue || 0)));
}

function getPlannedExpensesForMonthV16(month, bucketId) {
  const rows = state.budgetPlannedExpenses || [];
  const exact = rows.filter((item) => normaliseMonthValue(item.budgetMonth) === month && (!bucketId || effectiveBucketId(item.bucketId) === bucketId));
  if (exact.length) return exact;
  const priorMonth = unique(rows.map((item) => normaliseMonthValue(item.budgetMonth)).filter((value) => value && value < month)).sort().pop();
  return priorMonth ? rows.filter((item) => normaliseMonthValue(item.budgetMonth) === priorMonth && (!bucketId || effectiveBucketId(item.bucketId) === bucketId)).map((item) => ({ ...item, budgetMonth: month })) : [];
}

function spentBudgetStatusV16(percent, budget, spent) {
  if (budget <= 0 && spent > 0) return { key: 'over', label: 'No budget set' };
  if (percent <= 50) return { key: 'low', label: 'Low spend' };
  if (percent <= 80) return { key: 'medium', label: 'On track' };
  if (percent <= 100) return { key: 'high', label: 'Near budget' };
  return { key: 'over', label: 'Over budget' };
}

function spentVsBudgetRowHtmlV16(row) {
  const width = row.budget > 0 ? Math.min(100, Math.max(2, row.percent)) : (row.spent > 0 ? 100 : 2);
  const percentLabel = row.budget > 0 ? `${row.percent}% used` : 'No budget';
  const remainingClass = row.remaining < 0 ? 'amount-negative' : 'amount-positive';
  const remainingText = row.budget > 0 ? `${row.remaining < 0 ? 'Over by' : 'Left'} ${formatCurrency(Math.abs(row.remaining))}` : 'Set a budget to compare';
  return `<button type="button" class="spent-budget-row clickable-card" data-open-bucket="${escapeHtml(row.bucketId)}">
    <div class="spent-budget-top">
      <div class="spent-budget-title"><strong>${escapeHtml(row.bucketName)}</strong><small>${escapeHtml(percentLabel)}</small></div>
      <div class="spent-budget-amounts"><span>${formatCurrency(row.spent)} spent</span><small>of ${row.budget > 0 ? formatCurrency(row.budget) : 'no budget'}</small></div>
    </div>
    <div class="spent-budget-track"><div class="spent-budget-fill ${row.status.key}" style="width:${width}%"></div></div>
    <div class="spent-budget-status"><span class="spent-budget-pill ${row.status.key}">${escapeHtml(row.status.label)}</span><span class="${remainingClass}">${escapeHtml(remainingText)}</span></div>
  </button>`;
}
