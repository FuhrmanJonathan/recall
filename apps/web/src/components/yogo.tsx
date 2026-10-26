import { Fragment, type ReactNode } from "react";
import styles from "./yogo.module.css";

export type YogoExpression = "idle" | "thinking" | "celebrating" | "encouraging";

type YogoProps = {
  expression?: YogoExpression;
  size?: number;
  title?: string;
  className?: string;
};

const C = {
  ink: "#111827", cream: "#FBF3E2", creamShade: "#EDDDBE",
  blue: "#2563eb", blueDark: "#1d4ed8", foil: "#4F86F7", yog: "#FFFDF8",
  label: "#D6E4FD", labelShade: "#BFD3FA", blush: "#F5A3B3",
  tongue: "#F07F93", cardLine: "#CBD5E1", spark: "#F5B638",
};
const BODY = "M42 46 Q33 76 31.5 110 Q31 114 29 117 Q27 124 35 125.5 L105 125.5 Q113 124 111 117 Q109 114 108.5 110 Q107 76 98 46 Z";
const LABEL_EDGE = "M31.9 103 C55 99 85 107 108.1 101";

// Preserve the reference's nested coordinate systems: animation pivots stay local.
function pivot(x: number, y: number, className: string, inner: ReactNode) {
  return <g transform={`translate(${x} ${y})`}><g className={className}><g transform={`translate(${-x} ${-y})`}>{inner}</g></g></g>;
}
function arm(d: string, sw: number) {
  return <><path d={d} fill="none" stroke={C.ink} strokeWidth={4.8 + sw * 2} strokeLinecap="round" /><path d={d} fill="none" stroke={C.cream} strokeWidth={4.8} strokeLinecap="round" /></>;
}
function star(x: number, y: number, r: number) {
  const k = r * 0.2;
  return <path transform={`translate(${x} ${y})`} d={`M0 ${-r} Q${k} ${-k} ${r} 0 Q${k} ${k} 0 ${r} Q${-k} ${k} ${-r} 0 Q${-k} ${-k} 0 ${-r} Z`} fill={C.spark} />;
}
function eyes(icon: boolean) {
  return [58, 82].map((cx) => <Fragment key={cx}><ellipse cx={cx} cy="80" rx={icon ? 7 : 6} ry={icon ? 8.5 : 7.5} fill={C.ink} />{!icon && <circle cx={cx + 2} cy="77" r="2.1" fill="#fff" />}</Fragment>);
}

/**
 * Yogo, ported from the approved SVG reference with no drawing IDs or dependencies.
 *
 * import Yogo from "@/components/yogo";
 * <Yogo expression="encouraging" size={32} />                          // decorative
 * <Yogo expression="celebrating" size={160} title="Yogo celebrating" /> // meaningful
 */
export default function Yogo({ expression = "idle", size = 120, title, className }: YogoProps) {
  const compact = size < 48;
  const icon = size < 32;
  const sw = icon ? 5.2 : compact ? 4 : 3;
  // The HTML reference repeats stroke-width; browsers keep its first (base) width.
  const line = { stroke: C.ink, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const detail = (node: ReactNode) => compact ? null : node;
  let props: ReactNode = null;
  let armL = "M36 92 Q26 98 24 107";
  let armR = "M104 92 Q114 98 116 107";
  let sparks: ReactNode = null;

  if (expression === "thinking") {
    props = <>
      <g transform="rotate(8 122 72.5)">{pivot(122, 72.5, styles.card, <>
        <rect x="110" y="64" width="24" height="17" rx="2.5" fill="#fff" {...line} />
        <path d="M114 69 L130 69" stroke={C.blue} strokeWidth={compact ? 2.4 : 1.8} strokeLinecap="round" />
        {detail(<path d="M114 73.5 L127 73.5 M114 77.5 L122 77.5" stroke={C.cardLine} strokeWidth="1.6" strokeLinecap="round" />)}
      </>)}</g>
      {detail([114, 121, 128].map((x, i) => <circle key={x} className={[styles.dot, i === 1 ? styles.dot2 : i === 2 ? styles.dot3 : ""].filter(Boolean).join(" ")} cx={x} cy="56" r="2.3" fill={C.blue} />))}
    </>;
    armR = "M104 94 Q112 92 113 82";
  } else if (expression === "celebrating") {
    props = <g transform="rotate(-10 19 53)">{pivot(19, 53, styles.card, <>
      <rect x="6" y="44" width="26" height="18" rx="2.5" fill="#fff" {...line} />
      <path d="M12.5 53.5 L17 58 L25.5 49" fill="none" stroke={C.blue} strokeWidth={compact ? 3.6 : 2.8} strokeLinecap="round" strokeLinejoin="round" />
    </>)}</g>;
    armL = "M36 92 Q24 84 20 66";
    armR = "M104 92 Q116 84 120 70";
    sparks = detail(<>
      {pivot(100, 18, styles.spark, star(100, 18, 6))}
      {pivot(118, 46, `${styles.spark} ${styles.spark2}`, star(118, 46, 5))}
      {pivot(10, 30, `${styles.spark} ${styles.spark3}`, star(10, 30, 4.5))}
    </>);
  }

  let arms = <>{arm(armL, sw)}{arm(armR, sw)}</>;
  if (expression === "encouraging") {
    arms = <>{arm(armL, sw)}<g className={styles.rest}>{arm(armR, sw)}</g>
      {pivot(104, 92, styles.wave, <>{arm("M104 92 Q114 86 117 76", sw)}{detail(<path className={styles.lines} d="M123 69 Q127 74 124.5 80 M128 64 Q134 72 130 81" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" />)}</>)}
    </>;
  }

  const openEyes = () => pivot(70, 80, styles.blink, pivot(70, 80, styles.blink2, <g className={styles.glance}>{eyes(icon)}</g>));
  const blush = detail(<><ellipse cx="46.5" cy="90" rx="5.5" ry="3" fill={C.blush} opacity="0.6" /><ellipse cx="93.5" cy="90" rx="5.5" ry="3" fill={C.blush} opacity="0.6" /></>);
  let face: ReactNode;
  if (expression === "idle") {
    face = <>{openEyes()}<path d="M65 89 Q70 93.5 75 89" fill="none" {...line} /></>;
  } else if (expression === "thinking") {
    face = <><g transform="translate(3 -1.5)">{openEyes()}</g><path d="M78 67 Q84 63.5 90 67" fill="none" {...line} /><path d="M66 90 Q71 92 76 88.5" fill="none" {...line} /></>;
  } else if (expression === "celebrating") {
    face = <><path d="M52 82 Q58 73.5 64 82 M76 82 Q82 73.5 88 82" fill="none" {...line} /><path d="M62 87 L78 87 Q78 98 70 98 Q62 98 62 87 Z" fill={C.ink} {...line} />{detail(<ellipse cx="70" cy="95" rx="4" ry="2.2" fill={C.tongue} />)}</>;
  } else {
    face = <>{openEyes()}{detail(<path d="M51 70 Q56 67.5 62 67 M78 67 Q84 67.5 89 70" fill="none" {...line} />)}<path d="M62 88 Q70 96 78 88" fill="none" {...line} /></>;
  }

  const cup = <>
    <path d={BODY} fill={C.cream} />
    <path d="M98 46 Q107 76 108.2 101 L103.5 102 Q101.5 76 93 46 Z" fill={C.creamShade} />
    <path d={`${LABEL_EDGE} L108.5 110 Q109 114 111 117 Q113 124 105 125.5 L35 125.5 Q27 124 29 117 Q31 114 31.5 110 Z`} fill={C.label} />
    <path d="M108.1 101 L108.5 110 Q109 114 111 117 Q113 124 105 125.5 L100 125.5 Q105.5 122 104.5 115 L103.5 102.2 Z" fill={C.labelShade} />
    <path d={LABEL_EDGE} fill="none" stroke={C.blue} strokeWidth={compact ? 3.6 : 2.6} strokeLinecap="round" />
    {detail(<path d="M46 56 Q41.5 68 40.5 80" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />)}
    <path d={BODY} fill="none" {...line} />
  </>;
  const lid = <>
    <path d="M40 39 L40 45.5 A30 6.6 0 0 0 100 45.5 L100 39 Z" fill={C.blueDark} {...line} />
    {detail([52, 61, 70, 79, 88].map((x) => {
      const y = 39 + 6.6 * Math.sqrt(1 - ((x - 70) / 30) ** 2);
      return <path key={x} d={`M${x} ${(y + 1.4).toFixed(1)} L${x} ${(y + 4.6).toFixed(1)}`} stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.35" />;
    }))}
    <ellipse cx="70" cy="39" rx="30" ry="6.6" fill={C.foil} {...line} />
    {detail(<path d="M50 37 Q61 34 76 34.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />)}
  </>;
  const body = <>{!icon && <>{props}{arms}</>}{cup}{lid}{blush}{face}</>;
  const fig = pivot(70, 126, styles.fig, pivot(70, 126, styles.sway, pivot(70, 126, styles.lean, body)));
  return <svg className={[styles.yogo, styles[expression], compact && styles.sm, className].filter(Boolean).join(" ")} width={size} height={size} viewBox={icon ? "19.5 28 101 101" : "0 6 140 140"} role={title ? "img" : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true} focusable={title ? undefined : "false"}>{fig}{sparks}</svg>;
}
