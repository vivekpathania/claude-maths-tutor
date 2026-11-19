/* ollie-lines.js — Coach Ollie's line bank: the single voice on the child's
 * page. See docs/mascot.md §1 for why she is the only speaker, and §6 for the
 * voice standard every line here must follow.
 *
 * Loaded two ways, same file, same pattern as session-shape.js:
 *   browser — <script src="/ollie-lines.js"></script>  → window.OllieLines
 *   node    — require('../public/ollie-lines.js')      → module.exports
 *
 * This is chrome: reviewed-once repo content that says nothing about the
 * maths. The actual teaching (slip.say, hints, a lesson's walkthrough) is
 * authored per session and handed to Ollie to deliver — never written here.
 * See docs/mascot.md §1 "Two sources of her words".
 *
 * ---------------------------------------------------------------------------
 * VOICE FOR THE NEW UI
 * Ollie is now a large character with a speech bubble, so her lines carry
 * more of the screen. Every line should:
 *   - sound warm and a little playful, like a friendly coach, not a system;
 *   - praise effort and strategy, never "clever" or "easy";
 *   - never say "wrong", never sound disappointed, never imply "nearly"
 *     (the child may be far off);
 *   - be one or two short sentences, readable aloud in a few seconds;
 *   - use British English (practise as a verb, "maths", "No bother").
 *
 * MOMENTS ADDED FOR THE NEW SCREENS
 *   start                 session start screen ("Ready for today?")
 *   feedback.item         moving to the next look-back item
 *   feedback.done         all look-back items seen
 *   teach.tryIt           end of a teaching step, handing over to the child
 *   showme.start          "Show me how" walkthrough begins
 *   showme.yourTurn       walkthrough done; child now types it themselves
 *   clue.first            first clue shown
 *   clue.last             final clue shown
 *   lastQuestion          before the final question
 *   celebrate             a star or reward has just been earned
 *   idle                  no input for a while (caller decides the timeout)
 *   break.start           child pressed "Take a break"
 *   break.resume          child came back from a break
 * Teaching falls back to practice for the flow moments it doesn't define
 * (clue.*, showme.*, lastQuestion, celebrate, idle, break.*), so they are
 * written once, in practice.
 *
 * CLUES
 * clue.* and wrong.again lines say where the clue is (under the answer box).
 * The clue text itself is authored per question and appended by the caller,
 * so Ollie reads it aloud and the bubble matches what she says.
 *
 * MOODS
 * mood(register, moment) returns which Ollie SVG to show next to the line:
 * 'wave' | 'think' | 'point' | 'cheer' | 'neutral'.
 *
 * NAMES
 * Lines containing {name} are only dealt when pick() is given ctx.name.
 * Without a name, the picker draws from that moment's name-free lines, so
 * callers never have to filter. Assessment lines never contain {name}.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OllieLines = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // register → moment → [line, line, ...]
  // Every line is a plain headline string. Where a moment's authored content
  // (a slip's say, a hint, the close line) belongs alongside it, the caller
  // attaches that separately — a bank line never has a slot to fill, except
  // {name} (see NAMES above).
  var BANK = {

    teaching: {
      start: [
        "Hi {name}! Here's our plan for today.",
        "Hello, {name}! A quick look back, something new, then some practice.",
        "Here's today's plan. I think you're going to like it!",
        "Three steps today, and I'll be with you for every one."
      ],
      open: [
        "Ready for something new? Let's work it out together!",
        "Hi {name}! New idea today. I'll show you, then you try.",
        "Thinking caps on! We'll take it one step at a time.",
        "Let's figure this one out together."
      ],
      returning: [
        "Welcome back, {name}! We stopped right here.",
        "You're back! Let's carry on from where we left off.",
        "Hello again! I saved your spot. Let's keep going."
      ],
      feedback: [
        "Before we start, let's look back at last time.",
        "Hi {name}! First, a quick look at last time.",
        "Lots of people mix these up at first. Let's look back together."
      ],
      "feedback.item": [
        "Here's the next one from last time.",
        "Next one. Have a look at the boxes with me.",
        "One more thing to remember from last time."
      ],
      "feedback.done": [
        "That's last time sorted. Now for something new!",
        "Great memory! Those will feel much easier today.",
        "All caught up, {name}! Let's learn something new."
      ],
      warmup: [
        "Let's warm up with a couple you already know.",
        "Warm-up time! You've done these before.",
        "A couple of familiar ones first, to get your brain going."
      ],
      transition: [
        "Warm-up done! Now for the new idea.",
        "Brain warmed up. Let's learn something new!",
        "Nice start. Let's build on that."
      ],
      "teach.step.first": [
        "Here's the big idea. Stick with me!",
        "Let's start with the idea, then I'll show you.",
        "Watch this bit closely. It's the key to the whole thing."
      ],
      "teach.step.mid": [
        "Here's the next bit.",
        "Now let's add to that.",
        "You've got the first part. Here's some more."
      ],
      "teach.step.last": [
        "Last step, then it's your turn!",
        "One more bit, then you try one.",
        "Nearly there. One last idea, then over to you."
      ],
      "teach.tryIt": [
        "Your turn! Have a go at one.",
        "Over to you. Use what we just looked at.",
        "Now you try one. I'm right here if you need me."
      ],
      fresh: [
        "Take your time. Have a good look first.",
        "Read it through, then give it your best shot.",
        "Have a think, then try it. Every try teaches you something.",
        "No rush. Give it a go when you're ready."
      ],
      hintNote: [
        "Have a go first. If you get stuck, I've got a clue ready.",
        "Try it your way first. Clues open after your first try.",
        "Give it your best guess. I'll help if you need it."
      ],
      "wrong.first": [
        "Not yet! Have another look.",
        "Good try! Give it one more go.",
        "Not this time. Try again, you can do it.",
        "Hmm, not quite. Take another look."
      ],
      "wrong.again": [
        "Good try! I've put a clue under your answer.",
        "Let's narrow it down together. There's a clue under your answer.",
        "Good thinking to try again! Here's a little clue, just under your answer.",
        "Let's look at it a different way. Your clue is under your answer."
      ],
      "wrong.stuck": [
        "This one's tricky! Let's build it together, step by step.",
        "Let me show you how it works. Then you have a go.",
        "Tricky ones help your brain grow. Let me show you how."
      ],
      revealed: [
        "There it is. Well done for sticking with it.",
        "No worries. Now you've seen how it goes.",
        "That's how it works. You'll be ready for the next one!"
      ],
      "right.first": [
        "Yes! That's exactly it.",
        "First try! Brilliant.",
        "Spot on!",
        "You nailed it!",
        "Straight away! Lovely work.",
        "Hoot hoot! That's right!"
      ],
      "right.recovered": [
        "You got there! Sticking with it is the hard part.",
        "Yes! Second goes are where the learning happens.",
        "There it is! You worked it out.",
        "Got it! Trying again really paid off, {name}."
      ],
      comeback: [
        "Yes! You bounced right back.",
        "See that? Right after a tricky one. That's real learning.",
        "What a comeback, {name}!"
      ],
      streak: [
        "Three in a row! You're getting the hang of this.",
        "You're on a roll, {name}!",
        "Another one! Keep it going."
      ],
      halfway: [
        "Halfway there! Great going.",
        "That's half done. You're doing really well."
      ],
      nothingQueued: [
        "All caught up! Your next session isn't ready yet.",
        "Nothing new just yet. Check back soon!"
      ],
      close: [
        "That's today done! Brilliant work, {name}.",
        "All done! You stuck with the tricky bits, and that's what counts.",
        "Great session! See you next time.",
        "Finished! Your brain worked hard today."
      ]
    },

    practice: {
      start: [
        "Hi {name}! Here's today's plan.",
        "Practice time! Here's what's coming up.",
        "Ready? Here's the plan for today."
      ],
      open: [
        "Ready for some practice? Let's go!",
        "Let's see what you can do today, {name}.",
        "Practice time. Take each one as it comes."
      ],
      returning: [
        "Welcome back, {name}! Let's pick up where we left off.",
        "You're back! Your spot is saved."
      ],
      feedback: [
        "Quick look back at last time first.",
        "Before we start, here's what to remember from last time."
      ],
      "feedback.item": [
        "Here's the next one from last time.",
        "One more to remember."
      ],
      "feedback.done": [
        "That's last time sorted. On to practice!",
        "Great memory! Let's put it to work."
      ],
      warmup: [
        "Let's warm up with a couple you already know.",
        "Warm-up time! You've done these before."
      ],
      transition: [
        "Warm-up done! Now the real ones.",
        "Nice and warmed up. Here's the practice set."
      ],
      fresh: [
        "Take your time. Have a good look first.",
        "Read it through, then give it your best shot.",
        "No rush. Give it a go when you're ready."
      ],
      hintNote: [
        "Have a go first. If you get stuck, there's a clue waiting.",
        "Give it your best guess. I'll help if you need it."
      ],
      "clue.first": [
        "Here's a clue. It's under your answer.",
        "Here's a little nudge, just under your answer.",
        "I've put a clue under your answer. Have a read."
      ],
      "clue.last": [
        "Here's a bigger clue, under your answer.",
        "Last clue. This one helps a lot!"
      ],
      "wrong.first": [
        "Not yet! Have another look.",
        "Good try! Give it one more go.",
        "Hmm, not quite. Take another look."
      ],
      "wrong.again": [
        "Good try! I've put a clue under your answer.",
        "Let's narrow it down. There's a clue under your answer."
      ],
      "wrong.stuck": [
        "This one's tricky! Let's build it together, step by step.",
        "Let me show you how it works. Then you have a go."
      ],
      "showme.start": [
        "Let's build it together, one piece at a time.",
        "Watch each part find its place.",
        "Here's how it works. Follow along with me."
      ],
      "showme.yourTurn": [
        "Now you type it. You've seen how it works!",
        "Your turn to put it together.",
        "Over to you. Type it in."
      ],
      revealed: [
        "There it is. Well done for sticking with it.",
        "No worries. Now you've seen how it goes."
      ],
      "right.first": [
        "Yes!",
        "First try!",
        "Spot on!",
        "Nailed it!",
        "Brilliant!",
        "That's it!"
      ],
      "right.recovered": [
        "You got there! Sticking with it is the hard part.",
        "There it is! You worked it out.",
        "Got it! Trying again really paid off."
      ],
      comeback: [
        "Yes! You bounced right back.",
        "What a comeback!"
      ],
      streak: [
        "Three in a row! Keep it going.",
        "You're on a roll, {name}!"
      ],
      halfway: [
        "Halfway there!",
        "Half done. Great going."
      ],
      lastQuestion: [
        "Last one! Finish strong.",
        "Just one more to go!",
        "Final question. You've got this, {name}."
      ],
      celebrate: [
        "That's a star for you!",
        "Star earned! Lovely work.",
        "Another star, {name}!"
      ],
      idle: [
        "Still with me? Take your time.",
        "No rush. I'm right here when you're ready.",
        "Have a go whenever you're ready."
      ],
      "break.start": [
        "Good idea. Have a stretch, and I'll keep your place.",
        "Break time! I'll wait right here."
      ],
      "break.resume": [
        "Welcome back! Ready to carry on?",
        "Feeling fresh? Let's pick up where we were."
      ],
      nothingQueued: [
        "All caught up! Your next session isn't ready yet.",
        "Nothing new just yet. Check back soon!"
      ],
      close: [
        "That's your practice done! Great work, {name}.",
        "All done for today. See you next time!",
        "Finished! You kept going, and that's what counts."
      ]
    },

    // Presence only. Zero reference to the question, the answer, or the kind
    // of mistake — see docs/mascot.md §3 "The assessment rule is structural,
    // not stylistic". Every line here must pass the lint in §8: no
    // interpolation (so no {name}), nothing matching /answer is|the answer/i.
    // No clues or show-me moments exist in this register.
    assessment: {
      start: [
        "Here's today's check-in. Just do your best.",
        "A few questions today. Take your time."
      ],
      open: [
        "Have a go at these. Just do your best.",
        "Take these one at a time. There's no rush."
      ],
      returning: [
        "Welcome back! Carry on right here."
      ],
      feedback: [
        "Quick look back first, then we'll begin."
      ],
      warmup: [
        "A couple to get going on.",
        "Let's start with these."
      ],
      transition: [
        "On to the next few now.",
        "Nice. Here come some more."
      ],
      fresh: [
        "Take your time with this one.",
        "Have a go. There's no rush.",
        "Give it your best shot.",
        "Read it carefully, then have a go."
      ],
      "wrong.first": [
        "That's okay. On to the next.",
        "No bother. Here's the next one."
      ],
      "wrong.again": [
        "Keep going. You're doing fine."
      ],
      "wrong.stuck": [
        "That's okay. This one can wait for another day."
      ],
      exhausted: [
        "That's okay. Next one.",
        "No bother at all. Here comes the next one."
      ],
      moveon: [
        "Thanks! Next one.",
        "Good effort. On we go."
      ],
      "right.first": [
        "Nice!", "Well done!", "Good one!"
      ],
      "right.recovered": [
        "There it is. Well done."
      ],
      comeback: [
        "Nicely done."
      ],
      streak: [
        "You're on a roll."
      ],
      halfway: [
        "You're halfway through. Keep going."
      ],
      lastQuestion: [
        "Last one. Nearly finished!"
      ],
      idle: [
        "Take your time. I'm right here."
      ],
      "break.start": [
        "Have a little break. I'll keep your place."
      ],
      "break.resume": [
        "Welcome back! Carry on when you're ready."
      ],
      nothingQueued: [
        "Nothing new for us just yet. Check back in a bit.",
        "All caught up! Your next session isn't ready yet."
      ],
      close: [
        "All done! Well done for sticking with it.",
        "That's it for today. Thanks for trying your best."
      ]
    }
  };

  // Which Ollie SVG goes with each moment. Assessment keeps her calm: she
  // never cheers or looks concerned about a single question there.
  var MOODS = {
    _default: {
      start: 'wave', open: 'wave', returning: 'wave', warmup: 'wave', transition: 'cheer',
      feedback: 'point', 'feedback.item': 'point', 'feedback.done': 'cheer',
      'teach.step.first': 'point', 'teach.step.mid': 'point', 'teach.step.last': 'point', 'teach.tryIt': 'wave',
      fresh: 'neutral', hintNote: 'neutral', idle: 'neutral',
      'clue.first': 'think', 'clue.last': 'think',
      'wrong.first': 'think', 'wrong.again': 'think', 'wrong.stuck': 'point',
      'showme.start': 'point', 'showme.yourTurn': 'wave', revealed: 'point',
      'right.first': 'cheer', 'right.recovered': 'cheer', comeback: 'cheer', streak: 'cheer', celebrate: 'cheer',
      halfway: 'wave', lastQuestion: 'wave',
      'break.start': 'wave', 'break.resume': 'wave',
      nothingQueued: 'neutral', close: 'cheer',
      exhausted: 'neutral', moveon: 'neutral'
    },
    assessment: {
      'right.first': 'neutral', 'right.recovered': 'neutral', comeback: 'neutral', streak: 'neutral',
      'wrong.first': 'neutral', 'wrong.again': 'neutral', 'wrong.stuck': 'neutral',
      transition: 'wave', close: 'wave'
    }
  };

  // Used only when a (register, moment) is missing from BANK entirely —
  // the chain is exact → practice → this. A missing pair should be caught
  // by the lint (docs/mascot.md §8), not relied on at runtime.
  var HARD_FALLBACK = {
    start: "Here's the plan for today.",
    fresh: "Take your time, and give it a go.",
    "wrong.first": "Not yet! Have another go.",
    "right.first": "Nice one!",
    open: "Let's get going.",
    close: "All done for today.",
    warmup: "A couple to get going on.",
    transition: "On to the next bit.",
    nothingQueued: "Nothing new for us just yet.",
    idle: "Take your time. I'm right here."
  };

  var NAME_TOKEN = /\{name\}/;

  // One shuffle bag per (register, moment, name-or-not) actually requested,
  // so a fallback to the practice bank still gets its own draw order rather
  // than sharing state with practice's real callers. Session-scoped,
  // in-memory only.
  var bags = {};

  function shuffledIndices(n, avoid){
    var idx = [];
    for (var i = 0; i < n; i++) idx.push(i);
    for (var j = idx.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = idx[j]; idx[j] = idx[k]; idx[k] = t;
    }
    // Avoid re-dealing the line that was just used, when there's a choice.
    if (avoid != null && idx.length > 1 && idx[0] === avoid) {
      var tmp = idx[0]; idx[0] = idx[1]; idx[1] = tmp;
    }
    return idx;
  }

  function drawFrom(list, bagKey){
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    var bag = bags[bagKey];
    if (!bag || !bag.order.length) {
      bag = bags[bagKey] = { order: shuffledIndices(list.length, bag && bag.last), last: bag ? bag.last : null };
    }
    var idx = bag.order.shift();
    bag.last = idx;
    return list[idx];
  }

  // First name only, trimmed, capped, so a bubble never overflows.
  function cleanName(name){
    if (name == null) return '';
    var first = String(name).trim().split(/\s+/)[0] || '';
    return first.length > 20 ? first.slice(0, 20) : first;
  }

  function listFor(register, moment){
    var reg = BANK[register] ? register : 'practice';
    return (BANK[reg] && BANK[reg][moment]) || (BANK.practice && BANK.practice[moment]) || null;
  }

  /* pick(register, moment, ctx) — the one entry point every call site uses.
   * ctx.name (optional): the child's name. Lines with {name} are only dealt
   * when a name is given; otherwise the name-free lines are used. Assessment
   * never uses the name, even if one is passed.
   * The rest of ctx stays reserved for the phase-2 LLM seam (docs/mascot.md §9).
   */
  function pick(register, moment, ctx){
    var name = register === 'assessment' ? '' : cleanName(ctx && ctx.name);
    var list = listFor(register, moment);
    var usable = null;
    if (list) {
      usable = name ? list : list.filter(function (l) { return !NAME_TOKEN.test(l); });
    }
    var bagKey = register + ':' + moment + (name ? ':named' : ':plain');
    var line = usable && usable.length ? drawFrom(usable, bagKey) : null;
    line = line || HARD_FALLBACK[moment] || "I'm right here with you.";
    return name ? line.replace(/\{name\}/g, name) : line;
  }

  /* mood(register, moment) — which Ollie SVG to show with this moment's line. */
  function mood(register, moment){
    var own = MOODS[register] && MOODS[register][moment];
    return own || MOODS._default[moment] || 'neutral';
  }

  return { pick: pick, mood: mood, BANK: BANK, MOODS: MOODS };
});
