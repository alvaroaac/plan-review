/* global React, ReactDOM, ReviewCtx, Ico, Avatar, ItemCard, ThreadCard, Composer, PlanBody, ITEMS, INITIAL_ANSWERS, INITIAL_THREADS, PARA_LOC, PEOPLE */
const { useState: uS, useRef: uR, useEffect: uE } = React;

function scrollIn(container, el, offset = 120) {
  if (!container || !el) return;
  const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - offset;
  container.scrollTo({ top, behavior: 'smooth' });
}

function DocHeader() {
  return (
    <>
      <div className="kicker">Plan · Draft 3</div>
      <h1 className="doc-title">Migrate session auth to OAuth2 + PKCE</h1>
      <div className="doc-meta">
        <Avatar who="ar" size={20} /><b>Álvaro Ruiz</b><span className="dot"></span><span>Updated 2h ago</span><span className="dot"></span><span>Review requested from you</span>
      </div>
      <div className="legend">
        <span><i></i>Decision</span><span><i className="a"></i>Assumption</span><span><i className="c"></i>Comment</span>
        <span style={{ color: 'var(--ink-4)' }}>Hover a paragraph to comment</span>
      </div>
    </>
  );
}

function Progress({ n, total, d = 0 }) {
  return <div className="prog"><span><b>{n}/{total}</b> answered{d > 0 && <span className="def-ct"> · {d} deferred</span>}</span><span className="bar"><i style={{ width: (n / total * 100) + '%' }}></i></span></div>;
}

function Index({ variant, answers, threads, active, focus, onSec, onItem }) {
  const answered = ITEMS.filter(i => stateOf(answers[i.id]) === 'done').length;
  const deferred = ITEMS.filter(i => stateOf(answers[i.id]) === 'deferred').length;
  const next = ITEMS.find(i => !answers[i.id]);
  return (
    <nav className="index">
      {variant === 'toc' && (
        <div className="idx-prog">
          <Progress n={answered} total={ITEMS.length} d={deferred} />
          {next ? <button className="btn sm" onClick={() => onItem(next.id)}>Next open<Ico.right /></button> : <span className="idx-all"><Ico.check />All answered</span>}
        </div>
      )}
      <div className="idx-h">Contents</div>
      {SECTIONS.map(s => {
        const items = ITEMS.filter(i => s.paras.includes(i.paraId));
        const cm = threads.filter(t => !t.resolved && s.paras.includes(t.paraId)).length;
        return (
          <div key={s.id} className="idx-sec">
            <button className={'idx-row ' + (active === s.id ? 'on' : '')} onClick={() => onSec(s.id)}>
              <span className="idx-num">{s.num}</span>
              <span className="idx-t">{s.title}</span>
              <span className="idx-meta">
                {variant === 'stepper' && items.length > 0 && <span className="idx-dots">{items.map(i => <i key={i.id} className={`idx-dot k-${i.kind} ${stateOf(answers[i.id])}`}></i>)}</span>}
                {cm > 0 && <span className="idx-cmt"><Ico.chat />{cm}</span>}
              </span>
            </button>
            {variant === 'toc' && items.map(i => (
              <button key={i.id} className={`idx-sub k-${i.kind} ${stateOf(answers[i.id])} ${focus === i.id ? 'on' : ''}`} onClick={() => onItem(i.id)}>
                <i className={`idx-dot k-${i.kind} ${stateOf(answers[i.id])}`}></i><span>{i.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Stepper({ answers, focus, onItem }) {
  const answered = ITEMS.filter(i => stateOf(answers[i.id]) === 'done').length;
  const deferred = ITEMS.filter(i => stateOf(answers[i.id]) === 'deferred').length;
  const next = ITEMS.find(i => !answers[i.id]);
  return (
    <div className="stepper">
      <span className="st-lab"><b>{answered} of {ITEMS.length}</b> answered{deferred > 0 && <span className="def-ct"> · {deferred} deferred</span>}</span>
      <div className="segs">
        {ITEMS.map(i => <button key={i.id} title={i.label} className={`seg k-${i.kind} ${stateOf(answers[i.id])} ${focus === i.id ? 'on' : ''}`} onClick={() => onItem(i.id)}></button>)}
      </div>
      {next && <button className="btn sm ghost" onClick={() => onItem(next.id)}>Next<Ico.right /></button>}
    </div>
  );
}

function App() {
  const layout = window.LAYOUT || 'rail';
  const variant = window.VARIANT || null;
  const [activeSec, setActiveSec] = uS('s-01');
  const [answers, setAnswers] = uS({ ...INITIAL_ANSWERS });
  const [threads, setThreads] = uS(INITIAL_THREADS);
  const [focus, setFocus] = uS(null);
  const [focusThread, setFocusThread] = uS(null);
  const [composing, setComposing] = uS(null);
  const [popPara, setPopPara] = uS(null);
  const [tab, setTab] = uS('decisions');
  const [cFilter, setCFilter] = uS('open');
  const [sheetOpen, setSheetOpen] = uS('d1');
  const [toast, setToast] = uS(null);
  const [dark, setDark] = uS(() => localStorage.getItem('pr-simple-theme') === 'dark');
  const docRef = uR(), sideRef = uR();

  uE(() => { document.body.classList.toggle('dark', dark); localStorage.setItem('pr-simple-theme', dark ? 'dark' : 'light'); }, [dark]);
  uE(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  uE(() => {
    const c = docRef.current; if (!c || !variant) return;
    const on = () => {
      const ct = c.getBoundingClientRect().top; let cur = SECTIONS[0].id;
      SECTIONS.forEach(s => { const el = document.getElementById(s.id); if (el && el.getBoundingClientRect().top - ct < 160) cur = s.id; });
      if (c.scrollTop + c.clientHeight >= c.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
      setActiveSec(cur);
    };
    c.addEventListener('scroll', on, { passive: true }); return () => c.removeEventListener('scroll', on);
  }, []);

  const answered = ITEMS.filter(i => stateOf(answers[i.id]) === 'done').length;
  const deferred = ITEMS.filter(i => stateOf(answers[i.id]) === 'deferred').length;
  const openDecisions = ITEMS.length - answered - deferred;
  const openThreads = threads.filter(t => !t.resolved).length;

  const focusItem = (id, from) => {
    setFocus(id); setFocusThread(null);
    if (from === 'doc') {
      if (layout === 'rail') setTab('decisions');
      if (layout === 'sheet') setSheetOpen(id);
      setTimeout(() => scrollIn(layout === 'inline' ? docRef.current : sideRef.current, document.getElementById('card-' + id), layout === 'inline' ? 140 : 80), 40);
    } else {
      scrollIn(docRef.current, document.getElementById('mk-' + id), 180);
    }
  };
  const openThread = (id, from) => {
    const th = threads.find(t => t.id === id);
    setFocusThread(id); setFocus(null);
    if (layout === 'rail') { setTab('comments'); if (th.resolved) setCFilter('all'); }
    if (layout === 'sheet') setPopPara(th.paraId);
    if (from === 'side') scrollIn(docRef.current, document.getElementById('hl-' + id) || document.querySelector(`[data-para="${th.paraId}"]`), 180);
    else if (layout !== 'sheet') setTimeout(() => scrollIn(sideRef.current, document.getElementById('th-' + id), 80), 40);
  };
  const startComment = (paraId) => {
    setComposing(paraId);
    if (layout === 'rail') { setTab('comments'); setTimeout(() => sideRef.current && sideRef.current.scrollTo({ top: 0, behavior: 'smooth' }), 30); }
    if (layout === 'inline') sideRef.current && sideRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    if (layout === 'sheet') setPopPara(paraId);
  };
  const addComment = (paraId, body) => {
    const id = 't' + Date.now();
    setThreads(ts => [{ id, paraId, loc: PARA_LOC[paraId], quote: null, resolved: false, comments: [{ who: 'me', ago: 'now', body }] }, ...ts]);
    setComposing(null); setFocusThread(id);
  };
  const reply = (id, body) => setThreads(ts => ts.map(t => t.id === id ? { ...t, comments: [...t.comments, { who: 'me', ago: 'now', body }] } : t));
  const toggleResolve = (id) => setThreads(ts => ts.map(t => t.id === id ? { ...t, resolved: !t.resolved } : t));
  const setAnswer = (id, a) => {
    setAnswers(s => ({ ...s, [id]: a }));
    if (layout === 'sheet') { const next = ITEMS.find(i => i.id !== id && !answers[i.id]); setSheetOpen(next ? next.id : null); if (next) setFocus(next.id); }
  };
  const submit = () => {
    const flagged = ITEMS.filter(i => i.kind === 'assumption' && answers[i.id] && !['holds', 'deferred'].includes(answers[i.id].choice)).length;
    const mine = threads.filter(t => t.comments.some(c => c.who === 'me')).length;
    setToast(`Review sent to Álvaro · ${answered} answered${deferred ? `, ${deferred} deferred` : ''}${flagged ? `, ${flagged} assumption flagged` : ''}${mine ? `, ${mine} comment${mine > 1 ? 's' : ''}` : ''}`);
  };

  const jumpItem = (id) => { focusItem(id, 'doc'); scrollIn(docRef.current, document.getElementById('mk-' + id), 180); };
  const jumpSec = (id) => scrollIn(docRef.current, document.getElementById(id), 40);

  const ctx = { layout, answers, setAnswer, threads, focus, setFocus, focusThread, focusItem, openThread, composing, setComposing, startComment, addComment, reply, toggleResolve, popPara, setPopPara };
  const order = Object.keys(PARA_LOC);
  const sortedThreads = [...threads].sort((a, b) => order.indexOf(a.paraId) - order.indexOf(b.paraId));
  const nextOpen = ITEMS.find(i => !answers[i.id]);

  const submitDisabledNote = openDecisions ? `${openDecisions} still open` : 'All answered';

  return (
    <ReviewCtx.Provider value={ctx}>
      <div className="app">
        <header className="top">
          <div className="brand"><span className="logo"></span>plan-review</div>
          <span className="crumb">eng / auth / <b>OAuth2 + PKCE migration</b></span>
          <div className="sp"></div>
          {layout === 'rail' && !variant && <Progress n={answered} total={ITEMS.length} d={deferred} />}
          {variant === 'toc' && <div className="prog-narrow"><Progress n={answered} total={ITEMS.length} d={deferred} /></div>}
          {variant === 'stepper' && <Stepper answers={answers} focus={focus} onItem={jumpItem} />}
          {variant === 'stepper' && <div className="sp"></div>}
          <button className="icon-btn" title="Toggle theme" onClick={() => setDark(d => !d)}>{dark ? <Ico.sun /> : <Ico.moon />}</button>
          {layout !== 'sheet' && <button className="btn primary" onClick={submit}>Submit review</button>}
        </header>

        <div className={'main L-' + layout + (variant ? ' has-index' : '')} onClick={() => layout === 'sheet' && popPara && !composing && setPopPara(null)}>
          {variant && <Index variant={variant} answers={answers} threads={threads} active={activeSec} focus={focus} onSec={jumpSec} onItem={jumpItem} />}
          <div className="scroll" ref={docRef}>
            {(layout === 'inline' || variant === 'strip') && (
              <div className="strip">
                <span className="lab"><b>{answered}/{ITEMS.length}</b> answered</span>
                <div className="pips">
                  {ITEMS.map(i => <button key={i.id} className={`pip k-${i.kind} ${stateOf(answers[i.id])}`} onClick={() => jumpItem(i.id)}><span className="d"></span>{i.label}</button>)}
                </div>
                <div className="sp"></div>
                {nextOpen && <button className="btn sm" onClick={() => jumpItem(nextOpen.id)}>Next open<Ico.right /></button>}
              </div>
            )}
            <article className="doc" onClick={e => e.stopPropagation()}><DocHeader /><PlanBody /></article>
          </div>

          {layout === 'rail' && (
            <aside className="side">
              <div className="tabs">
                <button className={'tab ' + (tab === 'decisions' ? 'on' : '')} onClick={() => setTab('decisions')}>Decisions <span className={'ct ' + (openDecisions ? 'hot' : '')}>{openDecisions}</span></button>
                <button className={'tab ' + (tab === 'comments' ? 'on' : '')} onClick={() => setTab('comments')}>Comments <span className="ct">{openThreads}</span></button>
              </div>
              <div className="scroll" ref={sideRef}>
                {tab === 'decisions' ? (
                  <div className="rail-list">
                    {openDecisions > 0 && <div className="group-h"><span>Needs your answer</span><span>{openDecisions}</span></div>}
                    {ITEMS.filter(i => !answers[i.id]).map(i => <ItemCard key={i.id} it={i} />)}
                    {deferred > 0 && <div className="group-h" style={{ marginTop: 14 }}><span>Deferred</span><span>{deferred}</span></div>}
                    {ITEMS.filter(i => stateOf(answers[i.id]) === 'deferred').map(i => <ItemCard key={i.id} it={i} />)}
                    {answered > 0 && <div className="group-h" style={{ marginTop: 14 }}><span>Answered</span><span>{answered}</span></div>}
                    {ITEMS.filter(i => stateOf(answers[i.id]) === 'done').map(i => <ItemCard key={i.id} it={i} />)}
                  </div>
                ) : (
                  <>
                    <div className="chips">
                      {['open', 'resolved', 'all'].map(f => <button key={f} className={'chip ' + (cFilter === f ? 'on' : '')} onClick={() => setCFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
                    </div>
                    <div className="rail-list">
                      {composing && <Composer paraId={composing} />}
                      {sortedThreads.filter(t => cFilter === 'all' || (cFilter === 'open' ? !t.resolved : t.resolved)).map(t => <ThreadCard key={t.id} th={t} />)}
                      {!composing && sortedThreads.filter(t => cFilter === 'all' || (cFilter === 'open' ? !t.resolved : t.resolved)).length === 0 && <div className="empty">Nothing here.</div>}
                    </div>
                  </>
                )}
              </div>
            </aside>
          )}

          {layout === 'inline' && (
            <aside className="side">
              <div className="margin-h"><Ico.chat />Comments <span className="ct">{openThreads}</span></div>
              <div className="scroll" ref={sideRef}>
                <div className="rail-list">
                  {composing && <Composer paraId={composing} />}
                  {sortedThreads.filter(t => !t.resolved).map(t => <ThreadCard key={t.id} th={t} />)}
                  {threads.some(t => t.resolved) && <div className="group-h" style={{ marginTop: 10 }}><span>Resolved</span><span>{threads.filter(t => t.resolved).length}</span></div>}
                  {sortedThreads.filter(t => t.resolved).map(t => <ThreadCard key={t.id} th={t} />)}
                </div>
              </div>
            </aside>
          )}

          {layout === 'sheet' && (
            <aside className="side" onClick={e => e.stopPropagation()}>
              <div className="sheet-head">
                <h2>Your review</h2>
                <p>Álvaro flagged {ITEMS.filter(i => i.kind === 'decision').length} decisions and {ITEMS.filter(i => i.kind === 'assumption').length} assumptions for you. Comments live in the document margin.</p>
                <Progress n={answered} total={ITEMS.length} d={deferred} />
              </div>
              <div className="scroll" ref={sideRef}>
                <div className="sheet-list">
                  {ITEMS.map((i, idx) => {
                    const a = answers[i.id];
                    if (sheetOpen === i.id) return <ItemCard key={i.id} it={i} />;
                    const summary = a && a.choice === 'deferred' ? 'Deferred' : a ? (i.kind === 'decision' ? (a.choice === 'other' ? 'Other' : `${a.choice} · ${i.options.find(o => o.key === a.choice).text}`) : { holds: 'Holds', unsure: 'Not sure', no: "Doesn't hold" }[a.choice]) : (i.kind === 'decision' ? 'Decision needed' : 'Confirm assumption');
                    return (
                      <button key={i.id} className={`srow k-${i.kind} ${stateOf(a)}`} onClick={() => { setSheetOpen(i.id); setFocus(i.id); scrollIn(docRef.current, document.getElementById('mk-' + i.id), 180); }}>
                        <span className="n">{stateOf(a) === 'done' ? '✓' : stateOf(a) === 'deferred' ? '–' : idx + 1}</span>
                        <span style={{ minWidth: 0 }}><div className="t">{i.label}</div><div className="s">{summary}</div></span>
                        <span className="chev"><Ico.down /></span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sheet-foot">
                <span><Ico.chat /> {openThreads} open comments</span><div className="sp"></div>
                <span>{submitDisabledNote}</span>
                <button className="btn primary" onClick={submit}>Submit review</button>
              </div>
            </aside>
          )}
        </div>
        {toast && <div className="toast"><Ico.check />{toast}</div>}
      </div>
    </ReviewCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
