// The only valid session-length choices — a ceiling the grader spends
// against, not a number of questions. Shared by save-curriculum.js (setup)
// and app.js (the dashboard's later-change endpoint) so the two can never
// drift apart.
module.exports = { SESSION_MINUTES: [15, 30, 45, 60] };
