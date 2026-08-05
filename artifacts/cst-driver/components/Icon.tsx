import React from "react";
import Svg, { Path, Circle, Rect, Line, Polyline, Polygon } from "react-native-svg";

export type FeatherName =
  | "alert-circle" | "alert-triangle" | "arrow-right" | "bell" | "calendar"
  | "camera" | "check" | "check-circle" | "chevron-right" | "circle" | "clock"
  | "credit-card" | "edit-3" | "eye" | "eye-off" | "hash" | "home" | "inbox"
  | "info" | "layers" | "lock" | "log-out" | "mail" | "map" | "map-pin"
  | "navigation" | "package" | "phone" | "settings" | "star" | "trash-2" | "truck"
  | "user" | "x";

interface IconProps {
  name: FeatherName;
  size?: number;
  color?: string;
  style?: object;
}

const S = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 2 };

export function Icon({ name, size = 24, color = "#000", style }: IconProps) {
  const s = { ...S, stroke: color };
  const vb = "0 0 24 24";

  const icons: Record<FeatherName, React.ReactNode> = {
    "alert-circle": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Circle {...s} cx="12" cy="12" r="10" />
        <Line {...s} x1="12" y1="8" x2="12" y2="12" />
        <Line {...s} x1="12" y1="16" x2="12.01" y2="16" />
      </Svg>
    ),
    "alert-triangle": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <Line {...s} x1="12" y1="9" x2="12" y2="13" />
        <Line {...s} x1="12" y1="17" x2="12.01" y2="17" />
      </Svg>
    ),
    "arrow-right": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Line {...s} x1="5" y1="12" x2="19" y2="12" />
        <Polyline {...s} points="12,5 19,12 12,19" />
      </Svg>
    ),
    "bell": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <Path {...s} d="M13.73 21a2 2 0 0 1-3.46 0" />
      </Svg>
    ),
    "calendar": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Rect {...s} x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <Line {...s} x1="16" y1="2" x2="16" y2="6" />
        <Line {...s} x1="8" y1="2" x2="8" y2="6" />
        <Line {...s} x1="3" y1="10" x2="21" y2="10" />
      </Svg>
    ),
    "camera": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <Circle {...s} cx="12" cy="13" r="4" />
      </Svg>
    ),
    "check": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polyline {...s} points="20,6 9,17 4,12" />
      </Svg>
    ),
    "check-circle": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <Polyline {...s} points="22,4 12,14.01 9,11.01" />
      </Svg>
    ),
    "chevron-right": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polyline {...s} points="9,18 15,12 9,6" />
      </Svg>
    ),
    "circle": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Circle {...s} cx="12" cy="12" r="10" />
      </Svg>
    ),
    "clock": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Circle {...s} cx="12" cy="12" r="10" />
        <Polyline {...s} points="12,6 12,12 16,14" />
      </Svg>
    ),
    "credit-card": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Rect {...s} x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <Line {...s} x1="1" y1="10" x2="23" y2="10" />
      </Svg>
    ),
    "edit-3": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M12 20h9" />
        <Path {...s} d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </Svg>
    ),
    "eye": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <Circle {...s} cx="12" cy="12" r="3" />
      </Svg>
    ),
    "eye-off": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <Line {...s} x1="1" y1="1" x2="23" y2="23" />
      </Svg>
    ),
    "hash": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Line {...s} x1="4" y1="9" x2="20" y2="9" />
        <Line {...s} x1="4" y1="15" x2="20" y2="15" />
        <Line {...s} x1="10" y1="3" x2="8" y2="21" />
        <Line {...s} x1="16" y1="3" x2="14" y2="21" />
      </Svg>
    ),
    "home": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <Polyline {...s} points="9,22 9,12 15,12 15,22" />
      </Svg>
    ),
    "inbox": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polyline {...s} points="22,12 16,12 14,15 10,15 8,12 2,12" />
        <Path {...s} d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </Svg>
    ),
    "info": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Circle {...s} cx="12" cy="12" r="10" />
        <Line {...s} x1="12" y1="16" x2="12" y2="12" />
        <Line {...s} x1="12" y1="8" x2="12.01" y2="8" />
      </Svg>
    ),
    "layers": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polygon {...s} points="12,2 2,7 12,12 22,7 12,2" />
        <Polyline {...s} points="2,17 12,22 22,17" />
        <Polyline {...s} points="2,12 12,17 22,12" />
      </Svg>
    ),
    "lock": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Rect {...s} x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <Path {...s} d="M7 11V7a5 5 0 0 1 10 0v4" />
      </Svg>
    ),
    "log-out": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <Polyline {...s} points="16,17 21,12 16,7" />
        <Line {...s} x1="21" y1="12" x2="9" y2="12" />
      </Svg>
    ),
    "mail": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <Polyline {...s} points="22,6 12,13 2,6" />
      </Svg>
    ),
    "map": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polygon {...s} points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2 1,6" />
        <Line {...s} x1="8" y1="2" x2="8" y2="18" />
        <Line {...s} x1="16" y1="6" x2="16" y2="22" />
      </Svg>
    ),
    "map-pin": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <Circle {...s} cx="12" cy="10" r="3" />
      </Svg>
    ),
    "navigation": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polygon {...s} points="3,11 22,2 13,21 11,13 3,11" />
      </Svg>
    ),
    "package": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Line {...s} x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
        <Path {...s} d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <Polyline {...s} points="3.27,6.96 12,12.01 20.73,6.96" />
        <Line {...s} x1="12" y1="22.08" x2="12" y2="12" />
      </Svg>
    ),
    "phone": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.46 14a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.17 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.91a16 16 0 0 0 6.08 6.08l1.28-.64a2 2 0 0 1 2.11.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 19.82v3z" />
      </Svg>
    ),
    "settings": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Circle {...s} cx="12" cy="12" r="3" />
        <Path {...s} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </Svg>
    ),
    "star": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polygon {...s} points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2" />
      </Svg>
    ),
    "trash-2": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Polyline {...s} points="3,6 5,6 21,6" />
        <Path {...s} d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <Path {...s} d="M10 11v6" />
        <Path {...s} d="M14 11v6" />
        <Path {...s} d="M9 6V4h6v2" />
      </Svg>
    ),
    "truck": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Rect {...s} x="1" y="3" width="15" height="13" />
        <Polygon {...s} points="16,8 20,8 23,11 23,16 16,16 16,8" />
        <Circle {...s} cx="5.5" cy="18.5" r="2.5" />
        <Circle {...s} cx="18.5" cy="18.5" r="2.5" />
      </Svg>
    ),
    "user": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Path {...s} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <Circle {...s} cx="12" cy="7" r="4" />
      </Svg>
    ),
    "x": (
      <Svg width={size} height={size} viewBox={vb} style={style}>
        <Line {...s} x1="18" y1="6" x2="6" y2="18" />
        <Line {...s} x1="6" y1="6" x2="18" y2="18" />
      </Svg>
    ),
  };

  return <>{icons[name] ?? null}</>;
}
