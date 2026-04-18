/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './nl/**/*.html', './site.js'],
  theme: {
    extend: {
      colors: {
        bg:        '#eeece6',
        bg2:       '#e4e1d8',
        card:      '#f6f4ec',
        ink:       '#0d0d0d',
        ink2:      '#2a2a2a',
        muted:     '#6b6a63',
        line:      '#cfccc2',
        line2:     '#b5b2a6',
        accent:    '#c23d1f',
        highlight: '#e8a23a',
        ok:        '#3a9d5a',
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
      },
      animation: {
        ticker: 'ticker 60s linear infinite',
      },
    },
  },
  corePlugins: {
    container: false,
  },
  plugins: [],
};
