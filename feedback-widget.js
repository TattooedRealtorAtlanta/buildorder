(function () {
  'use strict';

  function init() {
    // Inject styles
    var style = document.createElement('style');
    style.textContent = [
      '#bo-fb-btn{position:fixed;bottom:1.5rem;left:1.5rem;z-index:9000;display:flex;align-items:center;gap:0.45rem;background:#1A2438;border:1px solid rgba(255,255,255,0.1);border-radius:100px;padding:0.5rem 1rem;font-size:0.78rem;font-weight:700;color:#94A3B8;cursor:pointer;font-family:Inter,sans-serif;transition:all 0.2s;box-shadow:0 4px 16px rgba(0,0,0,0.4);}',
      '#bo-fb-btn:hover{color:#F8FAFC;border-color:rgba(245,158,11,0.4);background:#111827;}',
      '#bo-fb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9100;align-items:flex-end;justify-content:flex-start;padding:0 0 5.5rem 1.5rem;}',
      '#bo-fb-overlay.open{display:flex;}',
      '#bo-fb-box{background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:1.5rem;width:340px;max-width:calc(100vw - 3rem);font-family:Inter,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);}',
      '#bo-fb-box h3{font-size:0.95rem;font-weight:800;color:#F8FAFC;margin:0 0 0.25rem;}',
      '#bo-fb-box p{font-size:0.75rem;color:#64748B;margin:0 0 1rem;}',
      '.bo-fb-cats{display:flex;gap:0.4rem;margin-bottom:1rem;flex-wrap:wrap;}',
      '.bo-fb-cat{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:100px;padding:0.3rem 0.8rem;font-size:0.72rem;font-weight:700;color:#94A3B8;cursor:pointer;font-family:inherit;transition:all 0.15s;}',
      '.bo-fb-cat:hover{color:#F8FAFC;}',
      '.bo-fb-cat.active{background:rgba(245,158,11,0.12);color:#F59E0B;border-color:rgba(245,158,11,0.4);}',
      '#bo-fb-msg{width:100%;background:#1A2438;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0.65rem 0.85rem;font-size:0.83rem;color:#F8FAFC;font-family:inherit;outline:none;resize:none;min-height:90px;line-height:1.55;transition:border-color 0.15s;box-sizing:border-box;}',
      '#bo-fb-msg:focus{border-color:#F59E0B;}',
      '#bo-fb-msg::placeholder{color:#475569;}',
      '.bo-fb-footer{display:flex;align-items:center;justify-content:space-between;margin-top:0.85rem;}',
      '#bo-fb-cancel{background:none;border:none;font-size:0.78rem;color:#475569;cursor:pointer;font-family:inherit;padding:0;}',
      '#bo-fb-cancel:hover{color:#94A3B8;}',
      '#bo-fb-submit{background:#F59E0B;color:#090E1A;border:none;border-radius:8px;padding:0.5rem 1.25rem;font-size:0.82rem;font-weight:900;cursor:pointer;font-family:inherit;transition:background 0.15s;}',
      '#bo-fb-submit:hover{background:#FCD34D;}',
      '#bo-fb-submit:disabled{opacity:0.5;cursor:not-allowed;}',
      '#bo-fb-success{display:none;text-align:center;padding:1rem 0;}',
      '#bo-fb-success .ico{font-size:2rem;margin-bottom:0.5rem;}',
      '#bo-fb-success p{font-size:0.85rem;color:#94A3B8;margin:0;}',
      '#bo-fb-success strong{color:#F8FAFC;}',
    ].join('');
    document.head.appendChild(style);

    // Inject HTML
    var html = [
      '<button id="bo-fb-btn" onclick="window._boFbOpen()">',
      '  <span style="font-size:1rem;">&#128172;</span> Feedback',
      '</button>',
      '<div id="bo-fb-overlay">',
      '  <div id="bo-fb-box">',
      '    <div id="bo-fb-form">',
      '      <h3>Send Feedback</h3>',
      '      <p>Report a bug, request a feature, or just tell us what you think.</p>',
      '      <div class="bo-fb-cats">',
      '        <button class="bo-fb-cat active" data-cat="general">&#128172; General</button>',
      '        <button class="bo-fb-cat" data-cat="bug">&#128027; Bug Report</button>',
      '        <button class="bo-fb-cat" data-cat="feature">&#10024; Feature Request</button>',
      '      </div>',
      '      <textarea id="bo-fb-msg" placeholder="What\'s on your mind?"></textarea>',
      '      <div class="bo-fb-footer">',
      '        <button id="bo-fb-cancel" onclick="window._boFbClose()">Cancel</button>',
      '        <button id="bo-fb-submit" onclick="window._boFbSubmit()">Send &#8594;</button>',
      '      </div>',
      '    </div>',
      '    <div id="bo-fb-success">',
      '      <div class="ico">&#10003;</div>',
      '      <strong>Got it — thank you!</strong>',
      '      <p style="margin-top:0.35rem;">We read every piece of feedback.</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('');
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);

    // Category selection
    document.querySelectorAll('.bo-fb-cat').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.bo-fb-cat').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
      });
    });

    // Close on overlay click
    document.getElementById('bo-fb-overlay').addEventListener('click', function(e) {
      if (e.target === this) window._boFbClose();
    });
  }

  window._boFbOpen = function() {
    var overlay = document.getElementById('bo-fb-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    document.getElementById('bo-fb-form').style.display = 'block';
    document.getElementById('bo-fb-success').style.display = 'none';
    document.getElementById('bo-fb-msg').value = '';
    document.getElementById('bo-fb-msg').focus();
  };

  window._boFbClose = function() {
    var overlay = document.getElementById('bo-fb-overlay');
    if (overlay) overlay.classList.remove('open');
  };

  window._boFbSubmit = async function() {
    var msg = (document.getElementById('bo-fb-msg').value || '').trim();
    if (!msg) { document.getElementById('bo-fb-msg').focus(); return; }

    var activeBtn = document.querySelector('.bo-fb-cat.active');
    var category = activeBtn ? activeBtn.getAttribute('data-cat') : 'general';

    var submitBtn = document.getElementById('bo-fb-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    // Get auth token from page's db instance if available
    var token = '';
    try {
      if (window.db && window.db.auth) {
        var s = await window.db.auth.getSession();
        if (s.data && s.data.session) token = s.data.session.access_token;
      }
    } catch(e) {}

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      await fetch('/api/feedback', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          category:  category,
          message:   msg,
          page_url:  window.location.pathname
        })
      });

      document.getElementById('bo-fb-form').style.display = 'none';
      document.getElementById('bo-fb-success').style.display = 'block';
      setTimeout(window._boFbClose, 2200);
    } catch(e) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send →';
      alert('Could not send feedback. Please try again.');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
