import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { EditorBootLoader } from '~/components/chat/EditorBootLoader';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { isEmbedded } from '~/lib/embed/embedded-mode';

export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

export const loader = () => json({});

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 *
 * In embedded mode (iframe inside projectsites.dev), the header and background
 * are hidden to maximize editor space. Communication happens via postMessage.
 */
export default function Index() {
  return (
    <div
      className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1"
      style={isEmbedded ? ({ '--header-height': '0px' } as React.CSSProperties) : undefined}
    >
      {!isEmbedded && <BackgroundRays />}
      {!isEmbedded && <Header />}
      {/*
       * Pre-hydration fallback: in embedded mode show the theme-matched boot
       * loader (never the raw chat UI) so the "What are we shipping?" textarea
       * doesn't flash before the client `Chat` mounts + the history hydrates.
       * Standalone bolt keeps its original BaseChat fallback.
       */}
      <ClientOnly fallback={isEmbedded ? <EditorBootLoader /> : <BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
