const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const authForm = document.getElementById('auth-form');
const taskForm = document.getElementById('task-form');
const taskList = document.getElementById('task-list');
const message = document.getElementById('message');
const welcome = document.getElementById('welcome');
const logoutButton = document.getElementById('logout');
const modeBadge = document.getElementById('mode-badge');
const filterStatus = document.getElementById('filter-status');

const tokenKey = 'task-manager-token';
const userKey = 'task-manager-user';
const modeKey = 'task-manager-mode';
const localDbKey = 'task-manager-local-db';

let submitMode = 'login';
let currentTasks = [];

function getRuntimeMode() {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('mode');
  if (forced === 'api' || forced === 'local') return forced;

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'api';
  }

  return 'local';
}

function getMode() {
  return localStorage.getItem(modeKey) || getRuntimeMode();
}

function setMode(mode) {
  localStorage.setItem(modeKey, mode);
  modeBadge.textContent = mode === 'api' ? 'API mode' : 'GitHub Pages mode';
}

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setSession(token, user) {
  localStorage.setItem(tokenKey, token);
  localStorage.setItem(userKey, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userKey);
}

function showMessage(text, isError = true) {
  message.style.color = isError ? '#fecaca' : '#dcfce7';
  message.textContent = text;
}

function generateToken() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashLocalPassword(password) {
  if (window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(password);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return btoa(unescape(encodeURIComponent(password)));
}

function loadLocalDb() {
  const raw = localStorage.getItem(localDbKey);
  if (!raw) {
    return { users: [], tasksByUserId: {}, nextUserId: 1, nextTaskId: 1 };
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { users: [], tasksByUserId: {}, nextUserId: 1, nextTaskId: 1 };
  }
}

function saveLocalDb(db) {
  localStorage.setItem(localDbKey, JSON.stringify(db));
}

function normalizeDueDate(value) {
  return typeof value === 'string' ? value : '';
}

function mapUserView(user) {
  return { id: user.id, username: user.username };
}

async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

function localAuthFromToken(db, token) {
  return db.users.find((user) => user.token === token) || null;
}

async function localRequest(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  const token = getToken();
  const db = loadLocalDb();

  if (path === '/api/register' && method === 'POST') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const passwordHash = await hashLocalPassword(password);

    if (!username || password.length < 6) throw new Error('Username and password (min 6 chars) are required.');
    if (db.users.some((user) => user.username === username)) throw new Error('Username already exists.');

    const user = { id: db.nextUserId++, username, passwordHash, token: generateToken() };
    db.users.push(user);
    db.tasksByUserId[user.id] = [];
    saveLocalDb(db);

    return { token: user.token, user: mapUserView(user) };
  }

  if (path === '/api/login' && method === 'POST') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const passwordHash = await hashLocalPassword(password);
    const user = db.users.find(
      (candidate) => candidate.username === username && candidate.passwordHash === passwordHash,
    );
    if (!user) throw new Error('Invalid credentials.');

    user.token = generateToken();
    saveLocalDb(db);
    return { token: user.token, user: mapUserView(user) };
  }

  const authUser = localAuthFromToken(db, token);
  if (!authUser) throw new Error('Unauthorized');

  if (path === '/api/me' && method === 'GET') {
    return { user: mapUserView(authUser) };
  }

  if (path === '/api/tasks' && method === 'GET') {
    return { tasks: db.tasksByUserId[authUser.id] || [] };
  }

  if (path === '/api/tasks' && method === 'POST') {
    const title = String(body.title || '').trim();
    if (!title) throw new Error('Title is required.');

    const task = {
      id: db.nextTaskId++,
      title,
      description: String(body.description || '').trim(),
      status: body.status === 'done' ? 'done' : 'todo',
      dueDate: normalizeDueDate(body.dueDate),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.tasksByUserId[authUser.id] = [task, ...(db.tasksByUserId[authUser.id] || [])];
    saveLocalDb(db);
    return { task };
  }

  const match = path.match(/^\/api\/tasks\/(\d+)$/);
  if (match) {
    const taskId = Number(match[1]);
    const tasks = db.tasksByUserId[authUser.id] || [];
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) throw new Error('Task not found.');

    if (method === 'PUT') {
      const current = tasks[index];
      const updated = {
        ...current,
        title: body.title !== undefined ? String(body.title).trim() : current.title,
        description: body.description !== undefined ? String(body.description).trim() : current.description,
        status: body.status === 'done' || body.status === 'todo' ? body.status : current.status,
        dueDate: body.dueDate !== undefined ? normalizeDueDate(body.dueDate) : current.dueDate,
        updatedAt: new Date().toISOString(),
      };
      if (!updated.title) throw new Error('Title is required.');
      tasks[index] = updated;
      saveLocalDb(db);
      return { task: updated };
    }

    if (method === 'DELETE') {
      tasks.splice(index, 1);
      saveLocalDb(db);
      return {};
    }
  }

  throw new Error('Route not found');
}

async function request(path, options = {}) {
  const mode = getMode();
  if (mode === 'local') {
    return localRequest(path, options);
  }

  try {
    return await apiRequest(path, options);
  } catch (error) {
    if (String(error.message).toLowerCase().includes('failed to fetch')) {
      setMode('local');
      return localRequest(path, options);
    }
    throw error;
  }
}

function createTaskNode(task) {
  const item = document.createElement('li');
  item.className = `task-item ${task.status}`;

  const title = document.createElement('h3');
  title.className = 'task-title';
  title.textContent = task.title;

  const description = document.createElement('p');
  description.className = 'muted';
  description.textContent = task.description || 'No description';

  const meta = document.createElement('p');
  meta.className = 'task-meta';
  meta.textContent = `Due: ${task.dueDate || 'Not set'} • ${task.status === 'done' ? 'Done' : 'To Do'}`;

  const actions = document.createElement('div');
  actions.className = 'row';

  const toggle = document.createElement('button');
  toggle.dataset.action = 'toggle';
  toggle.dataset.id = String(task.id);
  toggle.textContent = task.status === 'done' ? 'Mark as To Do' : 'Mark as Done';

  const remove = document.createElement('button');
  remove.dataset.action = 'delete';
  remove.dataset.id = String(task.id);
  remove.className = 'secondary';
  remove.textContent = 'Delete';

  actions.append(toggle, remove);
  item.append(title, description, meta, actions);
  return item;
}

function renderTasks(tasks) {
  currentTasks = tasks;
  const selectedFilter = filterStatus.value;
  const visibleTasks = selectedFilter === 'all' ? tasks : tasks.filter((task) => task.status === selectedFilter);

  taskList.innerHTML = '';
  if (!visibleTasks.length) {
    const empty = document.createElement('li');
    empty.className = 'task-item';
    empty.textContent = 'No matching tasks yet. Add one above.';
    taskList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleTasks.forEach((task) => {
    fragment.appendChild(createTaskNode(task));
  });
  taskList.appendChild(fragment);
}

async function loadTasks() {
  const { tasks } = await request('/api/tasks');
  renderTasks(tasks);
}

function setView(isAuthenticated) {
  authSection.classList.toggle('hidden', isAuthenticated);
  appSection.classList.toggle('hidden', !isAuthenticated);

  if (isAuthenticated) {
    const user = JSON.parse(localStorage.getItem(userKey) || '{}');
    welcome.textContent = `Welcome, ${user.username || 'User'}`;
  }
}

authForm.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  submitMode = button.dataset.mode;
});

filterStatus.addEventListener('change', () => {
  renderTasks(currentTasks);
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const data = await request(`/api/${submitMode}`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setSession(data.token, data.user);
    setView(true);
    await loadTasks();
    showMessage(`${submitMode === 'register' ? 'Registered' : 'Logged in'} successfully.`, false);
    authForm.reset();
  } catch (error) {
    showMessage(error.message);
  }
});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = document.getElementById('task-title').value;
  const description = document.getElementById('task-description').value;
  const dueDate = document.getElementById('task-due-date').value;
  const status = document.getElementById('task-status').value;

  try {
    await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, dueDate, status }),
    });
    taskForm.reset();
    await loadTasks();
    showMessage('Task added.', false);
  } catch (error) {
    showMessage(error.message);
  }
});

taskList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const taskId = button.dataset.id;
  const action = button.dataset.action;

  try {
    if (action === 'delete') {
      await request(`/api/tasks/${taskId}`, { method: 'DELETE' });
    }

    if (action === 'toggle') {
      const task = currentTasks.find((t) => String(t.id) === String(taskId));
      if (!task) throw new Error('Task not found');

      await request(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: task.status === 'done' ? 'todo' : 'done' }),
      });
    }

    await loadTasks();
    showMessage('Task updated.', false);
  } catch (error) {
    showMessage(error.message);
  }
});

logoutButton.addEventListener('click', () => {
  clearSession();
  setView(false);
  taskList.innerHTML = '';
  showMessage('Logged out.', false);
});

(async function init() {
  setMode(getMode());

  const token = getToken();
  if (!token) {
    setView(false);
    return;
  }

  try {
    const data = await request('/api/me');
    setSession(token, data.user);
    setView(true);
    await loadTasks();
  } catch {
    clearSession();
    setView(false);
  }
})();
