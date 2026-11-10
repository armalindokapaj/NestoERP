import { cache } from "react";
import { cookies } from "next/headers";

import { LOOK_COOKIE, readLook, type Look } from "./look-state";

/** The look of this request, read once; the root layout renders it onto <html>. */
export const getLook = cache(async (): Promise<Look> => readLook((await cookies()).get(LOOK_COOKIE)?.value));
