const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, createStore } = require('../server');

async function startServer() {
  const app = createApp(createStore());
  await new Promise((resolve) => app.listen(0, resolve));
  const address = app.address();

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}

async function request(baseUrl, path, options = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return { status: res.status, body };
}

test('register/login and task CRUD are protected and user-scoped', async () => {
  const server = await startServer();

  try {
    const register = await request(server.baseUrl, '/api/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'password123' }),
    });
    assert.equal(register.status, 201);
    assert.ok(register.body.token);

    const unauthorized = await request(server.baseUrl, '/api/tasks');
    assert.equal(unauthorized.status, 401);

    const createTask = await request(
      server.baseUrl,
      '/api/tasks',
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Write tests', description: 'For task app' }),
      },
      register.body.token,
    );
    assert.equal(createTask.status, 201);
    assert.equal(createTask.body.task.title, 'Write tests');

    const list = await request(server.baseUrl, '/api/tasks', {}, register.body.token);
    assert.equal(list.status, 200);
    assert.equal(list.body.tasks.length, 1);

    const update = await request(
      server.baseUrl,
      `/api/tasks/${createTask.body.task.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ status: 'done' }),
      },
      register.body.token,
    );
    assert.equal(update.status, 200);
    assert.equal(update.body.task.status, 'done');

    const bob = await request(server.baseUrl, '/api/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', password: 'password123' }),
    });

    const bobList = await request(server.baseUrl, '/api/tasks', {}, bob.body.token);
    assert.equal(bobList.status, 200);
    assert.equal(bobList.body.tasks.length, 0);

    const deletion = await request(
      server.baseUrl,
      `/api/tasks/${createTask.body.task.id}`,
      { method: 'DELETE' },
      register.body.token,
    );
    assert.equal(deletion.status, 204);
  } finally {
    await server.close();
  }
});
