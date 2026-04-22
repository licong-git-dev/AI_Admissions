# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build (outputs to dist/)
npm run lint         # TypeScript type check only (tsc --noEmit), no test suite
npm run preview      # Serve the production build locally
```

Environment setup: copy `.env.example` to `.env` and set `GEMINI_API_KEY`.

## Architecture

This is a React + Vite + TypeScript frontend application plus a lightweight Express + SQLite backend under `server/`. The project is transitioning from mock-driven prototype to a minimal usable system. Core lead, follow-up, AI proxy, and dashboard summary flows now have backend support. `GEMINI_API_KEY` should be configured on the backend only and must not be injected into frontend client code.

### Routing

There is no React Router. Navigation is pure tab-based state in `App.tsx` (`activeTab` string). Each tab value maps to a lazy-loaded route component wrapped in `React.lazy` + `Suspense`. The tab IDs are defined in `src/constants.ts` → `NAV_ITEMS`.

### Key source files

| File | Role |
|---|---|
| `src/App.tsx` | Root shell: sidebar, header, and tab routing. Dashboard charts (recharts) are inline here. |
| `src/constants.ts` | `NAV_ITEMS`, `INTENT_COLORS`, `STATUS_LABELS`, and all `AI_PROMPTS` (the Gemini prompt templates). |
| `src/types.ts` | All TypeScript interfaces and union types. Single source of truth — no local type re-declarations in components. |
| `src/gemini-services.ts` | All Gemini API calls. Three exports: `generateContent`, `analyzeIntent`, `recommendScripts`. Model is `gemini-2.5-flash-preview-04-17` with `responseMimeType: "application/json"`. |
| `src/mock/index.ts` | All mock data arrays (`MOCK_LEADS`, `MOCK_STUDENTS`, `MOCK_PAYMENTS`, `MOCK_COURSES`, `MOCK_ATTENDANCE`, `MOCK_CHATS`, `MOCK_MESSAGES`). Import from here — never re-declare mock data inside components. |
| `src/components/` | Eight route-level components, one per tab. |

### AI integration pattern

Every component that calls the Gemini API follows this pattern:
1. `loading` state set to `true`, previous AI result cleared
2. Call the relevant function from `gemini-services.ts` (never call `GoogleGenAI` directly in components)
3. On success: set the result state
4. On catch: call `showError(msg)` — a local helper that sets `errorMsg` state (auto-clears after 4 s) and falls back to hardcoded defaults so the UI stays functional
5. `finally`: set `loading` to `false`

### Styling conventions

- TailwindCSS v4 via `@tailwindcss/vite` plugin (no `tailwind.config.js`)
- `cn()` utility is in `src/lib/cn.ts` — import it as `import { cn } from '../lib/cn'` (or `'./lib/cn'` from App.tsx). Do **not** redeclare it locally in components.
- Primary accent color: `emerald-500` / `emerald-600`
- Animations: `framer-motion` (`AnimatePresence` + `motion.div`) for route transitions and slide-over panels

### Adding a new route/tab

1. Create `src/components/MyTab.tsx`
2. Add entry to `NAV_ITEMS` in `src/constants.ts`
3. Add `const MyTab = lazy(() => import('./components/MyTab'))` in `App.tsx`
4. Add a `{activeTab === 'mytab' && <motion.div>…<MyTab /></motion.div>}` block inside the `AnimatePresence` in `App.tsx`

### Adding a new Gemini AI feature

1. Add the prompt template function to `AI_PROMPTS` in `src/constants.ts`
2. Add the typed interface for the response to `src/types.ts`
3. Add the async service function to `src/gemini-services.ts` using the prompt and returning the typed interface
4. Call the service function from the component following the AI integration pattern above
