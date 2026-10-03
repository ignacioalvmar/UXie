import type { ArtProps } from "../types";

/** Luma, ported from the UXie design canvas. All coordinates use a 300x340 viewBox. */
export function Luma({ c, u }: ArtProps) {
  return (
    <svg
      viewBox="0 0 300 340"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`lb-${u}`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.light}></stop>
          <stop offset="0.55" stopColor={c.base}></stop>
          <stop offset="1" stopColor={c.dark}></stop>
        </radialGradient>
        <radialGradient id={`lt-${u}`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.bellyLight}></stop>
          <stop offset="0.6" stopColor={c.belly}></stop>
          <stop offset="1" stopColor={c.bellyDark}></stop>
        </radialGradient>
        <radialGradient id={`lf-${u}`} cx="0.3" cy="0.3" r="0.9">
          <stop offset="0" stopColor={c.leafLight}></stop>
          <stop offset="0.6" stopColor={c.leaf}></stop>
          <stop offset="1" stopColor={c.leafDark}></stop>
        </radialGradient>
        <radialGradient id={`li-${u}`} cx="0.5" cy="0.78" r="0.75">
          <stop offset="0" stopColor="#9A6644"></stop>
          <stop offset="0.6" stopColor="#5A3626"></stop>
          <stop offset="1" stopColor="#3A2218"></stop>
        </radialGradient>
        <filter id={`ls-${u}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6"></feGaussianBlur>
        </filter>
        <filter id={`lc-${u}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5"></feGaussianBlur>
        </filter>
        <clipPath id={`le1-${u}`}>
          <ellipse cx="118" cy="166" rx="24" ry="28"></ellipse>
        </clipPath>
        <clipPath id={`le2-${u}`}>
          <ellipse cx="196" cy="176" rx="23" ry="27"></ellipse>
        </clipPath>
      </defs>
      <ellipse
        className="ux-shadow ux-f"
        cx="150"
        cy="322"
        rx="72"
        ry="10"
        fill="#1F2430"
        opacity="0.12"
      ></ellipse>
      <g className="ux-root ux-a" style={{ transformOrigin: "150px 320px" }}>
        <ellipse cx="126" cy="308" rx="22" ry="14" fill={`url(#lt-${u})`}></ellipse>
        <ellipse cx="174" cy="308" rx="22" ry="14" fill={`url(#lt-${u})`}></ellipse>
        <g className="ux-armO ux-a dirL" style={{ transformOrigin: "116px 258px" }}>
          <ellipse
            cx="100"
            cy="258"
            rx="12"
            ry="21"
            transform="rotate(55 100 258)"
            fill={`url(#lt-${u})`}
          ></ellipse>
          <circle cx="86" cy="250" r="12.5" fill={`url(#lt-${u})`}></circle>
        </g>
        <ellipse cx="150" cy="272" rx="48" ry="40" fill={`url(#lt-${u})`}></ellipse>
        <g className="ux-head ux-a" style={{ transformOrigin: "152px 236px" }}>
          <g className="ux-tuft ux-a dirL" style={{ transformOrigin: "152px 62px" }}>
            <path
              d="M150 64 C 150 52 152 44 156 38"
              fill="none"
              stroke={c.leafDark}
              strokeWidth="5"
              strokeLinecap="round"
            ></path>
            <path
              d="M150 60 C 124 56 98 36 104 14 C 112 4 132 10 142 26 C 150 38 152 50 150 60 Z"
              fill={`url(#lf-${u})`}
            ></path>
            <path
              d="M154 56 C 168 30 204 14 238 22 C 258 28 254 48 236 56 C 212 66 180 64 154 56 Z"
              fill={`url(#lf-${u})`}
            ></path>
            <path
              d="M160 52 C 186 40 214 36 238 36"
              fill="none"
              stroke={c.leafLight}
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.7"
            ></path>
          </g>
          <path
            d="M46 150 C 42 92 92 58 152 58 C 214 58 262 94 258 152 C 254 204 212 236 152 236 C 92 236 50 204 46 150 Z"
            fill={`url(#lb-${u})`}
          ></path>
          <ellipse
            cx="104"
            cy="100"
            rx="40"
            ry="20"
            transform="rotate(-26 104 100)"
            fill="#FFFFFF"
            opacity="0.4"
            filter={`url(#ls-${u})`}
          ></ellipse>
          <ellipse
            cx="86"
            cy="198"
            rx="18"
            ry="11"
            fill={c.cheek}
            opacity="0.6"
            filter={`url(#lc-${u})`}
          ></ellipse>
          <ellipse
            cx="230"
            cy="206"
            rx="15"
            ry="10"
            fill={c.cheek}
            opacity="0.6"
            filter={`url(#lc-${u})`}
          ></ellipse>
          <g className="ux-brows ux-f">
            <path
              d="M100 122 Q 114 114 128 120"
              fill="none"
              stroke="#3E5A2E"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.7"
            ></path>
            <path
              d="M180 134 Q 194 127 208 133"
              fill="none"
              stroke="#3E5A2E"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.7"
            ></path>
          </g>
          <g className="ux-eye ux-a" style={{ transformOrigin: "118px 166px" }}>
            <ellipse cx="118" cy="166" rx="24" ry="28" fill="#FFFFFF"></ellipse>
            <g clipPath={`url(#le1-${u})`}>
              <g className="ux-look">
                <ellipse cx="121" cy="169" rx="20" ry="24" fill={`url(#li-${u})`}></ellipse>
                <ellipse cx="122" cy="171" rx="10" ry="12" fill="#1E120C"></ellipse>
                <circle cx="113" cy="159" r="6.5" fill="#FFFFFF"></circle>
                <circle cx="129" cy="179" r="3" fill="#FFFFFF" opacity="0.9"></circle>
              </g>
            </g>
            <path
              d="M95 160 C 99 139 137 137 142 158"
              fill="none"
              stroke="#3A2218"
              strokeWidth="3"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-eye ux-a" style={{ transformOrigin: "196px 176px" }}>
            <ellipse cx="196" cy="176" rx="23" ry="27" fill="#FFFFFF"></ellipse>
            <g clipPath={`url(#le2-${u})`}>
              <g className="ux-look">
                <ellipse cx="199" cy="179" rx="19" ry="23" fill={`url(#li-${u})`}></ellipse>
                <ellipse cx="200" cy="181" rx="9.5" ry="11.5" fill="#1E120C"></ellipse>
                <circle cx="191" cy="169" r="6.5" fill="#FFFFFF"></circle>
                <circle cx="207" cy="189" r="3" fill="#FFFFFF" opacity="0.9"></circle>
              </g>
            </g>
            <path
              d="M174 170 C 178 150 214 148 219 168"
              fill="none"
              stroke="#3A2218"
              strokeWidth="3"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-m-idle">
            <path d="M148 202 Q 158 216 170 203 Q 159 206 148 202 Z" fill="#6B2B2B"></path>
            <path d="M153 209 Q 159 213 165 209 Q 159 206 153 209 Z" fill="#F08C8C"></path>
          </g>
          <g className="ux-m-open">
            <path d="M144 200 Q 158 224 174 201 Q 159 205 144 200 Z" fill="#6B2B2B"></path>
            <path d="M151 212 Q 159 218 167 212 Q 159 208 151 212 Z" fill="#F08C8C"></path>
          </g>
          <g className="ux-m-talk ux-f">
            <ellipse cx="159" cy="208" rx="9" ry="8" fill="#6B2B2B"></ellipse>
            <ellipse cx="159" cy="212" rx="5" ry="2.6" fill="#F08C8C"></ellipse>
          </g>
          <g className="ux-m-o">
            <ellipse cx="159" cy="208" rx="5" ry="6" fill="#6B2B2B"></ellipse>
          </g>
        </g>
        <g className="ux-armP ux-a dirR" style={{ transformOrigin: "186px 262px" }}>
          <ellipse
            cx="196"
            cy="268"
            rx="12"
            ry="20"
            transform="rotate(-35 196 268)"
            fill={`url(#lt-${u})`}
          ></ellipse>
          <path
            d="M206 260 L 230 236"
            stroke={c.accentDark}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
          ></path>
          <circle
            cx="248"
            cy="216"
            r="27"
            fill="#EAF4FA"
            fillOpacity="0.6"
            stroke={c.accent}
            strokeWidth="9"
          ></circle>
          <circle
            cx="248"
            cy="216"
            r="22.5"
            fill="none"
            stroke={c.accentDark}
            strokeWidth="1.5"
            opacity="0.4"
          ></circle>
          <path
            d="M232 210 Q 236 196 250 193"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.85"
          ></path>
          <circle cx="206" cy="260" r="13.5" fill={`url(#lt-${u})`}></circle>
        </g>
      </g>
      <g className="ux-fx ux-fx-think">
        <circle
          className="ux-dot d1 ux-f"
          cx="62"
          cy="86"
          r="4"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
        <circle
          className="ux-dot d2 ux-f"
          cx="46"
          cy="64"
          r="6"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
        <circle
          className="ux-dot d3 ux-f"
          cx="34"
          cy="38"
          r="8"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
      </g>
      <g className="ux-fx ux-fx-bulb">
        <g transform="translate(58 64)">
          <g className="ux-bulb ux-f">
            <path
              d="M-20 -6 L-26 -8 M20 -6 L26 -8 M0 -22 L0 -28 M-14 -18 L-18 -23 M14 -18 L18 -23"
              stroke="#F2B53A"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            ></path>
            <circle cx="0" cy="-6" r="13" fill="#FFE38A" stroke="#E5A93B" strokeWidth="2"></circle>
            <rect x="-6" y="6" width="12" height="9" rx="2.5" fill="#9AA0AE"></rect>
          </g>
        </g>
      </g>
      <g className="ux-fx ux-fx-spark">
        <g transform="translate(28 128)">
          <path
            className="ux-spark s1 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill="#FFC94D"
          ></path>
        </g>
        <g transform="translate(276 96)">
          <path
            className="ux-spark s2 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill={c.accent}
          ></path>
        </g>
        <g transform="translate(272 286)">
          <path
            className="ux-spark s3 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill="#FFC94D"
          ></path>
        </g>
        <g transform="translate(34 292)">
          <path
            className="ux-spark s4 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill={c.leaf}
          ></path>
        </g>
      </g>
      <g className="ux-fx ux-fx-q">
        <g transform="translate(60 62)">
          <g className="ux-q ux-f">
            <path
              d="M-8 -12 C -8 -24 11 -24 11 -12 C 11 -4 2 -3 2 5"
              fill="none"
              stroke="#3B3F5C"
              strokeWidth="5"
              strokeLinecap="round"
            ></path>
            <circle cx="2" cy="15" r="3.4" fill="#3B3F5C"></circle>
          </g>
        </g>
      </g>
    </svg>
  );
}
