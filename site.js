// Pier site — Drydock. Playbook tabs + FAQ accordion.

(function () {
  // ---------- Playbook tabs ----------
  const tabs  = document.querySelectorAll('.pb-tab');
  const panes = document.querySelectorAll('.pb-pane');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('aria-controls');
      tabs.forEach((t)  => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
      panes.forEach((p) => {
        const on = p.id === targetId;
        p.hidden = !on;
      });
    });
  });

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-item').forEach((item) => {
    const btn  = item.querySelector('.faq-trigger');
    const mark = item.querySelector('.faq-mark');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (mark) mark.textContent = open ? '−' : '+';
    });
  });
})();
