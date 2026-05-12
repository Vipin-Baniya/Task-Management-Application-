# Task Management Application

A fast, stylish task management web app that works in two modes:
- **API mode (localhost)**: uses the Node backend
- **GitHub Pages mode**: uses instant localStorage data, no backend required

## Features
- User registration/login and authorization
- Task CRUD (create, read, update, delete)
- Responsive and modern UI for mobile and desktop
- GitHub Pages hosting support via workflow

## Run locally (API mode)
```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Run tests
```bash
npm test
```

## Host on GitHub Pages
1. Push to `main` or `master`
2. Enable **GitHub Pages** in repository settings (Source: GitHub Actions)
3. Workflow `Deploy static app to GitHub Pages` publishes `public/`

When opened on GitHub Pages, the app automatically switches to local mode.
