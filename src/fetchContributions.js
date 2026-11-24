const API_URL = "https://api.github.com/graphql";
const DAY_MS = 86_400_000;

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function levelForCount(count) {
  if (count <= 0) return "NONE";
  if (count <= 3) return "FIRST_QUARTILE";
  if (count <= 7) return "SECOND_QUARTILE";
  if (count <= 12) return "THIRD_QUARTILE";
  return "FOURTH_QUARTILE";
}

export function createMockCalendar(username, endDate = new Date()) {
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  const first = new Date(end.getTime() - 370 * DAY_MS);
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());

  const weeks = Array.from({ length: 53 }, (_, weekIndex) => ({
    contributionDays: Array.from({ length: 7 }, (_, rowIndex) => {
      const date = new Date(first.getTime() + (weekIndex * 7 + rowIndex) * DAY_MS);
      const value = isoDate(date);
      const hash = hashString(`${username}:${value}`);
      const weekend = rowIndex === 0 || rowIndex === 6;
      let count = 0;

      if (date <= end) {
        const roll = hash % 100;
        if (!weekend && roll < 58) count = 1 + (hash % 6);
        if (!weekend && roll < 24) count = 7 + (hash % 8);
        if (!weekend && roll < 8) count = 15 + (hash % 12);
        if (weekend && roll < 22) count = 1 + (hash % 4);
        if (weekend && roll < 5) count = 6 + (hash % 7);
      }

      return {
        date: value,
        contributionCount: count,
        contributionLevel: levelForCount(count),
      };
    }),
  }));

  return {
    username,
    source: "mock",
    totalContributions: weeks.reduce(
      (total, week) => total + week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0),
      0,
    ),
    weeks,
  };
}

function emptyDay(date) {
  return { date, contributionCount: 0, contributionLevel: "NONE" };
}

export function normalizeCalendar(calendar, username, source = "live") {
  if (!calendar || !Array.isArray(calendar.weeks) || calendar.weeks.length === 0) {
    throw new Error("GitHub returned an empty contribution calendar.");
  }

  let weeks = calendar.weeks.map((week) => {
    const days = [...(week.contributionDays ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    if (days.length === 0) throw new Error("GitHub returned a contribution week without dates.");
    const firstDate = parseDate(days[0].date);
    return {
      contributionDays: Array.from({ length: 7 }, (_, rowIndex) => {
        const date = new Date(firstDate.getTime() + rowIndex * DAY_MS);
        const value = isoDate(date);
        const day = days.find((entry) => entry.date === value);
        if (!day) return emptyDay(value);
        const count = Math.max(0, Number(day.contributionCount) || 0);
        return {
          date: value,
          contributionCount: count,
          contributionLevel: LEVELS[day.contributionLevel] === undefined
            ? levelForCount(count)
            : day.contributionLevel,
        };
      }),
    };
  });

  if (weeks.length > 53) weeks = weeks.slice(-53);
  if (weeks.length < 53) {
    const missing = 53 - weeks.length;
    const firstDate = parseDate(weeks[0].contributionDays[0].date);
    const padding = Array.from({ length: missing }, (_, weekIndex) => {
      const weekStart = new Date(firstDate.getTime() - (missing - weekIndex) * 7 * DAY_MS);
      return {
        contributionDays: Array.from({ length: 7 }, (_, rowIndex) =>
          emptyDay(isoDate(new Date(weekStart.getTime() + rowIndex * DAY_MS))),
        ),
      };
    });
    weeks = [...padding, ...weeks];
  }

  const calculatedTotal = weeks.reduce(
    (total, week) => total + week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0),
    0,
  );

  return {
    username,
    source,
    totalContributions: Number.isFinite(Number(calendar.totalContributions))
      ? Number(calendar.totalContributions)
      : calculatedTotal,
    weeks,
  };
}

export async function fetchContributions({
  username = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "nitish-niraj",
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  mock = false,
  fetchImpl = fetch,
} = {}) {
  const login = String(username).trim();
  if (!login) throw new Error("GITHUB_USERNAME is required.");

  const accessToken = String(token ?? "").trim();
  if (mock || !accessToken) return createMockCalendar(login);

  const response = await fetchImpl(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "gta-drift-contribution-graph",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
  }

  const result = await response.json();
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }

  const calendar = result.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error(`GitHub user not found or contribution data unavailable: ${login}`);

  return normalizeCalendar(calendar, login, "live");
}
