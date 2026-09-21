"use client";

import { useEffect } from "react";

/**
 * A ?focus= deep link is only meant to choose the affair once when Commercial opens.
 * Keeping it in the URL makes useSearchParams keep re-applying the same selection,
 * which prevents the user from clicking another affair. Remove it as soon as the
 * detail pane has mounted, while keeping any other query parameters intact.
 */
export function CommercialFocusRelease() {
  useEffect(() => {
    const releaseFocus = () => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("focus")) return true;
      if (!document.querySelector(".commercialV2DetailHeader, .commercialDetailHeader"))
        return false;

      url.searchParams.delete("focus");
      const query = url.searchParams.toString();
      const nextUrl = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
      window.history.replaceState(window.history.state, "", nextUrl);
      return true;
    };

    if (releaseFocus()) return;

    const observer = new MutationObserver(() => {
      if (releaseFocus()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(() => observer.disconnect(), 10_000);

    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, []);

  return null;
}
