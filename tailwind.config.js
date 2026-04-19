/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './nl/**/*.html', './blog/**/*.html', './site.js'],
  theme: {
    extend: {
      colors: {
        bg:        '#eeece6',
        bg2:       '#e4e1d8',
        card:      '#f6f4ec',
        ink:       '#0d0d0d',
        ink2:      '#2a2a2a',
        muted:     '#5b5a51',
        line:      '#cfccc2',
        line2:     '#b5b2a6',
        accent:      '#a73118',
        'accent-warm':'#c4541e',
        'accent-glow':'rgba(196, 84, 30, 0.28)',
        highlight:   '#c47a18',
        ok:          '#2f7d48',
      },
      fontFamily: {
        display: ['Geist', 'Söhne', 'Inter', 'system-ui', 'sans-serif'],
        body:    ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        'display': '-0.02em',
        'brand':   '-0.04em',
      },
      borderRadius: {
        'xs': '2px',
      },
      maxWidth: {
        'prose-62': '62ch',
        'shell':    '1240px',
      },
      fontSize: {
        'mono-xs':  ['10px', { lineHeight: '1.2' }],
        'mono-sm':  ['11px', { lineHeight: '1.4' }],
      },
      keyframes: {
        ticker: {
          from: { transform: 'translateX(0)' },
          to:   { transform: 'translateX(-100%)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { boxShadow: '0 0 0 0 var(--accent-glow)', transform: 'scale(1)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(224,99,42,0)',  transform: 'scale(1.12)' },
        },
        'pulse-ok': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(58,157,90,.45)', transform: 'scale(1)' },
          '50%':      { boxShadow: '0 0 0 5px rgba(58,157,90,0)',  transform: 'scale(1.1)' },
        },
        'underline': {
          '0%':   { transform: 'scaleX(0)', transformOrigin: 'left' },
          '100%': { transform: 'scaleX(1)', transformOrigin: 'left' },
        },
      },
      animation: {
        ticker:     'ticker 60s linear infinite',
        'fade-up':  'fade-up 0.6s cubic-bezier(.2,.8,.2,1) both',
        'pulse-dot':'pulse-dot 2.4s cubic-bezier(.4,0,.6,1) infinite',
        'pulse-ok': 'pulse-ok 2.4s cubic-bezier(.4,0,.6,1) infinite',
      },
      transitionTimingFunction: {
        'soft': 'cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  corePlugins: {
    container: false,
  },
  plugins: [],
};
