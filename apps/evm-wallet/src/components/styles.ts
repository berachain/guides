/**
 * Shared NativeWind class strings for consistent UI across screens.
 * Kept as string constants (not components) so screens can compose them
 * naturally into `className`.
 */

export const PRIMARY_BUTTON =
  "bg-neutral-900 px-6 py-4 rounded-xl items-center active:bg-neutral-800";
export const PRIMARY_BUTTON_DISABLED =
  "bg-neutral-400 px-6 py-4 rounded-xl items-center";
export const PRIMARY_BUTTON_TEXT = "text-white font-semibold text-base";

export const SECONDARY_BUTTON =
  "border border-neutral-300 px-6 py-4 rounded-xl items-center active:bg-neutral-100";
export const SECONDARY_BUTTON_TEXT = "text-neutral-700 font-medium text-base";

export const DESTRUCTIVE_BUTTON =
  "bg-red-600 px-6 py-4 rounded-xl items-center active:bg-red-700";
export const DESTRUCTIVE_BUTTON_DISABLED =
  "bg-red-300 px-6 py-4 rounded-xl items-center";
export const DESTRUCTIVE_BUTTON_TEXT = "text-white font-semibold text-base";

export const WARNING_CALLOUT = "bg-red-50 border border-red-200 p-4 rounded-lg";
export const WARNING_CALLOUT_TEXT = "text-red-900 text-sm leading-5";

export const SCREEN_PADDING = "px-6 py-6";
