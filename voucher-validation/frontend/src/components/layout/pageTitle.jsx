// src/components/layout/pageTitle.jsx
//
// Which page you are on, said once.
//
// On a phone the app bar is always there and the sidebar is not, so the bar is
// where the name of the screen belongs — and it has to be the page's OWN name
// ("Nakavu", "September promo"), not the nav label of the route it sits under.
// A page publishes its title here through PageHeader; the shell reads it and
// falls back to the nav label when a page has nothing to say.
//
// Desktop is unaffected: the sidebar marks the section and the page keeps its
// heading, so the bar stays as it was.

import { createContext, useContext, useEffect } from "react";

export const PageTitleContext = createContext(null);

/** Tell the app bar what this screen is called. Cleared when the page leaves. */
export function usePublishPageTitle(title) {
  const publish = useContext(PageTitleContext);
  useEffect(() => {
    if (!publish) return undefined;
    publish(typeof title === "string" && title.trim() ? title.trim() : null);
    return () => publish(null);
  }, [publish, title]);
}
