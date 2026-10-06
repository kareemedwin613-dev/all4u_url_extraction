// Matches an intended answer to the option a job form offers ("US" vs "United States of America",
// "CA" vs "California", "No" vs "I am not a protected veteran", 8 years vs "5-10 years").
const US_STATES = Object.freeze({
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
});
const STATE_BY_NAME = Object.freeze(Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name, code])));
const UNITED_STATES = ["united states", "united states of america", "usa", "us", "america"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const GENDERS = Object.freeze({
  male: ["male", "man", "he him"], female: ["female", "woman", "she her"],
  non_binary: ["non binary", "nonbinary", "non binary genderqueer", "they them"],
});
const WORK_ARRANGEMENTS = Object.freeze({
  remote: ["remote", "fully remote", "100 remote"], hybrid: ["hybrid"], onsite: ["onsite", "on site", "in office", "in person"],
  flexible: ["flexible", "either", "any"], no_preference: ["no preference", "none"],
});

export function normalizeOptionText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase()
    .replace(/\bu\.\s?s\.\s?a\.?/g, "usa").replace(/\bu\.\s?s\.?(?=\s|$|,)/g, "us")
    .replace(/[^\p{L}\p{N}%]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function usStateCode(value) {
  const text = normalizeOptionText(value);
  if (US_STATES[text.toUpperCase()]) return text.toUpperCase();
  return STATE_BY_NAME[text] || "";
}

export function isUnitedStates(value) { return UNITED_STATES.includes(normalizeOptionText(value)); }

export function monthName(month) { return MONTHS[Number(month) - 1] || ""; }

// Every normalized spelling that should count as the wanted value.
export function valueAliases(value) {
  if (typeof value === "boolean") return value ? ["yes", "true"] : ["no", "false"];
  const text = normalizeOptionText(value);
  if (!text) return [];
  const aliases = new Set([text]);
  if (isUnitedStates(text)) UNITED_STATES.forEach((item) => aliases.add(item));
  // Only an uppercase two-letter code or a full name is a state; "or" and "in" are ordinary words.
  const raw = String(value ?? "").trim();
  const state = /^[A-Z]{2}$/.test(raw) ? usStateCode(raw) : STATE_BY_NAME[text] || "";
  if (state) { aliases.add(state.toLowerCase()); aliases.add(US_STATES[state]); }
  const gender = GENDERS[text.replaceAll(" ", "_")] || Object.values(GENDERS).find((list) => list.includes(text));
  gender?.forEach((item) => aliases.add(item));
  const arrangement = WORK_ARRANGEMENTS[text.replaceAll(" ", "_")];
  arrangement?.forEach((item) => aliases.add(item));
  const month = MONTHS.indexOf(text);
  if (month >= 0) { aliases.add(String(month + 1)); aliases.add(String(month + 1).padStart(2, "0")); aliases.add(text.slice(0, 3)); }
  return [...aliases];
}

// Month selects show "06", "6", "June", or "Jun"; callers pass the month number.
export function monthAliases(month) {
  const number = Number(month);
  if (!Number.isInteger(number) || number < 1 || number > 12) return [];
  const name = MONTHS[number - 1];
  return [String(number), String(number).padStart(2, "0"), name, name.slice(0, 3)];
}

export function optionPolarity(value) {
  const text = normalizeOptionText(value);
  if (!text) return null;
  if (/\b(decline|prefer not|don t wish|do not wish|choose not|not to (?:answer|disclose|say)|rather not)\b/.test(text)) return "decline";
  if (/^(no|false|n)$/.test(text) || /^no\b/.test(text) || /\b(i am not|i m not|not a|not an|none|never)\b/.test(text)) return "no";
  if (/^(yes|true|y)$/.test(text) || /^yes\b/.test(text) || /^i (?:am|have|identify|do|can|will|consent|agree)\b/.test(text)) return "yes";
  return null;
}

function wantedPolarity(value) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = normalizeOptionText(value);
  return text === "yes" || text === "true" ? "yes" : text === "no" || text === "false" ? "no" : null;
}

function numberOf(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// "5-10 years" → {min:5,max:10}; "10+" → {min:10,max:∞}; "Less than 1" → {min:-∞,max:1}.
export function numericRange(value) {
  const text = String(value ?? "").toLowerCase().replace(/,/g, "");
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (!numbers.length) return /\bnone\b/.test(text) ? { min: 0, max: 0 } : null;
  if (/(less than|under|below|fewer than|up to)/.test(text)) return { min: -Infinity, max: numbers[0] };
  if (/\+|or more|and above|and up|more than|over|at least/.test(text)) return { min: numbers[0], max: Infinity };
  if (numbers.length >= 2 && /(\d)\s*(?:-|–|—|to)\s*\d/.test(text)) return { min: numbers[0], max: numbers[1] };
  return { min: numbers[0], max: numbers[0] };
}

// Lower tier is a stronger match; null means no match.
export function optionMatchTier(optionText, wanted) {
  const option = normalizeOptionText(optionText);
  if (!option) return null;
  const aliases = valueAliases(wanted);
  if (aliases.includes(option)) return 0;
  const polarity = wantedPolarity(wanted);
  if (polarity) return optionPolarity(option) === polarity ? 1 : null;
  if (aliases.some((alias) => alias.length >= 2 && option.startsWith(`${alias} `))) return 2;
  const number = typeof wanted === "number" ? wanted : /^\$?\s*-?\d[\d,]*(\.\d+)?\s*%?$/.test(String(wanted ?? "").trim()) ? numberOf(wanted) : null;
  if (number !== null) {
    const range = numericRange(optionText);
    if (range && number >= range.min && number <= range.max) return range.min === range.max ? 1 : 3;
    return null;
  }
  if (aliases.some((alias) => alias.length >= 4 && new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(option))) return 4;
  return null;
}

// Picks the best option; ties keep page order. getTexts returns the strings to compare for an option.
export function findBestOption(options, wanted, getTexts) {
  let best = null;
  for (const option of options || []) {
    const tiers = getTexts(option).map((text) => optionMatchTier(text, wanted)).filter((tier) => tier !== null);
    if (!tiers.length) continue;
    const tier = Math.min(...tiers);
    if (!best || tier < best.tier) best = { option, tier };
  }
  return best?.option || null;
}
