"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type AdSenseUnitProps = {
  clientId: string;
  slotId: string;
};

/**
 * A deliberately manual, responsive display-ad placement.
 * The component is omitted entirely unless both public AdSense IDs are configured.
 */
export default function AdSenseUnit({ clientId, slotId }: AdSenseUnitProps) {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      pushed.current = true;
    } catch (error) {
      // Ad blockers, review status, or a network failure must not affect the library.
      console.warn("AdSense slot could not be initialised.", error);
    }
  }, []);

  return (
    <aside className="adPlacement" aria-label="Advertisement">
      <span className="adLabel">Advertisement</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block", minHeight: "90px" }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
