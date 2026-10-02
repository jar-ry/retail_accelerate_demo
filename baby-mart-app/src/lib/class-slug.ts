// ─── URL-safe hierarchy names ─────────────────────────────────────────────────
//
// A merchandise class can contain a forward slash. No class in the CURRENT
// hierarchy does -- this was written for DECOR WALL/DIY, since replaced -- but
// the guard stays, because that single character makes a node unreachable
// through every route in the app and percent-encoding does NOT save you. The
// failure is silent until someone adds a class with a slash in it, which is
// exactly when nobody will remember this.
//
// What actually happened to /planning/mfp/HOME%20FURNISHINGS/DECOR%20WALL%2FDIY:
// the request is answered with a 3xx whose Location has the %2F decoded to a
// literal "/". The browser follows it, Next.js now sees THREE path segments where
// the route declares two ([dept]/[class]), and returns 404. The same happens to
// /api/planning/grid/... , so the data call fails too. Verified empirically: the
// anchor's href attribute is correctly encoded as %2F and it still 404s, while
// every slash-free class in the same department loads. PRAMS & STROLLERS is fine
// because %26 is not path-significant and survives the round trip.
//
// So the slash must never enter a path segment. These two functions swap it for a
// sentinel on the way out and restore it on the way in. "~" is chosen because it
// is an unreserved character in RFC 3986 -- it needs no encoding, survives
// normalization untouched, and stays readable in the address bar
// (DECOR%20WALL~DIY). No class or department name in the hierarchy contains it.
//
// USE THESE AT EVERY ROUTE BOUNDARY. A link built with a bare
// encodeURIComponent(className) will 404 again the moment the name has a slash in
// it, and the failure is invisible until someone clicks that one class.

/** Sentinel standing in for "/" inside a single path segment. */
const SLASH = "~";

/** Encode a hierarchy name for use as one URL path segment.
 *  Replaces "/" before percent-encoding, so the slash cannot be mistaken for a
 *  segment separator by anything between the browser and the route matcher. */
export function toPathSegment(name: string): string {
  return encodeURIComponent(name.replace(/\//g, SLASH));
}

/** Restore a hierarchy name from a route param.
 *  Next.js has already percent-decoded the param, so only the sentinel is left
 *  to undo. Safe to call on names that never contained a slash. */
export function fromPathSegment(segment: string): string {
  return decodeURIComponent(segment).replace(new RegExp(SLASH, "g"), "/");
}
