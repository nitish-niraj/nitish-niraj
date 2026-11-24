import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchContributions, normalizeCalendar } from "./fetchContributions.js";

export const DURATION = 14;
export const OUTPUT_FILE = "dist/github-drift-graph.svg";

const WIDTH = 1280;
const HEIGHT = 580;
const CELL = 16;
const GAP = 2;
const PITCH = CELL + GAP;
const COLS = 53;
const ROWS = 7;
const LEFT = 164;
const TOP = 276;
const GRID_WIDTH = COLS * CELL + (COLS - 1) * GAP;
const GRID_HEIGHT = ROWS * CELL + (ROWS - 1) * GAP;
const CENTER_Y = TOP + GRID_HEIGHT / 2;
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const PALETTE = ["#1b1626", "#5e35b1", "#ab47bc", "#ff5252", "#ffca28"];
const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fixed(value, precision = 2) {
  const text = Number(value).toFixed(precision);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function cubicPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function buildRoute() {
  const start = { x: LEFT - 62, y: CENTER_Y };
  const straightEnd = { x: LEFT + 18 * PITCH - 8, y: CENTER_Y };
  const loopCenter = { x: LEFT + 20.5 * PITCH, y: CENTER_Y };
  const radiusX = 96;
  const radiusY = 112;
  const loopBottom = { x: loopCenter.x, y: loopCenter.y + radiusY };
  const dipEnd = { x: loopCenter.x + 78, y: loopBottom.y + 16 };
  const exitStart = { x: LEFT + 33 * PITCH, y: CENTER_Y };
  const exitEnd = { x: WIDTH + 70, y: CENTER_Y };
  const returnCorner = { x: 40, y: 468 };
  const points = [{ ...start, time: 0 }];
  const events = [{ time: 0, index: 0 }];

  const addPoint = (point, time) => {
    points.push({ ...point, time });
    return points.length - 1;
  };

  const addLine = (from, to, startTime, endTime, steps = 80) => {
    let index = points.length - 1;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      index = addPoint(
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        startTime + (endTime - startTime) * t,
      );
    }
    return index;
  };

  const addCubic = (p0, p1, p2, p3, startTime, endTime, steps = 48) => {
    let index = points.length - 1;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      index = addPoint(cubicPoint(p0, p1, p2, p3, t), startTime + (endTime - startTime) * t);
    }
    return index;
  };

  events.push({ time: 2, index: points.length - 1 });
  events.push({ time: 4, index: addLine(start, straightEnd, 2, 4) });
  events.push({
    time: 4.45,
    index: addCubic(
      straightEnd,
      { x: straightEnd.x + 70, y: straightEnd.y },
      { x: loopBottom.x - 70, y: loopBottom.y },
      loopBottom,
      4,
      4.45,
    ),
  });

  let loopIndex = points.length - 1;
  for (let step = 1; step <= 180; step += 1) {
    const t = step / 180;
    const angle = Math.PI / 2 - Math.PI * 2 * t;
    loopIndex = addPoint(
      {
        x: loopCenter.x + radiusX * Math.cos(angle),
        y: loopCenter.y + radiusY * Math.sin(angle),
      },
      4.45 + (8.75 - 4.45) * t,
    );
  }
  events.push({ time: 8.75, index: loopIndex });
  events.push({
    time: 9.05,
    index: addCubic(
      loopBottom,
      { x: loopBottom.x + 40, y: loopBottom.y },
      { x: dipEnd.x - 40, y: dipEnd.y },
      dipEnd,
      8.75,
      9.05,
      20,
    ),
  });
  events.push({
    time: 9.5,
    index: addCubic(
      dipEnd,
      { x: dipEnd.x + 70, y: dipEnd.y },
      { x: exitStart.x - 58, y: exitStart.y },
      exitStart,
      9.05,
      9.5,
      24,
    ),
  });
  events.push({ time: 11.5, index: addLine(exitStart, exitEnd, 9.5, 11.5, 100) });
  events.push({ time: 12.45, index: points.length - 1 });
  events.push({
    time: 13.4,
    index: addCubic(
      exitEnd,
      { x: exitEnd.x, y: 468 },
      { x: returnCorner.x, y: 468 },
      returnCorner,
      12.45,
      13.4,
      90,
    ),
  });
  events.push({
    time: 14,
    index: addCubic(
      returnCorner,
      { x: returnCorner.x, y: 360 },
      { x: start.x - 42, y: start.y },
      start,
      13.4,
      14,
      48,
    ),
  });

  const distances = [0];
  const pathCommands = [`M ${fixed(points[0].x)} ${fixed(points[0].y)}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    distances.push(distances[index - 1] + distance);
    if (distance > 0.0001) {
      pathCommands.push(`L ${fixed(current.x)} ${fixed(current.y)}`);
    }
  }

  const totalDistance = distances.at(-1);
  const loopPath = [
    `M ${fixed(loopBottom.x)} ${fixed(loopBottom.y)}`,
    `A ${radiusX} ${radiusY} 0 1 0 ${fixed(loopCenter.x)} ${fixed(loopCenter.y - radiusY)}`,
    `A ${radiusX} ${radiusY} 0 1 0 ${fixed(loopBottom.x)} ${fixed(loopBottom.y)}`,
  ].join(" ");

  return {
    path: pathCommands.join(" "),
    loopPath,
    keyPoints: events.map((event) => fixed(distances[event.index] / totalDistance, 6)).join(";"),
    keyTimes: events.map((event) => fixed(event.time / DURATION, 6)).join(";"),
    keySplines: [
      "0 0 1 1",
      "0.16 1 0.3 1",
      "0.42 0 0.58 1",
      "0.45 0 0.55 1",
      "0.42 0 0.58 1",
      "0.2 0 0.2 1",
      "0.12 0.7 0.2 1",
      "0 0 1 1",
      "0.42 0 0.58 1",
      "0.42 0 0.58 1",
    ].join(";"),
    straightSkidStart: exitStart.x,
    straightSkidEnd: exitEnd.x,
  };
}

function revealStart(column) {
  if (column < 18) return 2 + (column / 17) * 1.65;
  if (column < 22) return 4.05 + (column - 18) * 0.35;
  if (column < 33) return 7.4 + ((column - 22) / 10) * 1.55;
  return 9.5 + ((column - 33) / 19) * 1.75;
}

function cellMarkup(day, column, row) {
  const x = LEFT + column * PITCH;
  const y = TOP + row * PITCH;
  const level = LEVELS[day.contributionLevel] ?? 0;
  const title = escapeXml(`${day.contributionCount} contributions on ${day.date}`);

  if (level === 0) {
    return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${PALETTE[0]}"><title>${title}</title></rect>`;
  }

  const start = revealStart(column);
  const revealEnd = start + 0.25;
  const resetStart = 12.45 + ((COLS - 1 - column) / (COLS - 1)) * 1.25;
  const resetEnd = resetStart + 0.22;
  const keyTimes = [0, start, revealEnd, resetStart, resetEnd, DURATION]
    .map((time) => fixed(time / DURATION, 6))
    .join(";");
  const splines = "0 0 1 1;0.2 0 0.2 1;0.2 0 0.2 1;0 0 1 1;0 0 1 1";

  return `<g transform="translate(${x + CELL / 2} ${y + CELL / 2})"><g opacity="0">
    <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="${keyTimes}" calcMode="spline" keySplines="${splines}" dur="${DURATION}s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="scale" values="0.25;0.25;1.08;1;1;0.25" keyTimes="${keyTimes}" calcMode="spline" keySplines="${splines}" dur="${DURATION}s" repeatCount="indefinite"/>
    <rect x="${-CELL / 2}" y="${-CELL / 2}" width="${CELL}" height="${CELL}" rx="2.5" fill="${PALETTE[level]}"><title>${title}</title></rect>
  </g></g>`;
}

function monthLabels(weeks) {
  const labels = [];
  let previousMonth = -1;
  let previousX = -Infinity;
  for (let column = 0; column < weeks.length; column += 1) {
    const date = new Date(`${weeks[column].contributionDays[0].date}T00:00:00Z`);
    const x = LEFT + column * PITCH;
    if (date.getUTCMonth() !== previousMonth && x - previousX >= 28) {
      labels.push(
        `<text x="${x}" y="${TOP - 24}" fill="#9189a7" font-size="12" font-weight="500">${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</text>`,
      );
      previousMonth = date.getUTCMonth();
      previousX = x;
    }
  }
  return labels.join("");
}

function controlIcons() {
  return `
    <g fill="none" stroke="#c7c0d6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="m1139 63 5 5 5-5"/>
      <g transform="translate(1178 52) scale(.9)">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
        <path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
        <path d="M3 21v-5h5"/>
      </g>
      <g transform="translate(1226 52) scale(.9)">
        <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>
      </g>
    </g>`;
}

function launchSmoke() {
  const smokeX = LEFT - 106;
  return Array.from({ length: 9 }, (_, index) => {
    const y = index % 2 === 0 ? CENTER_Y - 12 : CENTER_Y + 12;
    const start = 0.04 + index * 0.17;
    const keyTimes = [0, start, start + 0.22, start + 1.15, start + 1.4, DURATION]
      .map((time) => fixed(time / DURATION, 6))
      .join(";");
    return `<circle cx="${smokeX}" cy="${y}" r="5" fill="url(#smoke)" opacity="0" filter="url(#smoke-soft)">
      <animate attributeName="cx" values="${smokeX};${smokeX};${smokeX - 26};${smokeX - 82};${smokeX - 96};${smokeX - 96}" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="${y};${y};${y - 5};${y - 14};${y - 18};${y - 18}" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="r" values="4;4;9;19;24;24" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0;.62;.26;0;0" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
    </circle>`;
  }).join("");
}

function carSmoke(kind) {
  const isDrift = kind === "drift";
  const count = isDrift ? 10 : 12;
  const baseStart = isDrift ? 4.15 : 9.5;
  const spacing = isDrift ? 0.34 : 0.16;
  const life = isDrift ? 1.15 : 0.72;

  return Array.from({ length: count }, (_, index) => {
    const y = index % 2 === 0 ? -13 : 13;
    const start = baseStart + index * spacing;
    const keyTimes = [0, start, start + life * 0.22, start + life * 0.72, start + life, DURATION]
      .map((time) => fixed(time / DURATION, 6))
      .join(";");
    return `<circle cx="-47" cy="${y}" r="5" fill="url(#smoke)" opacity="0" filter="url(#smoke-soft)">
      <animate attributeName="cx" values="-47;-47;-65;-98;-112;-112" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="${y};${y};${y * 1.4};${y * 2};${y * 2.3};${y * 2.3}" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="r" values="4;4;9;17;22;22" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0;.7;.3;0;0" keyTimes="${keyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
    </circle>`;
  }).join("");
}

function carMarkup() {
  const pulseValues = Array.from({ length: 17 }, (_, index) => index % 2 === 0 ? "0.28" : "1").concat("0.85").join(";");
  const pulseKeyTimes = Array.from({ length: 17 }, (_, index) => fixed(index / 112, 6)).concat("1").join(";");

  return `
    <ellipse cx="-2" cy="3" rx="55" ry="27" fill="url(#underglow)" opacity=".72" filter="url(#glow)"/>
    <path d="M42-12 L116-34 L116 34 L42 12 Z" fill="url(#headlight-beam)" opacity=".52"/>
    <g fill="#080611">
      <rect x="-32" y="-24" width="19" height="7" rx="2.5"/>
      <rect x="-32" y="17" width="19" height="7" rx="2.5"/>
      <rect x="17" y="-24" width="18" height="7" rx="2.5"/>
      <rect x="17" y="17" width="18" height="7" rx="2.5"/>
    </g>
    <path d="M-45-12 C-48-17-43-21-34-22 L-14-23 C-2-24 12-21 24-17 L39-11 C46-8 49-4 48 0 C49 4 46 8 39 11 L24 17 C12 21-2 24-14 23 L-34 22 C-43 21-48 17-45 12 C-44 6-44-6-45-12 Z" fill="url(#car-body)" stroke="#63b8ff" stroke-width="1.1"/>
    <path d="M39-11 L47-8 L50-4 L50 4 L47 8 L39 11 L41 7 L44 3 L44-3 L41-7 Z" fill="#0d47a1"/>
    <path d="M43-9 L48-5 L48 5 L43 9" fill="none" stroke="#42a5f5" stroke-width="1.4"/>
    <path d="M-45-13 L-40-18 L-34-20 L-34 20 L-40 18 L-45 13 Z" fill="#0d47a1" opacity=".78"/>
    <path d="M-35-19 C-25-21-19-21-12-20 M-35 19 C-25 21-19 21-12 20" fill="none" stroke="#90d4ff" stroke-width="1.2" opacity=".7"/>
    <path d="M18-15 C27-13 34-10 40-7 L40-3 L20-5 Z" fill="#42a5f5" opacity=".78"/>
    <path d="M18 15 C27 13 34 10 40 7 L40 3 L20 5 Z" fill="#1565c0" opacity=".9"/>
    <path d="M22-8 L34-6 M22 8 L34 6" stroke="#0d47a1" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M25-10 L35-8 M25 10 L35 8" stroke="#b9e7ff" stroke-width="1.1" stroke-linecap="round" opacity=".85"/>
    <path d="M-20-15 C-12-18 1-18 10-14 L17-9 L17 9 L10 14 C1 18-12 18-20 15 L-24 10 L-24-10 Z" fill="url(#car-glass)" stroke="#79bfff" stroke-width=".9"/>
    <path d="M8-15 L17-9 L17 9 L8 15 Z" fill="#07111f" opacity=".92"/>
    <path d="M-18-13 C-10-15-2-15 5-13 L5 13 C-2 15-10 15-18 13 L-21 9 L-21-9 Z" fill="#10243c" opacity=".86"/>
    <path d="M-17-11 L3-11 L3-7 L-17-7 Z M-17 7 L3 7 L3 11 L-17 11 Z" fill="#1e3a5f" opacity=".8"/>
    <path d="M-14-12 L7-5 M-14 12 L7 5" stroke="#8bd5ff" stroke-width="1" opacity=".34"/>
    <path d="M5-19 L12-22 L16-20 L11-16 Z M5 19 L12 22 L16 20 L11 16 Z" fill="#1e88e5" stroke="#90d4ff" stroke-width=".8"/>
    <path d="M-34-10 L-23-8 M-34 10 L-23 8" stroke="#0d47a1" stroke-width="3.2" stroke-linecap="round"/>
    <g stroke="#0a2d55" stroke-width="1.5" stroke-linecap="round">
      <path d="M-34-7 L-25-6 M-34-3 L-25-3 M-34 1 L-25 1 M-34 5 L-25 5 M-34 9 L-25 8"/>
    </g>
    <path d="M-13-20 C-5-22 5-21 12-18 M-13 20 C-5 22 5 21 12 18" fill="none" stroke="#0d47a1" stroke-width="1" opacity=".9"/>
    <path d="M42-12 L46-10 L46-7 L42-8 Z M42 12 L46 10 L46 7 L42 8 Z" fill="#e8fbff" stroke="#67e8f9" stroke-width=".7" filter="url(#glow)"/>
    <g opacity=".28">
      <animate attributeName="opacity" values="${pulseValues}" keyTimes="${pulseKeyTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      <rect x="-46" y="-16" width="5" height="32" rx="2" fill="#ff1744" filter="url(#glow)"/>
    </g>
    <rect x="-45.5" y="-15" width="3.5" height="30" rx="1.5" fill="#ff1744"/>
    <path d="M-42-12 L-42 12" stroke="#ff8a9f" stroke-width=".8" opacity=".9"/>
    ${carSmoke("drift")}
    ${carSmoke("burnout")}
  `;
}

function skidMarkup(route) {
  const dashTimes = [0, 4.2, 8.75, 12.45, 13.85, DURATION]
    .map((time) => fixed(time / DURATION, 6))
    .join(";");
  const straightTimes = [0, 9.5, 11.5, 12.45, 13.85, DURATION]
    .map((time) => fixed(time / DURATION, 6))
    .join(";");

  return `
    <g fill="none" stroke-linecap="round">
      <path d="${route.loopPath}" transform="translate(0 -9)" pathLength="1" stroke="#080611" stroke-width="5" stroke-dasharray="1" stroke-dashoffset="1" opacity="0">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1;1" keyTimes="${dashTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0;.82;.82;0;0" keyTimes="${dashTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      </path>
      <path d="${route.loopPath}" transform="translate(0 9)" pathLength="1" stroke="#080611" stroke-width="5" stroke-dasharray="1" stroke-dashoffset="1" opacity="0">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1;1" keyTimes="${dashTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0;.82;.82;0;0" keyTimes="${dashTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      </path>
      <path d="${route.loopPath}" transform="translate(0 -9)" pathLength="1" stroke="#7c4dff" stroke-width="1" stroke-dasharray="1" stroke-dashoffset="1" opacity="0">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1;1" keyTimes="${dashTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0;.42;.42;0;0" keyTimes="${dashTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      </path>
      <path d="M${route.straightSkidStart} ${CENTER_Y - 10} H${route.straightSkidEnd}" pathLength="1" stroke="#080611" stroke-width="5" stroke-dasharray="1" stroke-dashoffset="1" opacity="0">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1;1" keyTimes="${straightTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0;.85;.85;0;0" keyTimes="${straightTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      </path>
      <path d="M${route.straightSkidStart} ${CENTER_Y + 10} H${route.straightSkidEnd}" pathLength="1" stroke="#080611" stroke-width="5" stroke-dasharray="1" stroke-dashoffset="1" opacity="0">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1;1" keyTimes="${straightTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0;.85;.85;0;0" keyTimes="${straightTimes}" dur="${DURATION}s" repeatCount="indefinite"/>
      </path>
    </g>`;
}

export function generateSvg(calendar, options = {}) {
  const username = options.username || calendar.username || "nitish-niraj";
  const data = normalizeCalendar(calendar, username, calendar.source || "mock");
  const route = buildRoute();
  const total = new Intl.NumberFormat("en-US").format(data.totalContributions);
  const countText = String(total);
  const contributionsX = 56 + countText.length * 23 + 16;
  const yearX = contributionsX + 142;
  const firstDate = formatDate(data.weeks[0].contributionDays[0].date);
  const lastDate = formatDate(data.weeks.at(-1).contributionDays.at(-1).date);
  const cells = data.weeks.flatMap((week, column) =>
    week.contributionDays.map((day, row) => cellMarkup(day, column, row)),
  ).join("");
  const weekdays = [["Mon", 1], ["Wed", 3], ["Fri", 5]]
    .map(([label, row]) => `<text x="112" y="${TOP + row * PITCH + CELL / 2 + 4}" fill="#9189a7" font-size="12">${label}</text>`)
    .join("");
  const legendX = 932;
  const sourceLabel = data.source === "live" ? "Synced with GitHub." : "Mock preview data.";
  const sourceColor = data.source === "live" ? "#f472b6" : "#ffca28";
  const safeUsername = escapeXml(username);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc" shape-rendering="geometricPrecision">
  <title id="title">${safeUsername}'s GitHub contribution calendar</title>
  <desc id="desc">The Daily Grind: ${data.totalContributions} contributions in the last 12 months with an animated electric-blue sports car drifting through a Vice City contribution grid.</desc>
  <metadata>${escapeXml(JSON.stringify({ username, source: data.source, totalContributions: data.totalContributions, duration: DURATION }))}</metadata>
  <defs>
    <radialGradient id="page-bg" cx="50%" cy="0" r="100%">
      <stop offset="0" stop-color="#171122"/>
      <stop offset=".55" stop-color="#100c19"/>
      <stop offset="1" stop-color="#09070f"/>
    </radialGradient>
    <radialGradient id="card-bg" cx="72%" cy="0" r="120%">
      <stop offset="0" stop-color="#1b1428"/>
      <stop offset=".48" stop-color="#120e1b"/>
      <stop offset="1" stop-color="#0f0c18"/>
    </radialGradient>
    <linearGradient id="neon-line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7c4dff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#e040fb" stop-opacity=".8"/>
      <stop offset="1" stop-color="#ffca28" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="count-gradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f472b6"/>
      <stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
    <linearGradient id="wipe-gradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e040fb" stop-opacity="0"/>
      <stop offset=".7" stop-color="#e040fb" stop-opacity=".22"/>
      <stop offset="1" stop-color="#ffca28" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="underglow">
      <stop offset="0" stop-color="#29b6f6" stop-opacity=".8"/>
      <stop offset=".5" stop-color="#1e88e5" stop-opacity=".34"/>
      <stop offset="1" stop-color="#1e88e5" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="headlight-beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e8fbff" stop-opacity=".8"/>
      <stop offset=".35" stop-color="#67e8f9" stop-opacity=".24"/>
      <stop offset="1" stop-color="#67e8f9" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="car-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#42a5f5"/>
      <stop offset=".28" stop-color="#1e88e5"/>
      <stop offset=".7" stop-color="#1565c0"/>
      <stop offset="1" stop-color="#0d47a1"/>
    </linearGradient>
    <linearGradient id="car-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#172b46"/>
      <stop offset=".45" stop-color="#07111f"/>
      <stop offset="1" stop-color="#02050b"/>
    </linearGradient>
    <radialGradient id="smoke">
      <stop offset="0" stop-color="#f5f3ff" stop-opacity=".9"/>
      <stop offset=".45" stop-color="#c4b5fd" stop-opacity=".62"/>
      <stop offset="1" stop-color="#7c4dff" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-80%" y="-200%" width="260%" height="500%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="smoke-soft" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="2.2"/>
    </filter>
    <clipPath id="grid-clip">
      <rect x="${LEFT}" y="${TOP}" width="${GRID_WIDTH}" height="${GRID_HEIGHT}"/>
    </clipPath>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#page-bg)"/>
  <rect x="16" y="16" width="1248" height="548" rx="20" fill="url(#card-bg)" stroke="#2a243b" stroke-width="1"/>
  <path d="M120 17 H1160" stroke="url(#neon-line)" stroke-width="1.5" opacity=".7"/>
  <g font-family="${FONT}">
    <rect x="56" y="49" width="3" height="15" rx="1.5" fill="#e040fb"/>
    <text x="69" y="61" fill="#a69db9" font-size="12" font-weight="700" letter-spacing="2.5">THE DAILY GRIND</text>
    <text x="56" y="108" fill="url(#count-gradient)" font-size="40" font-weight="800" letter-spacing="-1.4">${countText}</text>
    <text x="${contributionsX}" y="105" fill="#f4f1fa" font-size="18" font-weight="600">contributions</text>
    <text x="${yearX}" y="105" fill="#9189a7" font-size="16">in the last year</text>
    <rect x="970" y="46" width="188" height="40" rx="10" fill="#181420" stroke="#343047"/>
    <text x="989" y="71" fill="#d6d0e2" font-size="13">Last 12 months</text>
    ${controlIcons()}
    <rect x="1170" y="46" width="38" height="40" rx="10" fill="#181420" stroke="#343047"/>
    <rect x="1220" y="46" width="38" height="40" rx="10" fill="#181420" stroke="#343047"/>
    <path d="M56 150 H1224" stroke="#2a243b" stroke-width="1"/>
    <g font-size="12">${monthLabels(data.weeks)}${weekdays}</g>
  </g>
  <g id="contribution-cells">${cells}</g>
  ${skidMarkup(route)}
  <g clip-path="url(#grid-clip)">
    <rect x="${LEFT + GRID_WIDTH}" y="${TOP}" width="90" height="${GRID_HEIGHT}" fill="url(#wipe-gradient)" opacity="0">
      <animate attributeName="x" values="${LEFT + GRID_WIDTH};${LEFT + GRID_WIDTH};${LEFT - 90};${LEFT - 90}" keyTimes="0;${fixed(12.45 / DURATION, 6)};${fixed(13.85 / DURATION, 6)};1" dur="${DURATION}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0;.9;0;0" keyTimes="0;${fixed(12.45 / DURATION, 6)};${fixed(13.7 / DURATION, 6)};${fixed(13.9 / DURATION, 6)};1" dur="${DURATION}s" repeatCount="indefinite"/>
    </rect>
  </g>
  ${launchSmoke()}
  <g id="car-motion" pointer-events="none">
    <animateMotion dur="${DURATION}s" repeatCount="indefinite" rotate="auto" calcMode="spline" path="${route.path}" keyPoints="${route.keyPoints}" keyTimes="${route.keyTimes}" keySplines="${route.keySplines}"/>
    ${carMarkup()}
  </g>
  <g font-family="${FONT}" font-size="12" fill="#9189a7">
    <text x="56" y="504">${firstDate} — ${lastDate}</text>
    <text x="884" y="504">Less</text>
    ${PALETTE.map((color, index) => `<rect x="${legendX + index * 19}" y="493" width="13" height="13" rx="2.5" fill="${color}"/>`).join("")}
    <text x="${legendX + 104}" y="504">More</text>
  </g>
  <path d="M56 526 H1224" stroke="#2a243b" stroke-width="1"/>
  <g font-family="${FONT}" font-size="12" fill="#9189a7">
    <circle cx="60" cy="550" r="3" fill="${sourceColor}"/>
    <text x="72" y="554">${sourceLabel}</text>
    <g transform="translate(1127 541)" fill="none" stroke="#b3aabd" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3"/>
    </g>
    <text x="1153" y="554">Download chart</text>
  </g>
</svg>
`;
}

export async function generateFile(options = {}) {
  const username = options.username || process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "nitish-niraj";
  const calendar = options.calendar || await fetchContributions({
    username,
    token: options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    mock: options.mock,
  });
  const output = resolve(options.output || OUTPUT_FILE);
  const svg = generateSvg(calendar, { username }).replace(/[ \t]+$/gm, "");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg, "utf8");
  return { output, calendar, bytes: Buffer.byteLength(svg) };
}

function parseArgs(argv) {
  const options = { mock: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mock") options.mock = true;
    else if (argument === "--output" || argument === "--user") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node src/generateSvg.js [--mock] [--user LOGIN] [--output PATH]");
    return;
  }
  const result = await generateFile(options);
  console.log(`Wrote ${result.output} (${result.calendar.totalContributions} contributions, ${result.calendar.source} data, ${DURATION}s loop, ${result.bytes} bytes)`);
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
