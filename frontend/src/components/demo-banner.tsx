'use client';

/**
 * True unless the build was explicitly pointed at the real backend.
 * Mirrors DEMO_MODE in next.config.mjs so the UI can label itself honestly.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

/** Thin strip that tells a viewer this build is a demo with sample data. */
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-[0.75rem] text-warning">
      Demo mode — sample data only. Nothing you do here is saved. Signed PDFs and file exports are simplified.
    </div>
  );
}
