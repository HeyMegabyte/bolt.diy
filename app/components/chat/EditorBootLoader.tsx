import { memo } from 'react';

/**
 * Cinematic full-surface boot loader for the embedded bolt.diy editor.
 *
 * Shown while the chat history is still hydrating (bolt.diy is booting the
 * WebContainer + about to run `npm start`). It covers the raw, half-mounted
 * chat UI — the "What are we shipping?" textarea and its siblings — so the
 * user never sees a flash of an un-ready editor.
 *
 * The background is locked to the parent shell's theme colour
 * (`--bolt-elements-bg-depth-1` === projectsites `--ps-bg` === `#060610`), so
 * there is zero colour flash between the admin cockpit and the iframe while it
 * loads. An animated cyan orbit + pulse (brand accent `#00e5ff`) reads as
 * "warming up" without slop.
 *
 * @remarks Reduced-motion safe — all animation is disabled under
 * `prefers-reduced-motion: reduce`, leaving a static, legible fallback.
 * Accessible — `role="status"` + `aria-label` announce the boot to AT.
 *
 * @example
 * {!ready && <EditorBootLoader />}
 */
export const EditorBootLoader = memo(function EditorBootLoader() {
  return (
    <div className="ps-boot-loader" role="status" aria-live="polite" aria-label="Booting your editor">
      {/* Animated orbit + pulsing core, brand cyan on near-black. */}
      <div className="ps-boot-loader__orbit" aria-hidden="true">
        <span className="ps-boot-loader__ring" />
        <span className="ps-boot-loader__ring ps-boot-loader__ring--2" />
        <span className="ps-boot-loader__core" />
      </div>
      <p className="ps-boot-loader__caption">Booting your editor…</p>
      <p className="ps-boot-loader__subcaption">Spinning up the workspace and dependencies</p>

      <style>{loaderStyles}</style>
    </div>
  );
});

/*
 * Styles are colocated + inlined so the loader is fully self-contained and can
 * never render before its CSS arrives (no flash of unstyled loader). All
 * colours are theme tokens with hard-coded fallbacks matching #060610 / #00e5ff
 * so the surface matches the outside shell even before the stylesheet loads.
 */
const loaderStyles = `
.ps-boot-loader {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
  /* Theme-matched dark cockpit bg — identical to the parent admin (#060610). */
  background:
    radial-gradient(120% 90% at 50% 30%, rgba(0, 229, 255, 0.06), transparent 60%),
    var(--bolt-elements-bg-depth-1, #060610);
  color: var(--bolt-elements-textPrimary, #f4f4ff);
  animation: ps-boot-loader-in 240ms ease-out both;
}

.ps-boot-loader__orbit {
  position: relative;
  width: 76px;
  height: 76px;
}

.ps-boot-loader__ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 2px solid transparent;
  border-top-color: var(--bolt-elements-borderColorActive, #00e5ff);
  border-right-color: rgba(0, 229, 255, 0.35);
  animation: ps-boot-spin 1.1s linear infinite;
}

.ps-boot-loader__ring--2 {
  inset: 12px;
  border-top-color: rgba(0, 229, 255, 0.45);
  border-right-color: transparent;
  border-left-color: rgba(124, 58, 237, 0.5);
  animation-duration: 1.7s;
  animation-direction: reverse;
}

.ps-boot-loader__core {
  position: absolute;
  inset: 28px;
  border-radius: 9999px;
  background: var(--bolt-elements-item-contentAccent, #00e5ff);
  box-shadow: 0 0 18px 2px rgba(0, 229, 255, 0.55);
  animation: ps-boot-pulse 1.4s ease-in-out infinite;
}

.ps-boot-loader__caption {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--bolt-elements-textPrimary, #f4f4ff);
}

.ps-boot-loader__subcaption {
  margin-top: -0.6rem;
  font-size: 0.8rem;
  color: var(--bolt-elements-textSecondary, rgba(244, 244, 255, 0.65));
}

@keyframes ps-boot-spin {
  to { transform: rotate(360deg); }
}

@keyframes ps-boot-pulse {
  0%, 100% { transform: scale(0.82); opacity: 0.85; }
  50% { transform: scale(1.08); opacity: 1; }
}

@keyframes ps-boot-loader-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Reduced-motion: kill every animation, keep a static, legible core. */
@media (prefers-reduced-motion: reduce) {
  .ps-boot-loader,
  .ps-boot-loader__ring,
  .ps-boot-loader__ring--2,
  .ps-boot-loader__core {
    animation: none !important;
  }

  .ps-boot-loader__core {
    inset: 24px;
    opacity: 1;
    transform: none;
  }

  .ps-boot-loader__ring {
    border-top-color: rgba(0, 229, 255, 0.5);
    border-right-color: rgba(0, 229, 255, 0.25);
  }
}
`;
