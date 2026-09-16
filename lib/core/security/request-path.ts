/**
 * The path and query a page was requested with, as a request header
 * (E-05A §34).
 *
 * A server component cannot read its own URL. The one that needs to is the
 * project loader: a deep link into another company's project goes through the
 * open step and must come back to the tab that was asked for, not the overview.
 *
 * Middleware sets it on every page request and overwrites whatever a client
 * sent, so it is the path the server routed — and the open page still accepts
 * only a destination inside the project being opened.
 */
export const REQUEST_PATH_HEADER = "x-nesto-request-path";
