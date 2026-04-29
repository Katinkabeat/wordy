import sqPreset from '../rae-side-quest/packages/sq-ui/tailwind-preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [sqPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../rae-side-quest/packages/sq-ui/**/*.{js,jsx}',
  ],
};
