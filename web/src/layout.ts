// Phone layout: narrow screens, and touch screens held in landscape (short). Full-screen
// map, estimate bar at the top, floating buttons, full-screen filters, camera sheet at the
// bottom. Keep in sync with the media query in style.css.
export const PHONE_QUERY = "(max-width: 600px), (pointer: coarse) and (max-height: 500px)";
export const LANDSCAPE_QUERY = "(pointer: coarse) and (max-height: 500px)";
export const isPhone = (): boolean => window.matchMedia(PHONE_QUERY).matches;
export const isLandscapePhone = (): boolean => window.matchMedia(LANDSCAPE_QUERY).matches;
/** Height actually visible: Safari's toolbars come and go. */
export const visibleHeight = (): number => window.visualViewport?.height ?? window.innerHeight;
