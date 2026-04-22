<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3d846a6e-0a91-40b6-bbf0-97f1f019da03

## Run Locally

**Prerequisites:** Node.js

### Frontend
1. Install dependencies:
   `npm install`
2. Start frontend:
   `npm run dev`
3. Visit:
   `http://localhost:3000`

### Backend
1. Create `server/.env` based on `server/.env.example`
2. Set `GEMINI_API_KEY`
3. Start backend:
   `npm run server:dev`
4. Health check:
   `http://localhost:8787/api/health`

### Notes
- Frontend proxies `/api` requests to `http://localhost:8787`
- SQLite database defaults to `server/data/admissions.db`
- If AI features fail, first check `GEMINI_API_KEY` and whether the backend is running
