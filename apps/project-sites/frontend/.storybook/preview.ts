import type { Preview } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import { setCompodocJson } from '@storybook/addon-docs/angular';
import docJson from '../documentation.json';
setCompodocJson(docJson);

/**
 * Dark-first brand canvas. Global styles (tailwind.css + styles.scss) are loaded
 * via the Angular build target, so the --ps-* design tokens resolve here exactly
 * as they do in the generator. Every story renders on the projectsites canvas.
 */
const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'projectsites',
      values: [
        { name: 'projectsites', value: '#060610' },
        { name: 'light', value: '#ffffff' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'todo' },
  },
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div style="padding:2.5rem;min-height:55vh;color:var(--ps-ink,#f4f4ff);font-family:var(--ps-font-sans,'Sora',system-ui,sans-serif);background:var(--ps-bg,#060610)">${story}</div>`,
    ),
  ],
};

export default preview;
