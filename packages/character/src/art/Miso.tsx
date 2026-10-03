import type { ArtProps } from "../types";

/** Miso, ported from the UXie design canvas. All coordinates use a 300x340 viewBox. */
export function Miso({ c, u }: ArtProps) {
  return (
    <svg
      viewBox="0 0 300 340"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`mb-${u}`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.light}></stop>
          <stop offset="0.55" stopColor={c.base}></stop>
          <stop offset="1" stopColor={c.dark}></stop>
        </radialGradient>
        <radialGradient id={`ma-${u}`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor={c.accentLight}></stop>
          <stop offset="0.6" stopColor={c.accent}></stop>
          <stop offset="1" stopColor={c.accentMid}></stop>
        </radialGradient>
        <radialGradient id={`mi-${u}`} cx="0.5" cy="0.78" r="0.75">
          <stop offset="0" stopColor="#9A6644"></stop>
          <stop offset="0.6" stopColor="#5A3626"></stop>
          <stop offset="1" stopColor="#3A2218"></stop>
        </radialGradient>
        <filter id={`ms-${u}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6"></feGaussianBlur>
        </filter>
        <filter id={`mc-${u}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5"></feGaussianBlur>
        </filter>
        <clipPath id={`me1-${u}`}>
          <ellipse cx="155" cy="158" rx="22" ry="26"></ellipse>
        </clipPath>
        <clipPath id={`me2-${u}`}>
          <ellipse cx="243" cy="152" rx="20" ry="24"></ellipse>
        </clipPath>
      </defs>
      <ellipse
        className="ux-shadow ux-f"
        cx="178"
        cy="326"
        rx="76"
        ry="10"
        fill="#1F2430"
        opacity="0.12"
      ></ellipse>
      <g className="ux-root ux-a" style={{ transformOrigin: "178px 324px" }}>
        <ellipse cx="160" cy="316" rx="24" ry="14" fill={`url(#mb-${u})`}></ellipse>
        <ellipse cx="208" cy="318" rx="24" ry="14" fill={`url(#mb-${u})`}></ellipse>
        <g className="ux-armO ux-a dirL" style={{ transformOrigin: "146px 262px" }}>
          <ellipse
            cx="138"
            cy="284"
            rx="13"
            ry="24"
            transform="rotate(18 138 284)"
            fill={`url(#mb-${u})`}
          ></ellipse>
        </g>
        <ellipse cx="184" cy="276" rx="52" ry="46" fill={`url(#mb-${u})`}></ellipse>
        <g className="ux-head ux-a" style={{ transformOrigin: "176px 232px" }}>
          <g className="ux-tuft ux-a dirL" style={{ transformOrigin: "104px 100px" }}>
            <path
              d="M104 92 C 80 70 36 66 18 92 C 8 108 22 120 42 114 C 62 108 84 106 108 112 Z"
              fill={`url(#mb-${u})`}
            ></path>
          </g>
          <g className="ux-tuft ux-a dirR" style={{ transformOrigin: "196px 70px" }}>
            <path
              d="M186 70 C 182 40 196 10 220 8 C 240 7 242 26 232 44 C 222 60 214 70 210 78 Z"
              fill={`url(#mb-${u})`}
            ></path>
          </g>
          <path
            d="M58 152 C 50 96 104 58 172 56 C 244 54 290 96 284 150 C 278 202 232 232 172 232 C 104 232 64 204 58 152 Z"
            fill={`url(#mb-${u})`}
          ></path>
          <ellipse
            cx="118"
            cy="100"
            rx="44"
            ry="20"
            transform="rotate(-16 118 100)"
            fill="#FFFFFF"
            opacity="0.4"
            filter={`url(#ms-${u})`}
          ></ellipse>
          <ellipse
            cx="136"
            cy="198"
            rx="18"
            ry="11"
            fill={c.cheek}
            opacity="0.6"
            filter={`url(#mc-${u})`}
          ></ellipse>
          <ellipse
            cx="272"
            cy="180"
            rx="13"
            ry="9"
            fill={c.cheek}
            opacity="0.6"
            filter={`url(#mc-${u})`}
          ></ellipse>
          <g className="ux-brows ux-f">
            <path
              d="M142 116 Q 154 109 166 114"
              fill="none"
              stroke="#4A3566"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.7"
            ></path>
            <path
              d="M232 108 Q 244 101 256 107"
              fill="none"
              stroke="#4A3566"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.7"
            ></path>
          </g>
          <g className="ux-eye ux-a" style={{ transformOrigin: "155px 158px" }}>
            <ellipse cx="155" cy="158" rx="22" ry="26" fill="#FFFFFF"></ellipse>
            <g clipPath={`url(#me1-${u})`}>
              <g className="ux-look">
                <ellipse cx="158" cy="155" rx="18" ry="22" fill={`url(#mi-${u})`}></ellipse>
                <ellipse cx="159" cy="154" rx="9" ry="11" fill="#1E120C"></ellipse>
                <circle cx="152" cy="147" r="6" fill="#FFFFFF"></circle>
                <circle cx="166" cy="164" r="2.6" fill="#FFFFFF" opacity="0.9"></circle>
              </g>
            </g>
            <path
              d="M133 152 C 137 132 172 130 177 150"
              fill="none"
              stroke="#3A2218"
              strokeWidth="3"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-eye ux-a" style={{ transformOrigin: "243px 152px" }}>
            <ellipse cx="243" cy="152" rx="20" ry="24" fill="#FFFFFF"></ellipse>
            <g clipPath={`url(#me2-${u})`}>
              <g className="ux-look">
                <ellipse cx="246" cy="149" rx="16" ry="20" fill={`url(#mi-${u})`}></ellipse>
                <ellipse cx="247" cy="148" rx="8" ry="10" fill="#1E120C"></ellipse>
                <circle cx="241" cy="142" r="5.5" fill="#FFFFFF"></circle>
                <circle cx="253" cy="157" r="2.4" fill="#FFFFFF" opacity="0.9"></circle>
              </g>
            </g>
            <path
              d="M223 147 C 227 128 258 126 263 145"
              fill="none"
              stroke="#3A2218"
              strokeWidth="3"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-m-idle">
            <path
              d="M195 189 Q 206 199 219 188"
              fill="none"
              stroke="#5A2E3A"
              strokeWidth="4"
              strokeLinecap="round"
            ></path>
          </g>
          <g className="ux-m-open">
            <path d="M193 186 Q 207 210 222 186 Q 207 191 193 186 Z" fill="#5A2E3A"></path>
            <path d="M200 198 Q 207 204 215 198 Q 207 195 200 198 Z" fill="#F08C8C"></path>
          </g>
          <g className="ux-m-talk ux-f">
            <ellipse cx="207" cy="193" rx="9" ry="8" fill="#5A2E3A"></ellipse>
            <ellipse cx="207" cy="197" rx="5" ry="2.6" fill="#F08C8C"></ellipse>
          </g>
          <g className="ux-m-o">
            <ellipse cx="207" cy="193" rx="5" ry="6" fill="#5A2E3A"></ellipse>
          </g>
        </g>
        <path
          d="M228 244 C 200 262 170 280 152 296"
          fill="none"
          stroke={c.accentDark}
          strokeWidth="7"
          strokeLinecap="round"
        ></path>
        <rect x="118" y="280" width="64" height="50" rx="13" fill={`url(#ma-${u})`}></rect>
        <path
          d="M118 294 C 118 284 124 280 132 280 L 168 280 C 176 280 182 284 182 294 L 182 300 C 160 308 140 308 118 300 Z"
          fill={c.accentMid}
        ></path>
        <path
          d="M150 304 L 141 318 M150 304 L 159 318"
          stroke={c.accentDeep}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        ></path>
        <circle cx="150" cy="304" r="3.6" fill={c.accentDeep}></circle>
        <circle cx="141" cy="318" r="3.6" fill={c.accentDeep}></circle>
        <circle cx="159" cy="318" r="3.6" fill={c.accentDeep}></circle>
        <g className="ux-armP ux-a dirR" style={{ transformOrigin: "220px 268px" }}>
          <ellipse
            cx="232"
            cy="252"
            rx="13"
            ry="25"
            transform="rotate(25 232 252)"
            fill={`url(#mb-${u})`}
          ></ellipse>
          <ellipse cx="240" cy="230" rx="15" ry="13" fill={`url(#mb-${u})`}></ellipse>
        </g>
      </g>
      <g className="ux-fx ux-fx-think">
        <circle
          className="ux-dot d1 ux-f"
          cx="268"
          cy="82"
          r="4"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
        <circle
          className="ux-dot d2 ux-f"
          cx="281"
          cy="60"
          r="6"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
        <circle
          className="ux-dot d3 ux-f"
          cx="291"
          cy="34"
          r="8"
          fill="#FFFFFF"
          stroke="#C5CAD6"
          strokeWidth="2"
        ></circle>
      </g>
      <g className="ux-fx ux-fx-bulb">
        <g transform="translate(278 62)">
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
        <g transform="translate(30 168)">
          <path
            className="ux-spark s1 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill="#FFC94D"
          ></path>
        </g>
        <g transform="translate(290 118)">
          <path
            className="ux-spark s2 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill={c.accentDark}
          ></path>
        </g>
        <g transform="translate(274 290)">
          <path
            className="ux-spark s3 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill="#FFC94D"
          ></path>
        </g>
        <g transform="translate(64 244)">
          <path
            className="ux-spark s4 ux-f"
            d="M0 -10 C1.5 -2 2 -1.5 10 0 C2 1.5 1.5 2 0 10 C-1.5 2 -2 1.5 -10 0 C-2 -1.5 -1.5 -2 0 -10 Z"
            fill={c.base}
          ></path>
        </g>
      </g>
      <g className="ux-fx ux-fx-q">
        <g transform="translate(282 64)">
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
