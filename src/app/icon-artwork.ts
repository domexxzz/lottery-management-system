export const appIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="ระบบจัดการหวย">
  <defs>
    <linearGradient id="background" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#123c5d"/>
      <stop offset="1" stop-color="#06253f"/>
    </linearGradient>
    <linearGradient id="mark" x1="19" y1="17" x2="45" y2="47" gradientUnits="userSpaceOnUse">
      <stop stop-color="#70eee1"/>
      <stop offset="1" stop-color="#22bfc6"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#background)"/>
  <rect x="3" y="3" width="58" height="58" rx="16" fill="none" stroke="#4bd9d6" stroke-opacity=".35" stroke-width="2"/>
  <g fill="url(#mark)">
    <rect x="25" y="10" width="14" height="29" rx="7" transform="rotate(45 32 32)"/>
    <rect x="25" y="25" width="14" height="29" rx="7" transform="rotate(45 32 32)"/>
    <rect x="25" y="10" width="14" height="29" rx="7" transform="rotate(-45 32 32)"/>
    <rect x="25" y="25" width="14" height="29" rx="7" transform="rotate(-45 32 32)"/>
  </g>
  <circle cx="32" cy="32" r="5" fill="#eaffff"/>
</svg>`.trim();

