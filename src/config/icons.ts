export type IconTag = "path" | "circle" | "line" | "polyline" | "polygon" | "rect";

export interface IconNode {
  tag: IconTag;
  attrs: Record<string, string>;
}

export const ICONS = {
  "attach": [{ tag: "path", attrs: {"d": "M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7"} }],
  "ban": [{ tag: "circle", attrs: {"cx": "12", "cy": "12", "r": "10"} }, { tag: "line", attrs: {"x1": "4.93", "y1": "4.93", "x2": "19.07", "y2": "19.07"} }],
  "camera": [{ tag: "path", attrs: {"d": "M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"} }, { tag: "circle", attrs: {"cx": "12", "cy": "13", "r": "3.5"} }],
  "caret-left": [{ tag: "path", attrs: {"d": "M15 5l-7 7 7 7"} }],
  "caret-right": [{ tag: "path", attrs: {"d": "m9 5 7 7-7 7"} }],
  "chevron-down": [{ tag: "path", attrs: {"d": "m6 9 6 6 6-6"} }],
  "chevron-left": [{ tag: "path", attrs: {"d": "m15 18-6-6 6-6"} }],
  "chevron-right": [{ tag: "path", attrs: {"d": "m9 18 6-6-6-6"} }],
  "close": [{ tag: "path", attrs: {"d": "M18 6 6 18M6 6l12 12"} }],
  "cog": [{ tag: "path", attrs: {"d": "M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z"} }, { tag: "path", attrs: {"d": "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.99 19.4a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.9a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.99a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.99 4.6h.01c.39 0 .76-.14 1.04-.4A1.7 1.7 0 0 0 10.4 3.1V3a2 2 0 1 1 4 0v.09c0 .4.14.77.4 1.05.28.26.65.4 1.04.4h.01a1.7 1.7 0 0 0 1.06-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.27.27-.4.65-.34 1.03v.01c0 .39.14.76.4 1.04.28.26.65.4 1.05.4h.09a2 2 0 1 1 0 4H21.1c-.4 0-.77.14-1.05.4-.26.28-.4.65-.4 1.04Z"} }],
  "copy": [{ tag: "rect", attrs: {"x": "9", "y": "9", "width": "13", "height": "13", "rx": "2", "ry": "2"} }, { tag: "path", attrs: {"d": "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"} }],
  "download": [{ tag: "path", attrs: {"d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"} }, { tag: "polyline", attrs: {"points": "7 10 12 15 17 10"} }, { tag: "line", attrs: {"x1": "12", "y1": "15", "x2": "12", "y2": "3"} }],
  "download-outline": [{ tag: "path", attrs: {"stroke-linecap": "round", "stroke-linejoin": "round", "d": "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"} }],
  "edit": [{ tag: "path", attrs: {"d": "M12 20h9"} }, { tag: "path", attrs: {"d": "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"} }],
  "external-link": [{ tag: "path", attrs: {"d": "M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"} }, { tag: "path", attrs: {"d": "M15 3h6v6"} }, { tag: "path", attrs: {"d": "M10 14 21 3"} }],
  "eye": [{ tag: "path", attrs: {"d": "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"} }, { tag: "circle", attrs: {"cx": "12", "cy": "12", "r": "3"} }],
  "eye-off": [{ tag: "path", attrs: {"d": "M3 3l18 18"} }, { tag: "path", attrs: {"d": "M10.6 10.6A2 2 0 0 0 13.4 13.4"} }, { tag: "path", attrs: {"d": "M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9 4.5 10 8a12.4 12.4 0 0 1-2.1 3.8"} }, { tag: "path", attrs: {"d": "M6.1 6.1A12.1 12.1 0 0 0 2 12c1 3.5 5 8 10 8 1.5 0 2.9-.4 4.1-1.1"} }],
  "headphones": [{ tag: "path", attrs: {"d": "M3 14h3v5H3z"} }, { tag: "path", attrs: {"d": "M18 14h3v5h-3z"} }, { tag: "path", attrs: {"d": "M4 14a8 8 0 0 1 16 0"} }],
  "headphones-off": [{ tag: "path", attrs: {"d": "M3 14h3v5H3z"} }, { tag: "path", attrs: {"d": "M18 14h3v5h-3z"} }, { tag: "path", attrs: {"d": "M4 14a8 8 0 0 1 16 0"} }, { tag: "line", attrs: {"x1": "4", "y1": "4", "x2": "20", "y2": "20"} }],
  "heart": [{ tag: "path", attrs: {"d": "M12 21s-7.5-4.7-9.8-9.2C.4 8.6 2.7 5 6.5 5c2.2 0 3.9 1.2 5.5 3.2C13.6 6.2 15.3 5 17.5 5c3.8 0 6.1 3.6 4.3 6.8C19.5 16.3 12 21 12 21Z"} }],
  "image": [{ tag: "rect", attrs: {"x": "3", "y": "3", "width": "18", "height": "18", "rx": "2", "ry": "2"} }, { tag: "circle", attrs: {"cx": "8.5", "cy": "8.5", "r": "1.5"} }, { tag: "polyline", attrs: {"points": "21 15 16 10 5 21"} }],
  "lock": [{ tag: "path", attrs: {"d": "M7 10V8a5 5 0 0 1 10 0v2"} }, { tag: "rect", attrs: {"x": "5", "y": "10", "width": "14", "height": "10", "rx": "2", "ry": "2"} }, { tag: "path", attrs: {"d": "M12 14v2"} }],
  "log-out": [{ tag: "path", attrs: {"d": "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"} }, { tag: "polyline", attrs: {"points": "16 17 21 12 16 7"} }, { tag: "line", attrs: {"x1": "21", "y1": "12", "x2": "9", "y2": "12"} }],
  "mic": [{ tag: "path", attrs: {"d": "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"} }, { tag: "path", attrs: {"d": "M19 10a7 7 0 0 1-14 0"} }, { tag: "line", attrs: {"x1": "12", "y1": "19", "x2": "12", "y2": "23"} }],
  "mic-off": [{ tag: "path", attrs: {"d": "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"} }, { tag: "path", attrs: {"d": "M19 10a7 7 0 0 1-14 0"} }, { tag: "line", attrs: {"x1": "12", "y1": "19", "x2": "12", "y2": "23"} }, { tag: "line", attrs: {"x1": "4", "y1": "4", "x2": "20", "y2": "20"} }],
  "microphone": [{ tag: "path", attrs: {"d": "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"} }, { tag: "path", attrs: {"d": "M19 10a7 7 0 0 1-14 0"} }, { tag: "line", attrs: {"x1": "12", "y1": "19", "x2": "12", "y2": "23"} }, { tag: "line", attrs: {"x1": "8", "y1": "23", "x2": "16", "y2": "23"} }],
  "moon": [{ tag: "path", attrs: {"d": "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"} }],
  "open-external": [{ tag: "path", attrs: {"d": "M14 3h7v7"} }, { tag: "path", attrs: {"d": "M10 14 21 3"} }, { tag: "path", attrs: {"d": "M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"} }],
  "person": [{ tag: "path", attrs: {"d": "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"} }, { tag: "circle", attrs: {"cx": "12", "cy": "7", "r": "4"} }],
  "phone": [{ tag: "path", attrs: {"d": "M7.6 10.8a14.5 14.5 0 0 0 5.6 5.6l1.9-1.9a1.5 1.5 0 0 1 1.5-.37c1.03.34 2.1.52 3.2.52.83 0 1.5.67 1.5 1.5v3.05c0 .83-.67 1.5-1.5 1.5C10.45 20.7 3.3 13.55 3.3 4.2c0-.83.67-1.5 1.5-1.5h3.05c.83 0 1.5.67 1.5 1.5 0 1.1.18 2.17.52 3.2.17.53.03 1.1-.37 1.5l-1.9 1.9Z"} }],
  "phone-hangup": [{ tag: "path", attrs: {"d": "M6.6 15.4c3.3-2.1 7.5-2.1 10.8 0l1.45.92c.7.44.92 1.37.48 2.07l-1.15 1.84c-.44.7-1.37.92-2.07.48l-1.55-.97a4.95 4.95 0 0 0-5.12 0l-1.55.97c-.7.44-1.63.22-2.07-.48l-1.15-1.84c-.44-.7-.22-1.63.48-2.07l1.45-.92Z"} }, { tag: "path", attrs: {"d": "M6 8.5C9.7 6.2 14.3 6.2 18 8.5"} }, { tag: "path", attrs: {"d": "M3.5 5.2c5.2-3.4 11.8-3.4 17 0"} }],
  "plus": [{ tag: "path", attrs: {"d": "M12 5v14M5 12h14"} }],
  "plus-circle": [{ tag: "circle", attrs: {"cx": "12", "cy": "12", "r": "9"} }, { tag: "path", attrs: {"d": "M12 8.5v7M8.5 12h7"} }],
  "reply": [{ tag: "path", attrs: {"d": "M9 17 4 12l5-5"} }, { tag: "path", attrs: {"d": "M20 18v-2a4 4 0 0 0-4-4H4"} }],
  "search": [{ tag: "circle", attrs: {"cx": "11", "cy": "11", "r": "6.5"} }, { tag: "path", attrs: {"d": "m16 16 4 4"} }],
  "search-lg": [{ tag: "circle", attrs: {"cx": "11", "cy": "11", "r": "7"} }, { tag: "path", attrs: {"d": "m20 20-3.5-3.5"} }],
  "settings": [{ tag: "path", attrs: {"d": "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"} }, { tag: "path", attrs: {"d": "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.23.62.83 1 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15Z"} }],
  "sign-out": [{ tag: "path", attrs: {"d": "M9 12h12"} }, { tag: "path", attrs: {"d": "m17 8 4 4-4 4"} }, { tag: "path", attrs: {"d": "M9 4h-4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"} }],
  "sun": [{ tag: "circle", attrs: {"cx": "12", "cy": "12", "r": "4"} }, { tag: "path", attrs: {"d": "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"} }],
  "trash": [{ tag: "polyline", attrs: {"points": "3 6 5 6 21 6"} }, { tag: "path", attrs: {"d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"} }],
  "upload": [{ tag: "path", attrs: {"d": "M12 3v12"} }, { tag: "path", attrs: {"d": "m6 9 6-6 6 6"} }, { tag: "path", attrs: {"d": "M5 21h14"} }],
  "user": [{ tag: "circle", attrs: {"cx": "12", "cy": "8", "r": "4"} }, { tag: "path", attrs: {"d": "M4 21a8 8 0 0 1 16 0"} }],
  "user-plus": [{ tag: "path", attrs: {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"} }, { tag: "circle", attrs: {"cx": "9", "cy": "7", "r": "4"} }, { tag: "path", attrs: {"d": "M19 8v6M16 11h6"} }],
  "video": [{ tag: "path", attrs: {"d": "M15 10.5 20 7v10l-5-3.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3.5Z"} }],
  "volume-off": [{ tag: "polygon", attrs: {"points": "11 5 6 9 2 9 2 15 6 15 11 19 11 5"} }, { tag: "line", attrs: {"x1": "23", "y1": "9", "x2": "17", "y2": "15"} }, { tag: "line", attrs: {"x1": "17", "y1": "9", "x2": "23", "y2": "15"} }],
} satisfies Record<string, IconNode[]>;

export type IconName = keyof typeof ICONS;
