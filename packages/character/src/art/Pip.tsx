import type { ArtProps } from "../types";

/** Pip, ported from the UXie design canvas. All coordinates use a 300x340 viewBox. */
export function Pip({ c, u }: ArtProps) {
  return (
    <svg
      viewBox="0 0 300 340"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`pb-${u}`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.light}></stop>
          <stop offset="0.55" stopColor={c.base}></stop>
          <stop offset="1" stopColor={c.dark}></stop>
        </radialGradient>
        <radialGradient id={`pt-${u}`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.bellyLight}></stop>
          <stop offset="0.6" stopColor={c.belly}></stop>
          <stop offset="1" stopColor={c.bellyDark}></stop>
        </radialGradient>
        <radialGradient id={`pi-${u}`} cx="0.5" cy="0.78" r="0.75">
          <stop offset="0" stopColor="#9A6644"></stop>
          <stop offset="0.6" stopColor="#5A3626"></stop>
          <stop offset="1" stopColor="#3A2218"></stop>
        </radialGradient>
        <filter id={`ps-${u}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6"></feGaussianBlur>
        </filter>
        <filter id={`pc-${u}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5"></feGaussianBlur>
        </filter>
        <clipPath id={`pe1-${u}`}>
          <ellipse cx="105" cy="158" rx="25" ry="29"></ellipse>
        </clipPath>
        <clipPath id={`pe2-${u}`}>
          <ellipse cx="180" cy="172" rx="25" ry="29"></ellipse>
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
        <ellipse cx="122" cy="306" rx="24" ry="15" fill={`url(#pt-${u})`}></ellipse>
        <ellipse cx="178" cy="306" rx="24" ry="15" fill={`url(#pt-${u})`}></ellipse>
        <g className="ux-armO ux-a dirR" style={{ transformOrigin: "186px 256px" }}>
          <ellipse
            cx="196"
            cy="272"
            rx="12"
            ry="20"
            transform="rotate(-25 196 272)"
            fill={`url(#pt-${u})`}
          ></ellipse>
        </g>
        <ellipse cx="150" cy="270" rx="48" ry="40" fill={`url(#pt-${u})`}></ellipse>
        <g className="ux-head ux-a" style={{ transformOrigin: "150px 244px" }}>
          <g className="ux-tuft ux-a dirR" style={{ transformOrigin: "200px 44px" }}>
            <path
              d="M194 40 C 196 22 212 10 228 14 C 240 17 240 31 228 32 C 218 33 212 38 210 50 Z"
              fill={`url(#pb-${u})`}
            ></path>
          </g>
          <path
            d="M200 30 C 214 52 240 80 254 118 C 270 165 255 212 220 232 C 188 250 112 250 78 232 C 44 212 32 168 46 128 C 62 86 120 62 168 46 C 182 41 194 36 200 30 Z"
            fill={`url(#pb-${u})`}
          ></path>
          <ellipse
            cx="108"
            cy="96"
            rx="38"
            ry="20"
            transform="rotate(-28 108 96)"
            fill="#FFFFFF"
            opacity="0.4"
            filter={`url(#ps-${u})`}
          ></ellipse>
          <ellipse
            cx="70"
            cy="196"
            rx="17"
            ry="11"
            fill={c.cheek}
            opacity="0.6"
            filter={`url(#pc-${u})`}
          ></ellipse>
          <ellipse
            cx="210"
            cy="212"
            rx="18"
            ry="11"
            fill={c.cheek}
            opacity="0.6"
            filter={`url(#pc-${u})`}
          ></ellipse>
          <g className="ux-brows ux-f">
            <path
              d="M90 118 Q 104 110 118 116"
              fill="none"
              stroke="#5A3626"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.75"
            ></path>
            <path
              d="M168 132 Q 182 124 196 130"
              fill="none"
              stroke="#5A3626"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.75"
            ></path>
          </g>
          <g className="ux-eye ux-a" style={{ transformOrigin: "105px 158px" }}>
            <ellipse cx="105" cy="158" rx="25" ry="29" fill="#FFFFFF"></ellipse>
            <g clipPath={`url(#pe1-${u})`}>
              <g className="ux-look">
                <ellipse cx="107" cy="162" rx="20" ry="24" fill={`url(#pi-${u})`}></ellipse>
                <ellipse cx="108" cy="164" rx="10" ry="12" fill="#1E120C"></ellipse>
                <circle cx="100" cy="152" r="7" fill="#FFFFFF"></circle>
                <circle cx="115" cy="172" r="3" fill="#FFFFFF" opacity="0.9"></circle>
              </g>
            </g>
            <path
              d="M81 150 C 86 129 124 127 130 149"
              fill="none"
              stroke="#3A2218"
              strokeWidth="3"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-eye ux-a" style={{ transformOrigin: "180px 172px" }}>
            <ellipse cx="180" cy="172" rx="25" ry="29" fill="#FFFFFF"></ellipse>
            <g clipPath={`url(#pe2-${u})`}>
              <g className="ux-look">
                <ellipse cx="182" cy="176" rx="20" ry="24" fill={`url(#pi-${u})`}></ellipse>
                <ellipse cx="183" cy="178" rx="10" ry="12" fill="#1E120C"></ellipse>
                <circle cx="175" cy="166" r="7" fill="#FFFFFF"></circle>
                <circle cx="190" cy="186" r="3" fill="#FFFFFF" opacity="0.9"></circle>
              </g>
            </g>
            <path
              d="M156 164 C 161 143 199 141 205 163"
              fill="none"
              stroke="#3A2218"
              strokeWidth="3"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-m-idle">
            <path d="M124 198 Q 139 218 156 200 Q 140 204 124 198 Z" fill="#6B2B2B"></path>
            <path d="M132 208 Q 140 214 148 208 Q 140 204 132 208 Z" fill="#F08C8C"></path>
          </g>
          <g className="ux-m-open">
            <path d="M120 196 Q 139 228 162 198 Q 141 203 120 196 Z" fill="#6B2B2B"></path>
            <path d="M130 212 Q 141 220 152 211 Q 141 206 130 212 Z" fill="#F08C8C"></path>
          </g>
          <g className="ux-m-talk ux-f">
            <ellipse cx="140" cy="206" rx="11" ry="9" fill="#6B2B2B"></ellipse>
            <ellipse cx="140" cy="210" rx="6" ry="3" fill="#F08C8C"></ellipse>
          </g>
          <g className="ux-m-o">
            <ellipse cx="140" cy="206" rx="6" ry="7" fill="#6B2B2B"></ellipse>
          </g>
        </g>
        <g className="ux-armP ux-a dirL" style={{ transformOrigin: "108px 252px" }}>
          <ellipse
            cx="98"
            cy="262"
            rx="12"
            ry="20"
            transform="rotate(40 98 262)"
            fill={`url(#pt-${u})`}
          ></ellipse>
          <path d="M76 268 L 66 296 L 76 290 L 84 300 L 86 270 Z" fill={c.accentDark}></path>
          <path
            d="M44 210 C 42 182 92 178 94 206 C 95 226 74 228 76 252"
            fill="none"
            stroke={c.accent}
            strokeWidth="15"
            strokeLinecap="round"
          ></path>
          <path
            d="M50 200 C 52 188 70 185 80 192"
            fill="none"
            stroke={c.accentLight}
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.9"
          ></path>
          <ellipse cx="84" cy="262" rx="14" ry="13" fill={`url(#pt-${u})`}></ellipse>
        </g>
      </g>
      <g className="ux-fx ux-fx-think">
        <circle
          className="ux-dot d1 ux-f"
          cx="54"
          cy="86"
          r="4"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
        <circle
          className="ux-dot d2 ux-f"
          cx="40"
          cy="64"
          r="6"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
        <circle
          className="ux-dot d3 ux-f"
          cx="28"
          cy="38"
          r="8"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
      </g>
      <g className="ux-fx ux-fx-bulb">
        <g transform="translate(266 70)">
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
        <g transform="translate(36 96)">
          <path
            className="ux-spark s1 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill="#FFC94D"
          ></path>
        </g>
        <g transform="translate(266 112)">
          <path
            className="ux-spark s2 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill={c.accent}
          ></path>
        </g>
        <g transform="translate(260 268)">
          <path
            className="ux-spark s3 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill="#FFC94D"
          ></path>
        </g>
        <g transform="translate(30 270)">
          <path
            className="ux-spark s4 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill={c.accent}
          ></path>
        </g>
      </g>
      <g className="ux-fx ux-fx-q">
        <g transform="translate(264 72)">
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
