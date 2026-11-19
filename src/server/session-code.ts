/**
 * Session codes: two short words and a number, like "otter-maple-42". Easy to read out in a
 * room. A code identifies a session; it is not a secret.
 */
const FIRST = [
  "amber",
  "brave",
  "brisk",
  "calm",
  "clever",
  "cosy",
  "crisp",
  "daring",
  "eager",
  "fancy",
  "gentle",
  "glad",
  "golden",
  "grand",
  "happy",
  "honest",
  "jolly",
  "keen",
  "kind",
  "lively",
  "lucky",
  "merry",
  "mighty",
  "misty",
  "noble",
  "plucky",
  "proud",
  "quick",
  "quiet",
  "rapid",
  "shiny",
  "silver",
  "sleepy",
  "snowy",
  "sunny",
  "swift",
  "tidy",
  "witty",
  "young",
  "zesty",
];
const SECOND = [
  "otter",
  "maple",
  "badger",
  "beaver",
  "birch",
  "castle",
  "cedar",
  "comet",
  "falcon",
  "fjord",
  "garden",
  "harbor",
  "heron",
  "island",
  "lantern",
  "meadow",
  "moose",
  "orchid",
  "pebble",
  "pine",
  "planet",
  "puffin",
  "rabbit",
  "raven",
  "river",
  "rocket",
  "salmon",
  "spruce",
  "squid",
  "stone",
  "tower",
  "tulip",
  "turtle",
  "valley",
  "walrus",
  "willow",
  "wombat",
  "yak",
  "zebra",
];

const CODE = /^[a-z]{3,7}-[a-z]{3,7}-\d{2}$/;

export function newSessionCode(random: () => number = Math.random): string {
  const pick = (words: string[]) => words[Math.floor(random() * words.length)] ?? words[0];
  const n = 10 + Math.floor(random() * 90);
  return `${pick(FIRST)}-${pick(SECOND)}-${n}`;
}

export function isSessionCode(s: string): boolean {
  return CODE.test(s);
}
