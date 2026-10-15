/* global React */
const { useState, useEffect, useRef, useContext, createContext } = React;
const ReviewCtx = createContext(null);
const useReview = () => useContext(ReviewCtx);
const stateOf = (a) => !a ? 'open' : a.choice === 'deferred' ? 'deferred' : 'done';

const Ico = {
  plus: () => <svg className="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  check: () => <svg className="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>,
  chat: () => <svg className="i" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/></svg>,
  sun: () => <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
  moon: () => <svg className="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>,
  right: () => <svg className="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>,
  down: () => <svg className="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>,
  x: () => <svg className="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>,
  clock: () => <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
};

function Avatar({ who, size = 22 }) {
  const p = PEOPLE[who];
  return <span className="ava" style={{ width: size, height: size, fontSize: size * 0.4, background: `oklch(0.6 0.09 ${p.hue})` }}>{p.ini}</span>;
}

function Q({ id, children }) {
  const r = useReview();
  const it = ITEM_MAP[id];
  const st = stateOf(r.answers[id]);
  return (
    <span id={'mk-' + id} className={`q q-${it.kind} is-${st} ${r.focus === id ? 'is-focus' : ''}`} onClick={() => r.focusItem(id, 'doc')}>
      {children}<sup className="q-badge">{st === 'done' ? '✓' : st === 'deferred' ? '–' : it.kind === 'decision' ? '?' : 'A'}</sup>
    </span>
  );
}

function Hl({ t, children }) {
  const r = useReview();
  const th = r.threads.find(x => x.id === t);
  if (!th || th.resolved) return children;
  return <span id={'hl-' + t} className={`hl ${r.focusThread === t ? 'is-focus' : ''}`} onClick={() => r.openThread(t, 'doc')}>{children}</span>;
}

function Para({ id, as = 'p', children }) {
  const r = useReview();
  const Tag = as;
  const inlineItems = r.layout === 'inline' ? ITEMS.filter(i => i.paraId === id) : [];
  return (
    <>
      <div className="para" data-para={id}>
        <button className="para-add" title="Comment on this paragraph" onClick={() => r.startComment(id)}><Ico.plus /></button>
        <Tag>{children}</Tag>
        {r.layout === 'sheet' && <ParaBubble id={id} />}
      </div>
      {inlineItems.map(it => <div className="inline-card" key={it.id}><ItemCard it={it} /></div>)}
    </>
  );
}

function ParaBubble({ id }) {
  const r = useReview();
  const list = r.threads.filter(t => t.paraId === id && !t.resolved);
  const open = r.popPara === id;
  return (
    <>
      <button className={`para-bubble ${list.length ? 'has' : 'ghost'}`} onClick={() => list.length ? r.setPopPara(open ? null : id) : r.startComment(id)}>
        <Ico.chat />{list.length || '+'}
      </button>
      {open && (
        <div className="para-pop" onClick={e => e.stopPropagation()}>
          <div className="pop-h"><span>{PARA_LOC[id]} · {list.length} open</span><button className="btn ghost sm" onClick={() => { r.setPopPara(null); r.setComposing(null); }}><Ico.x /></button></div>
          {r.composing === id && <Composer paraId={id} />}
          {list.map(th => <ThreadCard key={th.id} th={th} />)}
          {r.composing !== id && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => r.startComment(id)}><Ico.plus />New comment</button>}
        </div>
      )}
    </>
  );
}

function ItemCard({ it }) {
  const r = useReview();
  const ans = r.answers[it.id];
  const [editing, setEditing] = useState(!ans);
  const wasDeferred = ans && ans.choice === 'deferred';
  const [choice, setChoice] = useState(ans && !wasDeferred ? ans.choice : null);
  const [note, setNote] = useState(ans && !wasDeferred ? ans.note : '');
  const [deferring, setDeferring] = useState(false);
  const [dnote, setDnote] = useState(wasDeferred ? ans.note : '');
  const defer = () => { r.setAnswer(it.id, { choice: 'deferred', note: dnote.trim() }); setDeferring(false); setEditing(false); };
  const isDec = it.kind === 'decision';
  const needsNote = !isDec && choice === 'no';
  const canSave = choice && (choice !== 'other' || note.trim()) && (!needsNote || note.trim());
  const save = () => { r.setAnswer(it.id, { choice, note: note.trim() }); setEditing(false); };
  const showForm = !ans || editing;
  const VERD = { holds: 'Holds', unsure: 'Not sure', no: "Doesn't hold" };
  return (
    <div id={'card-' + it.id} className={`card item-card k-${it.kind} ${r.focus === it.id ? 'is-focus' : ''}`} onClick={() => r.setFocus(it.id)}>
      <div className="ic-head">
        <span className={'kind kind-' + it.kind}>{isDec ? 'Decision' : 'Assumption'}</span>
        <span className="ic-label">{it.label}</span>
        {r.layout !== 'inline' && <button className="loc" onClick={e => { e.stopPropagation(); r.focusItem(it.id, 'card'); }}>{it.loc}</button>}
      </div>
      <p className="ic-q">{it.question}</p>
      {showForm && it.context && <p className="ic-ctx">{it.context}</p>}
      {!showForm && (
        <div className={`answer ${isDec && !wasDeferred ? '' : 'v-' + ans.choice}`}>
          {wasDeferred ? <Ico.clock /> : <Ico.check />}
          <div>
            {wasDeferred ? <b>Deferred</b> : isDec
              ? (ans.choice === 'other' ? <b>Other</b> : <><b>{ans.choice}</b> · {it.options.find(o => o.key === ans.choice).text}</>)
              : <b>{VERD[ans.choice]}</b>}
            {ans.note && <span className="note">{ans.note}</span>}
          </div>
          <button className="btn sm" onClick={e => { e.stopPropagation(); setEditing(true); }}>{wasDeferred ? 'Answer now' : 'Change'}</button>
        </div>
      )}
      {showForm && deferring && (
        <div className="defer-panel" onClick={e => e.stopPropagation()}>
          <div className="defer-h"><Ico.clock />Defer this {isDec ? 'decision' : 'assumption'}</div>
          <textarea className="field" autoFocus value={dnote} onChange={e => setDnote(e.target.value)} placeholder="What's needed first, or who should decide? (optional)"></textarea>
          <div className="ic-actions">
            <button className="btn sm ghost" onClick={() => setDeferring(false)}>Back</button>
            <button className="btn sm defer-go" onClick={defer}>Defer</button>
          </div>
        </div>
      )}
      {showForm && !deferring && (
        <>
          {isDec ? (
            <div className="opts">
              {it.options.map(o => (
                <label key={o.key} className={'opt ' + (choice === o.key ? 'on' : '')}>
                  <input type="radio" name={it.id} checked={choice === o.key} onChange={() => setChoice(o.key)} />
                  <span className="opt-key">{o.key}</span>
                  <span className="opt-text">{o.text}{o.sub && <small>{o.sub}</small>}</span>
                  {o.pick ? <span className="pick">Author's pick</span> : <span></span>}
                </label>
              ))}
              <label className={'opt ' + (choice === 'other' ? 'on' : '')}>
                <input type="radio" name={it.id} checked={choice === 'other'} onChange={() => setChoice('other')} />
                <span className="opt-key">…</span><span className="opt-text">Something else</span><span></span>
              </label>
            </div>
          ) : (
            <div className="verdicts">
              {Object.entries(VERD).map(([k, v]) => <button key={k} className={`verdict v-${k} ${choice === k ? 'on' : ''}`} onClick={() => setChoice(k)}>{v}</button>)}
            </div>
          )}
          {choice && <textarea className="field" value={note} onChange={e => setNote(e.target.value)} placeholder={choice === 'other' ? 'Describe your option' : needsNote ? "What's actually true?" : 'Rationale (optional)'}></textarea>}
          <div className="ic-actions">
            {!wasDeferred && <button className="btn sm ghost" onClick={e => { e.stopPropagation(); setDeferring(true); }}><Ico.clock />Defer</button>}
            <span className="sp"></span>
            {ans && <button className="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>}
            <button className="btn sm primary" disabled={!canSave} onClick={e => { e.stopPropagation(); save(); }}>{isDec ? 'Save decision' : 'Save'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function ThreadCard({ th }) {
  const r = useReview();
  const [reply, setReply] = useState('');
  return (
    <div id={'th-' + th.id} className={`card thread ${th.resolved ? 'is-resolved' : ''} ${r.focusThread === th.id ? 'is-focus' : ''}`} onClick={() => r.openThread(th.id, 'side')}>
      <div className="th-head">
        <span className="loc">{th.loc}</span>
        <button className="th-resolve" onClick={e => { e.stopPropagation(); r.toggleResolve(th.id); }}>{th.resolved ? 'Reopen' : <><Ico.check />Resolve</>}</button>
      </div>
      {th.quote && <blockquote className="th-quote">{th.quote}</blockquote>}
      {th.comments.map((c, i) => (
        <div className="cmt" key={i}><Avatar who={c.who} />
          <div><div className="cmt-meta"><b>{PEOPLE[c.who].name}</b><span>{c.ago}</span></div><p>{c.body}</p></div>
        </div>
      ))}
      {!th.resolved && (
        <div className="th-reply" onClick={e => e.stopPropagation()}>
          <input className="field" placeholder="Reply…" value={reply} onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && reply.trim()) { r.reply(th.id, reply.trim()); setReply(''); } }} />
        </div>
      )}
    </div>
  );
}

function Composer({ paraId }) {
  const r = useReview();
  const [body, setBody] = useState('');
  const ref = useRef();
  useEffect(() => { ref.current && ref.current.focus({ preventScroll: true }); }, [paraId]);
  return (
    <div className="card composer">
      <div className="lbl">New comment · {PARA_LOC[paraId]}</div>
      <textarea ref={ref} className="field" value={body} onChange={e => setBody(e.target.value)} placeholder="Add a comment…"></textarea>
      <div className="ic-actions">
        <button className="btn sm ghost" onClick={() => r.setComposing(null)}>Cancel</button>
        <button className="btn sm primary" disabled={!body.trim()} onClick={() => r.addComment(paraId, body.trim())}>Comment</button>
      </div>
    </div>
  );
}

Object.assign(window, { ReviewCtx, useReview, stateOf, Ico, Avatar, Q, Hl, Para, ItemCard, ThreadCard, Composer });
