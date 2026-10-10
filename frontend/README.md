# Website

React + TypeScript + Tailwind. Shows the trial scoping brief from the backend API.

Run in development (backend running on :8000 in another terminal):

    npm install
    npm run dev

Open the printed URL. Add `?mock&rs=rs113488022` to view the bundled BRAF sample without the backend.

Build for production (`npm run build`) writes `dist/`, which the FastAPI backend serves at `/`.
