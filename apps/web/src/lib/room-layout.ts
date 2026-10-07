/**
 * How the campaign screen shares a desktop's width (Tailwind's `lg` and up) between the map and the
 * columns beside it. Phones and narrow tablets have their own layout: the map with a bottom sheet,
 * and tabs along the bottom.
 */

/** The left column: the lobby, draft or war room, the missions and diplomacy. */
export const CAMPAIGN_WIDTH = 340;
/** The right column: the selected country or war, or the player's empire. */
export const DETAILS_WIDTH = 360;
/** The left column folded into a strip of section buttons, which open it over the map. */
export const RAIL_WIDTH = 64;
/** The narrowest the map gets beside two open columns: room to plan, and for its controls. */
export const MAP_MIN = 600;
/** The narrowest the map gets beside a game, which comes first while it's open. */
export const MAP_MIN_BESIDE_GAME = 360;
/** A game's column: as wide as the board can be while it and both clocks fit the room's height. */
export const GAME_MIN = 420;
export const GAME_MAX = 680;
/**
 * The game panel's height besides the board (padding, heading, the player strips and the gaps
 * between them), less its side padding, which the board's width leaves out.
 */
export const GAME_CHROME = 178;

export interface RoomLayout {
  /**
   * The left column stays open beside the map. Otherwise it folds into the rail, and opens over the
   * map as a drawer.
   */
  campaignColumn: boolean;
  /** Width of the right column: wider while a game is open, so the board can fill the height. */
  detailsWidth: number;
}

/**
 * Three columns only while the map keeps `MAP_MIN` beside them. A game takes the width the board
 * needs to fill the room's height, so the left column folds first, then the map gives way down to
 * `MAP_MIN_BESIDE_GAME`. `width` and `height` are the room's, under the header.
 */
export function roomLayout(width: number, height: number, game: boolean): RoomLayout {
  const gameWidth = Math.max(
    GAME_MIN,
    Math.min(GAME_MAX, height - GAME_CHROME, width - RAIL_WIDTH - MAP_MIN_BESIDE_GAME),
  );
  const detailsWidth = game ? Math.round(gameWidth) : DETAILS_WIDTH;
  return { campaignColumn: width - CAMPAIGN_WIDTH - detailsWidth >= MAP_MIN, detailsWidth };
}
