// Pier cookie banner — minimal, GDPR-compliant, zero deps.
//
// Two categories:
//   - "necessary"  — always on. Stripe checkout session + CSRF. No consent required.
//   - "analytics"  — opt-in only. We don't load Vercel Analytics or any third-party
//                    tracker until the user explicitly ticks the box.
//
// Consent lives in localStorage['pier_consent_v1'] as a JSON object:
//   { v: 1, analytics: true|false, ts: <epoch ms> }
//
// Banner shows on first visit (no stored consent). A small "Cookie settings" link
// in the footer re-opens it. Two buttons: "Accept all" and "Reject non-essential".
// No dark-pattern dual-tier mess — one of each, plain language.

(function () {
  const STORAGE_KEY = 'pier_consent_v1';
  const SCHEMA_VERSION = 1;

  function readConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === SCHEMA_VERSION) return parsed;
      return null;
    } catch { return null; }
  }
  function writeConsent(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: SCHEMA_VERSION, analytics: !!state.analytics, ts: Date.now(),
      }));
    } catch {}
  }

  // Expose a simple API so other scripts can check consent or trigger the banner.
  window.PierConsent = {
    get: readConsent,
    analyticsAllowed: () => {
      const c = readConsent();
      return !!(c && c.analytics);
    },
    showBanner: () => renderBanner(true),
  };

  // Analytics loader — only runs once consent is granted. Currently the site
  // uses Vercel Analytics (the <script src="/_vercel/insights/script.js"> loader).
  // We don't inject any tag until this fires.
  function loadAnalytics() {
    if (window.__pierAnalyticsLoaded) return;
    window.__pierAnalyticsLoaded = true;
    // Vercel Web Analytics standard loader
    const s = document.createElement('script');
    s.src = '/_vercel/insights/script.js';
    s.defer = true;
    s.dataset.endpoint = '/_vercel/insights';
    document.head.appendChild(s);
  }

  function renderBanner(force) {
    const existing = readConsent();
    if (existing && !force) {
      if (existing.analytics) loadAnalytics();
      return;
    }

    // Don't double-render
    if (document.getElementById('pier-cookie-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pier-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie preferences');
    banner.innerHTML = `
      <style>
        #pier-cookie-banner {
          position: fixed; bottom: 16px; left: 16px; right: 16px;
          max-width: 580px; margin: 0 auto;
          background: #0d0d0d; color: #eeece6;
          border: 1px solid #2a2620; border-radius: 10px;
          padding: 18px 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px; line-height: 1.55;
          box-shadow: 0 12px 40px rgba(0,0,0,0.4);
          z-index: 9999;
          animation: pier-consent-in 0.22s ease-out;
        }
        @keyframes pier-consent-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        #pier-cookie-banner h2 {
          font-family: ui-serif, "New York", Charter, Georgia, serif;
          font-size: 16px; font-weight: 500; margin: 0 0 6px;
          letter-spacing: -0.01em; color: #eeece6;
        }
        #pier-cookie-banner p { margin: 0 0 12px; color: #c9bfa8; }
        #pier-cookie-banner a { color: #eeece6; text-decoration: underline; text-decoration-color: rgba(238,236,230,0.4); }
        #pier-cookie-banner .pier-consent-row {
          display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px;
        }
        #pier-cookie-banner button {
          font: inherit;
          cursor: pointer;
          padding: 8px 16px;
          border-radius: 6px;
          border: 1px solid #2a2620;
          background: #1b1813;
          color: #eeece6;
          transition: background 0.12s, border-color 0.12s;
        }
        #pier-cookie-banner button:hover { background: #2a2620; border-color: #3d362d; }
        #pier-cookie-banner button.primary {
          background: #a73118;
          color: #ffffff;
          border-color: #a73118;
        }
        #pier-cookie-banner button.primary:hover { background: #c4541e; border-color: #c4541e; }
        #pier-cookie-banner .pier-consent-close {
          position: absolute; top: 10px; right: 12px;
          background: transparent; border: 0; color: #7b7163;
          padding: 4px 8px; font-size: 18px; line-height: 1;
        }
        @media (max-width: 520px) {
          #pier-cookie-banner { left: 8px; right: 8px; bottom: 8px; padding: 14px 16px; }
        }
      </style>
      <h2>Cookies</h2>
      <p>
        We only need a strictly-necessary cookie when you check out with Stripe. Anonymous
        analytics (to see which pages people read) are off by default. You can turn them
        on with one click — no dark-pattern nudging, and you can change your mind any time
        from the footer.
      </p>
      <p style="font-size:12px;color:#7b7163;">
        See our <a href="/legal/privacy">Privacy Policy</a> for the full list.
      </p>
      <div class="pier-consent-row">
        <button class="primary" data-choice="accept">Accept analytics</button>
        <button data-choice="reject">Only necessary</button>
      </div>
    `;

    banner.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-choice]');
      if (!btn) return;
      const accepting = btn.dataset.choice === 'accept';
      writeConsent({ analytics: accepting });
      if (accepting) loadAnalytics();
      banner.remove();
    });

    document.body.appendChild(banner);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderBanner(false));
  } else {
    renderBanner(false);
  }
})();
