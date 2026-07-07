// Vercel serverless entry — the whole Express app runs as one function.
// Static assets are served by Vercel from dist/public; this handles /api/*,
// /terms and /privacy (see vercel.json rewrites).
import app from '../src/server/index'
export default app
