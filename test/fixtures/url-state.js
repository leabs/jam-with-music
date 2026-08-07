export const INSTRUMENTS = [
  "kick",
  "snare",
  "hi_hat",
  "clap",
  "rattle",
  "tom",
  "ring",
  "undertaker",
  "hit",
  "huh",
  "itemdrop",
  "codex",
  "exclamation",
  "thatnoise",
];

export const V4_SONG = {
  encoded:
    "eyJ2Ijo0LCJwIjpbImdBRkFBaUFFRUFnSUVBUWdBa0FCZ1A4QUFQK3FWVldxRC9Ed0R3PT0iLCJBUUFDQUFRQUNBQVFBQ0FBUUFDQUFBQUJBQUlBQkFBSUFCQUFJQT09Il0sInIiOlsyLDVdLCJtIjpbMTAwLDkwLDgwLDcwLDYwLDUwLDQwLDMwLDIwLDEwLDAsMzAsNjAsOTBdLCJ0IjpbeyJraWNrIjoiMDo3LDE1Oi03Iiwic25hcmUiOiI0OjMifSx7ImhpX2hhdCI6IjE6LTIiLCJjbGFwIjoiODo1In1dfQ==",
  patterns: [
    [
      128, 1, 64, 2, 32, 4, 16, 8, 8, 16, 4, 32, 2, 64, 1, 128, 255, 0, 0,
      255, 170, 85, 85, 170, 15, 240, 240, 15,
    ],
    [
      1, 0, 2, 0, 4, 0, 8, 0, 16, 0, 32, 0, 64, 0, 128, 0, 0, 1, 0, 2,
      0, 4, 0, 8, 0, 16, 0, 32,
    ],
  ],
  repeats: [2, 5],
  mix: [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0, 30, 60, 90],
  pitch: [
    { kick: { 0: 7, 15: -7 }, snare: { 4: 3 } },
    { hi_hat: { 1: -2 }, clap: { 8: 5 } },
  ],
};

export const V5_FILTER_SONG = {
  encoded:
    "eyJ2Ijo1LCJwIjpbImdBRkFBaUFFRUFnSUVBUWdBa0FCZ1A4QUFQK3FWVldxRC9Ed0R3PT0iLCJBUUFDQUFRQUNBQVFBQ0FBUUFDQUFBQUJBQUlBQkFBSUFCQUFJQT09Il0sInIiOlsyLDVdLCJtIjpbMTAwLDkwLDgwLDcwLDYwLDUwLDQwLDMwLDIwLDEwLDAsMzAsNjAsOTBdLCJ0IjpbeyJraWNrIjoiMDo3LDE1Oi03Iiwic25hcmUiOiI0OjMifSx7ImhpX2hhdCI6IjE6LTIiLCJjbGFwIjoiODo1In1dLCJmIjp7InYiOjEsImUiOjEsImMiOjY4LCJyIjoxOCwiZCI6MTQsIm0iOjc4LCJwIjoid2FybSJ9fQ==",
  filter: {
    enabled: true,
    cutoff: 68,
    resonance: 18,
    drive: 14,
    mix: 78,
    preset: "warm",
  },
};

export const LEGACY_PATTERN = {
  bpm: "139",
  encoded: "gCAIAIiIAAgAAAAA",
  sourceBytes: [128, 32, 8, 0, 136, 136, 0, 8, 0, 0, 0, 0],
};

export const MALFORMED_SONGS = {
  invalidBase64: "%%%",
  emptyPatterns: "eyJ2Ijo0LCJwIjpbXX0=",
  invalidPatternsOnly: "eyJ2Ijo0LCJwIjpbIiUlJSJdfQ==",
  misalignedMetadata:
    "eyJ2Ijo0LCJwIjpbIiUlJSIsIkFRQUNBQVFBQ0FBUUFDQUFRQUNBQUFBQkFBSUFCQUFJQUJBQUlBPT0iXSwiciI6WzksMl0sIm0iOlsxMDBdLCJ0IjpbeyJraWNrIjoiMDo3In0seyJraWNrIjoiMTotMyJ9XX0=",
};

export const BPM_QUERY_CASES = [
  { label: "below minimum", value: "-1", expected: "40" },
  { label: "zero", value: "0", expected: "40" },
  { label: "minimum", value: "40", expected: "40" },
  { label: "maximum", value: "300", expected: "300" },
  { label: "above maximum", value: "301", expected: "300" },
  { label: "huge", value: "100000000000000000000", expected: "300" },
  { label: "empty", value: "", expected: "120" },
  { label: "nonnumeric", value: "fast", expected: "120" },
];
