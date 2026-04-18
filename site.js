/* Pier — interactive primitives.
 * Progressive enhancement: HTML is fully usable without JS.
 * No dependencies. Event-delegated. Keyboard-accessible.
 */
(() => {
  'use strict';

  /* ---------- Playbook tabs (WAI-ARIA tablist) ---------- */
  const tablists = document.querySelectorAll('[role="tablist"]');
  tablists.forEach((list) => {
    const tabs  = Array.from(list.querySelectorAll('[role="tab"]'));
    const panes = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));

    const activate = (tab) => {
      tabs.forEach((t, i) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (panes[i]) panes[i].hidden = !on;
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        activate(tab);
      });
    });

    list.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(document.activeElement);
      if (idx < 0) return;
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(idx + 1) % tabs.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(idx - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End')  next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
        activate(next);
      }
    });
  });

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach((item) => {
    const btn  = item.querySelector('.faq-trigger');
    const mark = item.querySelector('.faq-mark');
    if (!btn) return;

    const body   = item.querySelector('.faq-body');
    const bodyId = 'faq-body-' + Math.random().toString(36).slice(2, 9);
    if (body && !body.id) {
      body.id = bodyId;
      btn.setAttribute('aria-controls', bodyId);
    }

    btn.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      if (mark) mark.textContent = open ? '−' : '+';
    });
  });

  /* ---------- Scroll reveal ----------
   * Tag any element with class="reveal"; it fades up once it enters
   * the viewport. Uses IntersectionObserver, respects reduced-motion. */
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!rm && 'IntersectionObserver' in window) {
    const auto = document.querySelectorAll(
      '.grid-3 > .cell, .shortcut, .agents-row, .cmp-row, .finding, .pb-change, .faq-item, .db-list li'
    );
    auto.forEach((el) => el.classList.add('reveal'));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }

  /* ---------- Smooth anchor focus (accessibility) ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    setTimeout(() => {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }, 400);
  }, { passive: true });
})();
