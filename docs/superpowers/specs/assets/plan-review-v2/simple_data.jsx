/* global React, Q, Hl, Para */
const PEOPLE = {
  ar: { name: 'Álvaro Ruiz', ini: 'AR', hue: 40 },
  pn: { name: 'Priya Natarajan', ini: 'PN', hue: 220 },
  me: { name: 'You', ini: 'SL', hue: 150 },
};

const ITEMS = [
  { id: 'd1', kind: 'decision', label: 'Retry backoff', loc: '§ 01', paraId: 'p-overview',
    question: 'How should token refresh retries back off when the auth server is slow?',
    context: 'The Aug 14 incident was caused by unbounded retries. All options cap blast radius; they differ in latency and complexity.',
    options: [
      { key: 'A', text: 'Exponential backoff, capped at 5 s', sub: 'Simple; retries invisible to the client', pick: true },
      { key: 'B', text: 'Circuit breaker that opens after 90 s of failures', sub: 'Stronger guarantee; needs a health probe' },
      { key: 'C', text: 'Both: backoff inside a circuit breaker', sub: 'Most moving parts' },
    ] },
  { id: 'a1', kind: 'assumption', label: 'Browser crypto support', loc: '§ 02', paraId: 'p-scope',
    question: 'Every supported browser exposes SubtleCrypto, so we can require S256 challenges with no plain-method fallback.',
    context: 'Based on the browserslist in package.json (last 2 versions, >0.5% usage).' },
  { id: 'd2', kind: 'decision', label: 'Refresh cookie scope', loc: '§ 03', paraId: 'p-storage',
    question: 'Should the refresh-token cookie be scoped to /oauth or to the whole site?',
    context: 'Narrow scope is the OWASP recommendation, but refresh calls currently come from three different paths.',
    options: [
      { key: 'A', text: 'Scope to /oauth and route all refresh calls through it', sub: 'Tightest; small routing change', pick: true },
      { key: 'B', text: 'Scope to / and keep current call sites', sub: 'No routing change; looser than OWASP' },
    ] },
  { id: 'a2', kind: 'assumption', label: 'Auth server latency', loc: '§ 04', paraId: 'p-exchange',
    question: 'Auth server p99 stays under 300 ms at current load, so a 5 s exchange timeout leaves plenty of headroom.',
    context: 'From the last 30 days of Datadog metrics. Not load-tested at 2× traffic.' },
  { id: 'd3', kind: 'decision', label: 'Legacy callback window', loc: '§ 05', paraId: 'p-legacy',
    question: 'How long do we keep the legacy /auth/callback redirect alive?',
    context: 'Mobile clients pin redirect URLs. About 60% of users reopen the app within 30 days.',
    options: [
      { key: 'A', text: '30 days', sub: 'Covers ~85% of reopens' },
      { key: 'B', text: '60 days', sub: 'Covers ~99% of reopens', pick: true },
      { key: 'C', text: 'Indefinitely, behind a feature flag', sub: 'Safest; most code to keep around' },
    ] },
];
const ITEM_MAP = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const INITIAL_ANSWERS = { a1: { choice: 'holds', note: '' } };

const PARA_LOC = {
  'p-overview': '§ 01 Overview', 'p-scope': '§ 02 Scope', 'p-scope-list': '§ 02 Scope',
  'p-storage': '§ 03 Token storage', 'p-exchange-intro': '§ 04 Token exchange', 'p-exchange': '§ 04 Token exchange',
  'p-rollout': '§ 05 Rollout', 'p-legacy': '§ 05 Rollout',
};

const SECTIONS = [
  { id: 's-01', num: '01', title: 'Overview', paras: ['p-overview'] },
  { id: 's-02', num: '02', title: 'Scope', paras: ['p-scope-list', 'p-scope'] },
  { id: 's-03', num: '03', title: 'Token storage', paras: ['p-storage'] },
  { id: 's-04', num: '04', title: 'Token exchange', paras: ['p-exchange-intro', 'p-exchange'] },
  { id: 's-05', num: '05', title: 'Rollout', paras: ['p-rollout', 'p-legacy'] },
];

const INITIAL_THREADS = [
  { id: 't1', paraId: 'p-overview', loc: '§ 01 Overview', quote: 'we have taken outages in the past from that alone', resolved: false,
    comments: [
      { who: 'pn', ago: '14m', body: "Which outage? If it's Aug 14, the post-mortem blamed retries without backoff more than the missing timeout." },
      { who: 'ar', ago: '6m', body: 'Both were listed as causes. I’ll link the post-mortem here.' },
    ] },
  { id: 't2', paraId: 'p-exchange-intro', loc: '§ 04 Token exchange', quote: 'never leaves the client', resolved: false,
    comments: [{ who: 'pn', ago: '3m', body: "It does leave the client: it's sent with POST /token. Maybe “is never exposed to the browser”?" }] },
  { id: 't3', paraId: 'p-rollout', loc: '§ 05 Rollout', quote: 'The AUTH_PKCE flag gates every phase', resolved: true,
    comments: [
      { who: 'pn', ago: '1h', body: 'Is the flag per-tenant or global?' },
      { who: 'ar', ago: '52m', body: 'Per-tenant. Added a line below.' },
    ] },
];

function PlanBody() {
  return (
    <>
      <h2 id="s-01"><span className="h2-num">01</span>Overview</h2>
      <Para id="p-overview">We’re replacing opaque session cookies with the OAuth2 authorization-code flow plus PKCE across the web app. The current middleware has no upstream timeout on the auth server, and <Hl t="t1">we have taken outages in the past from that alone</Hl>. Before implementation starts we need to settle <Q id="d1">how token refresh retries back off</Q> when the auth server degrades.</Para>
      <h2 id="s-02"><span className="h2-num">02</span>Scope</h2>
      <Para id="p-scope-list" as="ul">
        <li>In scope: web dashboard, admin console, and browser clients of the public API.</li>
        <li>Out of scope: server-to-server calls (11 of 38 call sites) and mobile, which follows in Q1.</li>
      </Para>
      <Para id="p-scope">We assume <Q id="a1">every supported browser exposes SubtleCrypto for S256 challenges</Q>, so we won’t ship a plain-method fallback.</Para>
      <h2 id="s-03"><span className="h2-num">03</span>Token storage</h2>
      <Para id="p-storage">Access tokens live in memory only and are never persisted. Refresh tokens move into an <code>HttpOnly</code>, <code>SameSite=Strict</code> cookie. <Q id="d2">The cookie’s path scope is still open</Q>.</Para>
      <div className="callout"><span className="ico">i</span><div>OWASP ASVS 4.0 §3.5 requires refresh tokens in browser apps to be stored in HttpOnly cookies.</div></div>
      <h2 id="s-04"><span className="h2-num">04</span>Token exchange</h2>
      <Para id="p-exchange-intro">The <code>code_verifier</code> is generated per login, stored server-side keyed by <code>state</code>, and <Hl t="t2">never leaves the client</Hl> until the exchange.</Para>
      <pre className="code"><span className="k">export async function</span> <span className="f">handleRedirect</span>(req, res) {"{"}{"\n"}  <span className="k">const</span> {"{"} code, state {"}"} = req.query;{"\n"}  <span className="k">const</span> verifier = <span className="f">popVerifier</span>(req.session, state);{"\n"}  <span className="k">if</span> (!verifier) <span className="k">return</span> res.status(<span className="s">400</span>).send(<span className="s">'PKCE state expired'</span>);{"\n"}  <span className="c">// exchange code → tokens, 5s timeout</span>{"\n"}  <span className="k">const</span> tokens = <span className="k">await</span> <span className="f">exchangeCode</span>({"{"} code, verifier, timeoutMs: <span className="s">5000</span> {"}"});{"\n"}  <span className="f">setSession</span>(res, tokens);{"\n"}{"}"}</pre>
      <Para id="p-exchange">The 5 s timeout rests on the assumption that <Q id="a2">auth server p99 stays under 300 ms</Q> at current load.</Para>
      <h2 id="s-05"><span className="h2-num">05</span>Rollout</h2>
      <table className="tbl"><thead><tr><th>Phase</th><th>Audience</th><th>Gate to next</th></tr></thead><tbody>
        <tr><td>1 · wk 1</td><td>Internal staff</td><td>No auth errors for 48 h</td></tr>
        <tr><td>2 · wk 2</td><td>10% of external tenants</td><td>Error rate under 0.5%</td></tr>
        <tr><td>3 · wk 3</td><td>All tenants</td><td>Legacy handler removed</td></tr>
      </tbody></table>
      <Para id="p-rollout"><Hl t="t3">The AUTH_PKCE flag gates every phase</Hl>, per tenant, so rollback is a config change.</Para>
      <Para id="p-legacy">Mobile clients pin the old redirect URL. <Q id="d3">How long we keep <code>/auth/callback</code> alive</Q> decides when the legacy handler can be deleted.</Para>
    </>
  );
}

Object.assign(window, { PEOPLE, ITEMS, ITEM_MAP, INITIAL_ANSWERS, PARA_LOC, INITIAL_THREADS, SECTIONS, PlanBody });
