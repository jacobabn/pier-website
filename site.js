// Waitlist CTA → mailto
  document.querySelectorAll('a[href="#download"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const email = prompt('Pier launches November 2026.\n\nDrop your email for early access + 50% launch discount:');
      if (email && email.includes('@')) {
        location.href = 'mailto:hello@pier.abn.company?subject=Pier%20waitlist&body=' + encodeURIComponent('Add me to the Pier waitlist: ' + email);
      }
    });
  });

  // Sticky nav scroll-state — adds shadow + deeper bg after scroll
  const nav = document.querySelector('nav.top');
  if (nav) {
    let last = 0;
    const onScroll = () => {
      const y = window.scrollY;
      if ((y > 8) !== (last > 8)) nav.classList.toggle('scrolled', y > 8);
      last = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Scroll reveal
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
