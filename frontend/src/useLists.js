import { useState, useEffect } from "react";
import { api } from "./api";

// Read-only reference lists that many forms need for a <select>. Fetched once
// per mount; a failed fetch leaves the list empty rather than surfacing an
// error, because the form is still usable without it.
function useList(fetcher) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    fetcher().then(setItems).catch(() => setItems([]));
  }, [fetcher]);
  return items;
}

/** Every tutor in the practice — always offered, so staff can credit a
 *  payment (or assign a lesson) to anyone, not just someone this student
 *  happens to have a correctly-tagged lesson record with. Narrower,
 *  lesson-derived lists kept producing gaps: no completed lesson yet, no
 *  lesson at all yet, or a lesson that was simply never assigned a tutor —
 *  every one of them made the picker unusable right when it was needed. */
export function useTutors() {
  return useList(api.listTutors);
}

export function useSubjects() {
  return useList(api.listSubjects);
}
