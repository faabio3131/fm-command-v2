export function CommandBrainLogo({
  className = "",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 720 720"
      role="img"
      aria-label="FM Command Core"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="command-orb" cx="42%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#143d8d" stopOpacity=".96" />
          <stop offset="42%" stopColor="#071a52" stopOpacity=".94" />
          <stop offset="76%" stopColor="#03091f" stopOpacity=".98" />
          <stop offset="100%" stopColor="#01040d" stopOpacity="1" />
        </radialGradient>
        <linearGradient id="command-neural" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00e5ff" />
          <stop offset="46%" stopColor="#2f7cff" />
          <stop offset="78%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#f052ff" />
        </linearGradient>
        <linearGradient id="command-word" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7ee7ff" />
          <stop offset="48%" stopColor="#3d8cff" />
          <stop offset="100%" stopColor="#bd65ff" />
        </linearGradient>
        <filter id="command-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="command-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g transform="translate(0 -22)">
        <circle cx="360" cy="325" r="238" fill="url(#command-orb)" stroke="#2d7cff" strokeWidth="3" />
        <circle cx="360" cy="325" r="253" fill="none" stroke="#00d9ff" strokeOpacity=".46" strokeWidth="2" />
        <circle cx="360" cy="325" r="271" fill="none" stroke="#7b61ff" strokeOpacity=".25" strokeWidth="2" strokeDasharray="4 11" />

        <g opacity=".76" fill="none" strokeLinecap="round">
          <ellipse cx="360" cy="325" rx="288" ry="112" stroke="#00d9ff" strokeWidth="2.4" transform="rotate(-12 360 325)" />
          <ellipse cx="360" cy="325" rx="278" ry="130" stroke="#765dff" strokeWidth="2" transform="rotate(25 360 325)" />
          <ellipse cx="360" cy="325" rx="263" ry="150" stroke="#2e85ff" strokeWidth="1.6" transform="rotate(-34 360 325)" />
        </g>

        <g fill="#7feaff" filter="url(#command-soft-glow)">
          <circle cx="99" cy="324" r="7" />
          <circle cx="599" cy="205" r="6" />
          <circle cx="607" cy="443" r="7" />
          <circle cx="190" cy="471" r="6" />
          <circle cx="483" cy="104" r="5" />
        </g>

        <g
          fill="none"
          stroke="url(#command-neural)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#command-glow)"
        >
          <path d="M351 181c-40-37-104-25-122 20-44-4-76 34-63 75-38 22-43 78-9 106-17 43 14 88 58 87 11 50 69 67 108 37 17 16 27 31 28 54" />
          <path d="M369 181c40-37 104-25 122 20 44-4 76 34 63 75 38 22 43 78 9 106 17 43-14 88-58 87-11 50-69 67-108 37-17 16-27 31-28 54" />
          <path d="M350 188v335" />
          <path d="M370 188v335" />

          <path d="M252 223c-2 31 17 48 43 54-27 9-44 31-44 59 0 22 11 40 31 50-26 8-40 28-38 54" />
          <path d="M468 223c2 31-17 48-43 54 27 9 44 31 44 59 0 22-11 40-31 50 26 8 40 28 38 54" />

          <path d="M200 292c30-8 54 5 66 28" />
          <path d="M520 292c-30-8-54 5-66 28" />
          <path d="M190 374c35-3 62 12 76 40" />
          <path d="M530 374c-35-3-62 12-76 40" />
          <path d="M225 456c31-2 57 10 77 34" />
          <path d="M495 456c-31-2-57 10-77 34" />
        </g>

        <g fill="#f8fbff" stroke="#0bdfff" strokeWidth="4" filter="url(#command-soft-glow)">
          <circle cx="292" cy="276" r="8" />
          <circle cx="428" cy="276" r="8" />
          <circle cx="252" cy="346" r="8" />
          <circle cx="468" cy="346" r="8" />
          <circle cx="302" cy="411" r="8" />
          <circle cx="418" cy="411" r="8" />
          <circle cx="326" cy="472" r="8" />
          <circle cx="394" cy="472" r="8" />
        </g>

        <g opacity=".92" fill="none" stroke="#75e9ff" strokeWidth="3" strokeLinecap="round">
          <path d="M292 276l34 27 24 0" />
          <path d="M428 276l-34 27h-24" />
          <path d="M252 346l40 25 58 0" />
          <path d="M468 346l-40 25h-58" />
          <path d="M302 411l27 20 21 0" />
          <path d="M418 411l-27 20h-21" />
        </g>

        <g textAnchor="middle">
          <text x="360" y="346" fill="#f7fbff" fontSize="78" fontWeight="900" letterSpacing="-5" filter="url(#command-soft-glow)">
            FM
          </text>
          <text x="360" y="391" fill="#9fc8ff" fontSize="19" fontWeight="800" letterSpacing="9">
            CORE IA
          </text>
        </g>

        <g transform="translate(126 583)">
          <rect width="468" height="84" rx="34" fill="#030917" fillOpacity=".94" stroke="#2d7cff" strokeWidth="2" />
          <rect x="1.5" y="1.5" width="465" height="81" rx="32" fill="none" stroke="#00d9ff" strokeOpacity=".25" />
          <text x="234" y="56" textAnchor="middle" fill="url(#command-word)" fontSize="44" fontWeight="900" letterSpacing="9">
            COMMAND
          </text>
        </g>
      </g>
    </svg>
  );
}
