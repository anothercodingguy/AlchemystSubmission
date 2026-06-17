# Agent Console

Frontend console for the Alchemyst AI Agent system.

## Setup & Running

### 1. Start the Backend
```bash
cd agent-server
docker build -t agent-server .
docker run -p 4747:4747 agent-server
```
*(To run in chaos mode: `docker run -p 4747:4747 agent-server --mode chaos`)*

### 2. Start the Frontend
```bash
cd agent-console-app
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## Running Tests
```bash
cd agent-console-app
npm test
```

## Tech Stack
- Next.js 14 (App Router)
- TypeScript
- Zustand
- CSS Modules
- Jest
