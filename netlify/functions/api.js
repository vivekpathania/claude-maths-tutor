// Netlify Function entry point — wraps the Express app as a Lambda handler.
// Env vars (MONGODB_URI, MONGODB_DB) must be set in Netlify site settings;
// `.env` is gitignored and never reaches the bundle. See docs/deploy.md.
const serverless = require('serverless-http');
const app = require('../../app');

// netlify.toml rewrites  /api/*  →  /.netlify/functions/api/:splat , so by the
// time the function runs, the leading "/api" has been replaced by the function
// path — and every route in app.js is registered under "/api". Left alone,
// Express matches nothing and the whole API 404s.
//
// Which path the function actually receives varies by Netlify version (some
// pass the original request path through a 200-rewrite, some pass the
// rewritten one), so put "/api" back only when the function prefix is there
// and leave an already-correct path untouched. Both cases then route the same.
const FN_PREFIX = '/.netlify/functions/api';

function toAppPath(url) {
  if (!url || !url.startsWith(FN_PREFIX)) return url;
  const rest = url.slice(FN_PREFIX.length); // "/sessions/next?childId=x" | ""
  if (!rest) return '/api';
  return '/api' + (rest.startsWith('/') ? rest : '/' + rest);
}

module.exports.handler = serverless(app, {
  // A recording is binary. Without this Lambda would return the bytes as text and
  // corrupt them; listed types are base64-encoded for the trip instead.
  binary: ['audio/mp4'],
  request(req) {
    req.url = toAppPath(req.url);
  }
});
