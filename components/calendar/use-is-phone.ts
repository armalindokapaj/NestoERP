"use client";

import * as React from "react";

/** True below the `md` breakpoint (PRD #39 §28): phones get sheets and Agenda first. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
