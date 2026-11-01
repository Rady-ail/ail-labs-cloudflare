/* Same theme the pages used via the Tailwind Play CDN (cdn.tailwindcss.com), now compiled once.
   Rebuild after changing Tailwind classes:  npm run build:css  (index.html does not use Tailwind). */
module.exports = {
  content: [
    'public/catalog.html', 'public/about.html', 'public/contact.html', 'public/compliance.html',
    'public/procurement.html', 'public/private-label.html',
    'public/*.js', 'public/islands/*.js',
  ],
  theme: { extend: { colors: { ail: { teal: '#0F4C4A', ink: '#0A1F1E', gold: '#C6A87D', clinical: '#F5F7F6' } } } },
};
