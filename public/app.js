const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const authForm = document.getElementById('auth-form');
const taskForm = document.getElementById('task-form');
const taskList = document.getElementById('task-list');
const message = document.getElementById('message');
const welcome = document.getElementById('welcome');
const logoutButton = document.getElementById('logout');

const tokenKey = 'task-manager-token';
const userKey = 'task-manager-user';
let submitMode = 'login';
let currentTasks = [];

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
  message.style.color = isError ? '#b91c1c' : '#166534';
  message.textContent = text;
}

async function api(path, options = {}) {
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

function renderTasks(tasks) {
  currentTasks = tasks;
  taskList.innerHTML = '';

  if (!tasks.length) {
    taskList.innerHTML = '<li class="task-item">No tasks yet. Add one above.</li>';
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement('li');
    item.className = `task-item ${task.status}`;
    item.innerHTML = `
      <strong>${task.title}</strong>
      <span>${task.description || 'No description'}</span>
      <small>Due: ${task.dueDate || 'Not set'}</small>
      <div class="row">
        <button data-action="toggle" data-id="${task.id}">${task.status === 'done' ? 'Mark as To Do' : 'Mark as Done'}</button>
        <button data-action="delete" data-id="${task.id}" class="secondary">Delete</button>
      </div>
    `;
    taskList.appendChild(item);
  });
}

async function loadTasks() {
  const { tasks } = await api('/api/tasks');
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

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const data = await api(`/api/${submitMode}`, {
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

  try {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, dueDate }),
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
      await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
    }

    if (action === 'toggle') {
      const task = currentTasks.find((currentTask) => String(currentTask.id) === String(taskId));
      if (!task) throw new Error('Task not found');

      await api(`/api/tasks/${taskId}`, {
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
  const token = getToken();
  if (!token) {
    setView(false);
    return;
  }

  try {
    const data = await api('/api/me');
    setSession(token, data.user);
    setView(true);
    await loadTasks();
  } catch {
    clearSession();
    setView(false);
  }
})();
