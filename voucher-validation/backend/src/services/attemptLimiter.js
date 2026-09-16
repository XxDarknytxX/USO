// src/services/attemptLimiter.js
//
// Throttles guessing at the credential endpoints.
//
// Without this, a six-digit second factor is not a second factor. The code
// space is 10^6, three codes are valid at any instant (a ±1 step window), and
// the sign-in token that lets you try them lives for five minutes — so an
// attacker who already has the password can expect to walk in after a few
// hundred thousand requests, which is seconds of scripted traffic. The whole
// point of the second factor is that holding the password is not enough.
//
// TWO counters, because they defend against different things and one of them
// can be turned against the user:
//
//   per (ip, account) — strict. This is the actual attack: one attacker,
//     hammering one account. Blocking it costs nobody anything.
//
//   per account — generous, and deliberately so. It catches a distributed
//     attempt, but it can also be used to lock a real person out of their own
//     console by failing on purpose from somewhere else. The threshold is set
//     high enough that normal use, and normal fumbling, never reaches it.
//
// IN-PROCESS. State is a Map, so it resets on restart and is not shared across
// PM2 workers — with N workers an attacker gets N times the allowance. That is
// a real limit of this approach and the reason the thresholds are conservative;
// the alternative, a table write per attempt, puts the login path behind the
// database on every request including the failing ones.

const MINUTE = 60_000;

/**
 * @param {object} opts
 * @param {number} opts.max        failures allowed within the window
 * @param {number} opts.windowMs   how long failures are remembered
 * @param {number} opts.blockMs    how long a block lasts once tripped
 */
function bucket({ max, windowMs, blockMs }) {
  const hits = new Map(); // key -> { count, first, blockedUntil }

  function state(key, now) {
    const e = hits.get(key);
    if (!e) return null;
    // A block outlives its window on purpose: the window is for counting, the
    // block is the consequence.
    if (e.blockedUntil && e.blockedUntil > now) return e;
    if (e.blockedUntil && e.blockedUntil <= now) { hits.delete(key); return null; }
    if (now - e.first > windowMs) { hits.delete(key); return null; }
    return e;
  }

  return {
    /** Seconds to wait, or 0 when the caller may proceed. */
    retryAfter(key, now = Date.now()) {
      const e = state(key, now);
      if (e?.blockedUntil && e.blockedUntil > now) {
        return Math.ceil((e.blockedUntil - now) / 1000);
      }
      return 0;
    },
    /** Record one failure. Returns seconds to wait if this tripped a block. */
    fail(key, now = Date.now()) {
      const e = state(key, now) || { count: 0, first: now, blockedUntil: 0 };
      e.count += 1;
      if (e.count >= max) e.blockedUntil = now + blockMs;
      hits.set(key, e);
      return e.blockedUntil > now ? Math.ceil((e.blockedUntil - now) / 1000) : 0;
    },
    /** A success clears the slate — otherwise one bad day locks a good user out. */
    clear(key) {
      hits.delete(key);
    },
    /** Drops expired entries so the Map cannot grow without bound. */
    sweep(now = Date.now()) {
      for (const [key] of hits) state(key, now);
    },
    get size() {
      return hits.size;
    },
  };
}

export function makeAttemptLimiter({
  max = 10,
  windowMs = 15 * MINUTE,
  blockMs = 15 * MINUTE,
  accountMax = 50,
  accountWindowMs = 60 * MINUTE,
  accountBlockMs = 30 * MINUTE,
} = {}) {
  const perPair = bucket({ max, windowMs, blockMs });
  const perAccount = bucket({ max: accountMax, windowMs: accountWindowMs, blockMs: accountBlockMs });

  // One sweep for both, unref'd so it never holds the process open.
  const timer = setInterval(() => {
    perPair.sweep();
    perAccount.sweep();
  }, 5 * MINUTE);
  timer.unref?.();

  const pairKey = (ip, account) => `${ip}|${account}`;

  return {
    /** Seconds to wait, or 0 to proceed. Checked BEFORE any password compare. */
    retryAfter(ip, account) {
      return Math.max(perPair.retryAfter(pairKey(ip, account)), perAccount.retryAfter(account));
    },
    fail(ip, account) {
      const a = perPair.fail(pairKey(ip, account));
      const b = perAccount.fail(account);
      return Math.max(a, b);
    },
    succeed(ip, account) {
      perPair.clear(pairKey(ip, account));
      perAccount.clear(account);
    },
    _sizes: () => ({ pairs: perPair.size, accounts: perAccount.size }),
  };
}

/**
 * The client's address, as Express resolved it.
 *
 * Deliberately NOT reading X-Forwarded-For directly. That header is
 * attacker-controlled, so trusting it unconditionally turns the per-IP counter
 * into a per-header-value counter — an attacker sends a different value each
 * request and is never throttled. server.js already configures `trust proxy`
 * from TRUST_PROXY, which is the setting that decides how many hops of that
 * header may be believed; req.ip is then the answer, and there is no reason to
 * compute a second, different one here.
 *
 * If TRUST_PROXY is NOT set in production, every request behind Nginx shares
 * one address and the per-(ip, account) counter collapses into a per-account
 * one. That still throttles a brute force — arguably harder — but it also
 * means somebody else's failures can lock an account out for the block period.
 * Setting TRUST_PROXY=1 on a single-Nginx deployment is the right answer.
 */
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
