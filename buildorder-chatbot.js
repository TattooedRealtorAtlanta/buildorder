(function () {
  if (document.getElementById('bo-chat-root')) return;

  const isES = localStorage.getItem('bo-lang') === 'es' ||
    document.documentElement.lang === 'es' ||
    new URLSearchParams(window.location.search).get('lang') === 'es';

  const AMBER = '#F59E0B';
  const AMBER_DARK = '#412402';

  const style = document.createElement('style');
  style.textContent = `
    #bo-chat-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; }
    #bo-bubble { position: fixed; bottom: 24px; right: 24px; width: 54px; height: 54px; border-radius: 50%; background: ${AMBER}; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.18); z-index: 99999; transition: transform 0.15s; }
    #bo-bubble:hover { transform: scale(1.06); }
    #bo-bubble svg { width: 24px; height: 24px; fill: none; stroke: ${AMBER_DARK}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    #bo-window { position: fixed; bottom: 90px; right: 24px; width: 340px; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; display: none; flex-direction: column; height: 480px; z-index: 99998; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }
    #bo-header { background: ${AMBER}; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
    #bo-header-left { display: flex; align-items: center; gap: 8px; }
    #bo-header-left span { font-weight: 600; font-size: 15px; color: ${AMBER_DARK}; }
    #bo-close { background: none; border: none; cursor: pointer; color: ${AMBER_DARK}; font-size: 20px; line-height: 1; padding: 0 2px; }
    #bo-msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
    #bo-msgs::-webkit-scrollbar { width: 4px; }
    #bo-msgs::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 4px; }
    .bo-msg { max-width: 86%; padding: 9px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.55; }
    .bo-bot { background: #f3f4f6; color: #111827; align-self: flex-start; border-bottom-left-radius: 4px; }
    .bo-user { background: ${AMBER}; color: ${AMBER_DARK}; align-self: flex-end; border-bottom-right-radius: 4px; font-weight: 500; }
    .bo-typing { color: #9ca3af; font-style: italic; }
    #bo-chips { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid #f3f4f6; }
    .bo-chip { font-size: 11.5px; padding: 5px 10px; border-radius: 20px; border: 1px solid #e5e7eb; background: #fff; color: #6b7280; cursor: pointer; transition: background 0.1s, color 0.1s; white-space: nowrap; }
    .bo-chip:hover { background: #fef3c7; color: ${AMBER_DARK}; border-color: ${AMBER}; }
    #bo-input-row { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f3f4f6; }
    #bo-input { flex: 1; font-size: 13px; padding: 8px 11px; border-radius: 8px; border: 1px solid #e5e7eb; color: #111827; outline: none; }
    #bo-input:focus { border-color: ${AMBER}; }
    #bo-send { background: ${AMBER}; border: none; border-radius: 8px; padding: 8px 13px; cursor: pointer; color: ${AMBER_DARK}; font-size: 15px; display: flex; align-items: center; justify-content: center; }
    #bo-send:hover { opacity: 0.88; }
    @media (max-width: 400px) { #bo-window { width: calc(100vw - 16px); right: 8px; } #bo-bubble { right: 16px; bottom: 16px; } }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'bo-chat-root';
  root.innerHTML = `
    <button id="bo-bubble" aria-label="Open BuildOrder support chat">
      <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </button>
    <div id="bo-window" role="dialog" aria-label="BuildOrder chat assistant">
      <div id="bo-header">
        <div id="bo-header-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${AMBER_DARK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <span>BuildOrder Assistant</span>
        </div>
        <button id="bo-close" aria-label="Close chat">&#x2715;</button>
      </div>
      <div id="bo-msgs">
        <div class="bo-msg bo-bot">${isES ? '¡Hola! Puedo ayudarte a generar documentos, responder preguntas sobre precios, o explicar cómo funciona BuildOrder. ¿Qué necesitas?' : 'Hey! I can help you generate documents, answer pricing questions, or explain how BuildOrder works. What do you need?'}</div>
      </div>
      <div id="bo-chips">
        <button class="bo-chip" data-q="${isES ? '¿Qué documentos puedo generar?' : 'What documents can I generate?'}">${isES ? '¿Qué docs puedo hacer?' : 'What docs can I make?'}</button>
        <button class="bo-chip" data-q="${isES ? '¿Cuánto cuesta BuildOrder?' : 'What does BuildOrder cost?'}">${isES ? 'Precios' : 'Pricing'}</button>
        <button class="bo-chip" data-q="${isES ? 'Cuéntame sobre la oferta de miembro fundador' : 'Tell me about the founding member offer'}">${isES ? 'Oferta de miembro fundador' : 'Founding member deal'}</button>
        <button class="bo-chip" data-q="${isES ? '¿Los documentos cumplen con las leyes estatales?' : 'Are documents state-compliant?'}">${isES ? 'Cumplimiento estatal' : 'State compliance'}</button>
      </div>
      <div id="bo-input-row">
        <input id="bo-input" type="text" placeholder="${isES ? 'Pregunta lo que quieras...' : 'Ask anything...'}" autocomplete="off" />
        <button id="bo-send" aria-label="Send">&#x27A4;</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const bubble = document.getElementById('bo-bubble');
  const win = document.getElementById('bo-window');
  const closeBtn = document.getElementById('bo-close');
  const msgs = document.getElementById('bo-msgs');
  const inputEl = document.getElementById('bo-input');
  const sendBtn = document.getElementById('bo-send');

  bubble.addEventListener('click', () => {
    const open = win.style.display === 'flex';
    win.style.display = open ? 'none' : 'flex';
  });
  closeBtn.addEventListener('click', () => { win.style.display = 'none'; });

  document.querySelectorAll('.bo-chip').forEach(chip => {
    chip.addEventListener('click', () => { inputEl.value = chip.dataset.q; send(); });
  });

  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  sendBtn.addEventListener('click', send);

  const SYSTEM = `If the user writes in Spanish or the page URL contains ?lang=es or the <html> tag has lang="es", respond entirely in Spanish. Otherwise respond in English.

You are the BuildOrder.ai support assistant. BuildOrder is an AI-powered document generation platform built for residential contractors. Be concise, friendly, and plain-spoken — contractors are busy people.

DOCUMENTS (7 types, available for all 52 US states):
- Estimates: professional itemized quotes with labor and materials
- Contracts: state-compliant job agreements with scope of work
- Invoices: payment requests tied to completed work
- Change Orders: documented scope and price changes mid-job
- Lien Waivers: protect both contractor and homeowner at payment
- Notice to Proceed: official document authorizing work to start
- Punch Lists: end-of-job completion checklists

PRICING:
- Free plan: 3 documents per month, watermarked
- Pro plan: $19/month — unlimited documents, no watermark, e-signature with full audit trail, state compliance checks
- Annual Pro: $190/year (saves roughly 17%)

FOUNDING MEMBER OFFER (LIMITED TIME):
- 60 days of free Pro access
- No credit card required
- Available now at buildorder.ai
- For contractors who sign up during the launch window

STATE COMPLIANCE:
- All documents are compliant with laws across all 52 US states and territories
- Lien waiver language is state-specific
- Contracts include required disclosures per state law

E-SIGNATURE:
- Built-in e-signature with a full audit trail
- Legally binding
- This is BuildOrder's primary differentiator

HOW IT WORKS:
1. Choose your document type
2. Enter job details (client name, scope, dollar amounts)
3. AI generates a professional, compliant document in seconds
4. Send for e-signature or download as a PDF

Always encourage visitors to try the free plan or grab the founding member offer while it lasts.`;

  let history = [];

  function addMsg(text, role) {
    const div = document.createElement('div');
    div.className = 'bo-msg ' + (role === 'user' ? 'bo-user' : 'bo-bot');
    if (role === 'typing') div.classList.add('bo-typing');
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    addMsg(text, 'user');
    const typing = addMsg('Typing...', 'typing');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: SYSTEM, messages: [...history, { role: 'user', content: text }] })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response. Please try again.";
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: reply });
      typing.textContent = reply;
      typing.classList.remove('bo-typing');
    } catch (e) {
      typing.textContent = 'Something went wrong. Please try again.';
      typing.classList.remove('bo-typing');
    }
  }
})();
