import type { StorybookConfig } from '@storybook/angular';

/**
 * Storybook for storybook.projectsites.dev — the permanently-hosted component
 * workshop and single source of truth for the projectsites pipeline
 * (storybook → template → generator). Stories live beside their components
 * under src/app/components/**. Owned Spartan/Angular components only.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: '@storybook/angular',
};
export default config;
