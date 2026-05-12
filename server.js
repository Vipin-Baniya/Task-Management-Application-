const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PUBLIC_DIR = path.join(__dirname, 'public');
if (process.env.NODE_ENV === 'production' && !process.env.APP_SECRET) {
  throw new Error('APP_SECRET must be set in production.');
}
const SECRET = process.env.APP_SECRET || 'dev-secret-change-me';

function createStore() {
  return {
    usersByName: new Map(),
    tasksByUserId: new Map(),
    nextUserId: 1,
    nextTaskId: 1,
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const targetPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, targetPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function getAuthUser(req, store) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;

  const payload = verifyToken(token);
  if (!payload || typeof payload.userId !== 'number') return null;

  for (const user of store.usersByName.values()) {
    if (user.id === payload.userId) {
      return { id: user.id, username: user.username };
    }
  }
  return null;
}

function createApp(customStore) {
  const store = customStore || createStore();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      try {
        if (pathname === '/api/register' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const username = typeof body.username === 'string' ? body.username.trim() : '';
          const password = typeof body.password === 'string' ? body.password : '';

          if (!username || password.length < 6) {
            sendJson(res, 400, { error: 'Username and password (min 6 chars) are required.' });
            return;
          }

          if (store.usersByName.has(username)) {
            sendJson(res, 409, { error: 'Username already exists.' });
            return;
          }

          const passwordData = hashPassword(password);
          const newUser = {
            id: store.nextUserId++,
            username,
            ...passwordData,
          };
          store.usersByName.set(username, newUser);
          store.tasksByUserId.set(newUser.id, []);

          const token = signToken({ userId: newUser.id, username: newUser.username });
          sendJson(res, 201, { token, user: { id: newUser.id, username: newUser.username } });
          return;
        }

        if (pathname === '/api/login' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const username = typeof body.username === 'string' ? body.username.trim() : '';
          const password = typeof body.password === 'string' ? body.password : '';

          const user = store.usersByName.get(username);
          if (!user) {
            sendJson(res, 401, { error: 'Invalid credentials.' });
            return;
          }

          const { hash } = hashPassword(password, user.salt);
          if (hash !== user.hash) {
            sendJson(res, 401, { error: 'Invalid credentials.' });
            return;
          }

          const token = signToken({ userId: user.id, username: user.username });
          sendJson(res, 200, { token, user: { id: user.id, username: user.username } });
          return;
        }

        const authUser = getAuthUser(req, store);
        if (!authUser) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        if (pathname === '/api/me' && req.method === 'GET') {
          sendJson(res, 200, { user: authUser });
          return;
        }

        if (pathname === '/api/tasks' && req.method === 'GET') {
          const tasks = store.tasksByUserId.get(authUser.id) || [];
          sendJson(res, 200, { tasks });
          return;
        }

        if (pathname === '/api/tasks' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const description = typeof body.description === 'string' ? body.description.trim() : '';
          const status = body.status === 'done' ? 'done' : 'todo';
          const dueDate = typeof body.dueDate === 'string' ? body.dueDate : '';

          if (!title) {
            sendJson(res, 400, { error: 'Title is required.' });
            return;
          }

          const tasks = store.tasksByUserId.get(authUser.id) || [];
          const task = {
            id: store.nextTaskId++,
            title,
            description,
            status,
            dueDate,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          tasks.unshift(task);
          store.tasksByUserId.set(authUser.id, tasks);
          sendJson(res, 201, { task });
          return;
        }

        const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
        if (taskMatch) {
          const taskId = Number(taskMatch[1]);
          const tasks = store.tasksByUserId.get(authUser.id) || [];
          const index = tasks.findIndex((task) => task.id === taskId);

          if (index === -1) {
            sendJson(res, 404, { error: 'Task not found.' });
            return;
          }

          if (req.method === 'PUT') {
            const body = await readJsonBody(req);
            const existing = tasks[index];
            const title = typeof body.title === 'string' ? body.title.trim() : existing.title;

            if (!title) {
              sendJson(res, 400, { error: 'Title is required.' });
              return;
            }

            const updated = {
              ...existing,
              title,
              description:
                typeof body.description === 'string' ? body.description.trim() : existing.description,
              status: body.status === 'done' ? 'done' : body.status === 'todo' ? 'todo' : existing.status,
              dueDate: typeof body.dueDate === 'string' ? body.dueDate : existing.dueDate,
              updatedAt: new Date().toISOString(),
            };
            tasks[index] = updated;
            sendJson(res, 200, { task: updated });
            return;
          }

          if (req.method === 'DELETE') {
            tasks.splice(index, 1);
            res.writeHead(204);
            res.end();
            return;
          }
        }

        sendJson(res, 404, { error: 'Route not found' });
      } catch (error) {
        const status = error.message === 'Payload too large' ? 413 : 400;
        sendJson(res, status, { error: error.message || 'Bad request' });
      }
      return;
    }

    serveStatic(req, res, pathname);
  });
}

if (require.main === module) {
  const server = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Task management app running at http://localhost:${port}`);
  });
}

module.exports = { createApp, createStore };
