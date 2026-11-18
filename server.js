// server.js — local dev entry point only. Not deployed.
// All app logic lives in app.js; this just starts the HTTP server.
require('dotenv').config();
// Keys are for prod only (the Netlify function never loads this file). Opt in locally with TUTOR_AUTH=on.
if (process.env.TUTOR_AUTH !== 'on') process.env.TUTOR_AUTH = 'off';
const app = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Maths tutor running at http://localhost:${PORT}`);
  console.log(`Database: ${process.env.MONGODB_DB || 'maths-tutor'}`);
});
