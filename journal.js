// Parses an optional journal.txt placed alongside photos. Each entry begins
// with a date header on its own line (e.g. "August 7th"), followed by a block
// of text. The next date header delimits the next entry.

const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12
};

const MONTH_NAMES = Object.keys(MONTHS).join('|');
// "August 7th" / "Aug 7, 2024" / "August 7"
const MONTH_FIRST = new RegExp(`^(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?$`, 'i');
// "7th August" / "7 August 2024"
const DAY_FIRST = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})(?:\\s*,?\\s*(\\d{4}))?$`, 'i');

// Returns { month, day, year } (year may be null) or null if the line is not
// purely a date.
export function parseDateLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let month, day, year;
  const mf = trimmed.match(MONTH_FIRST);
  if (mf) {
    month = MONTHS[mf[1].toLowerCase()];
    day = parseInt(mf[2], 10);
    year = mf[3] ? parseInt(mf[3], 10) : null;
  } else {
    const df = trimmed.match(DAY_FIRST);
    if (!df) return null;
    day = parseInt(df[1], 10);
    month = MONTHS[df[2].toLowerCase()];
    year = df[3] ? parseInt(df[3], 10) : null;
  }

  if (day < 1 || day > 31) return null;
  return { month, day, year };
}

// Parses the full journal text into entries: { month, day, year, title, body }.
export function parseJournal(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  let current = null;

  for (const line of lines) {
    const date = parseDateLine(line);
    if (date) {
      if (current) entries.push(current);
      current = { ...date, title: line.trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
    // lines before the first date header are ignored
  }
  if (current) entries.push(current);

  return entries.map(({ bodyLines, ...rest }) => ({
    ...rest,
    body: bodyLines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
  })).filter((e) => e.body);
}
