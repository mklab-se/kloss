/**
 * The kloss data model, shared by the server and the browser (no DOM or server APIs here).
 */

/** `<w>x<d>`: w pluppar along x, d along y. The size carries the orientation. */
export type Size = "1x1" | "1x2" | "2x1" | "1x4" | "4x1" | "2x2" | "2x4" | "4x2";

export type ColorName =
  | "white"
  | "gray"
  | "black"
  | "red"
  | "orange"
  | "yellow"
  | "lime"
  | "green"
  | "blue"
  | "azure"
  | "purple"
  | "pink"
  | "brown"
  | "tan";

/** One drop: a kloss of a size and color whose corner with the smallest coordinates is at x,y. */
export interface KlossInput {
  size: Size;
  color: ColorName;
  x: number;
  y: number;
}

/** A dropped kloss and where it landed. Level 0 sits on the floor. */
export interface PlacedKloss extends KlossInput {
  index: number;
  level: number;
  /** Who dropped it (an e-mail address), when login is on. Never written to .kl. */
  by?: string;
}

/** Units: 1 = the spacing between pluppar. */
export const KLOSS_HEIGHT = 1.2;
/** One third of a kloss's height. */
export const PLUPP_HEIGHT = 0.4;
export const PLUPP_ARM_LENGTH = 0.6;
export const PLUPP_ARM_WIDTH = 0.22;

/** Positions are whole numbers within -COORD_LIMIT..COORD_LIMIT. */
export const COORD_LIMIT = 10_000;
export const MAX_KLOSSAR = 10_000;
export const MAX_BODY_BYTES = 1_000_000;
