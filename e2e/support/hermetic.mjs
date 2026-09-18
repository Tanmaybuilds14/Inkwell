/**
 * Make a browser test hermetic.
 *
 * Signed-out behaviour is the app's own contract, but Clerk's browser SDK is
 * fetched from the vendor's frontend API on every page load. In CI the
 * configured key is a format-valid placeholder pointing at a host that does
 * not exist, so those requests hang until the test times out; and even with a
 * real key the suite would depend on a third party being up and fast.
 *
 * Aborting them keeps `isSignedIn` undefined — which is what an anonymous
 * visitor is — and makes every assertion below about this codebase only.
 */
const THIRD_PARTY_AUTH = [
  '**/*.clerk.accounts.dev/**',
  '**clerk.example.com/**',
  '**clerk.com/v1/**',
];

export async function blockExternalAuth(page) {
  for (const pattern of THIRD_PARTY_AUTH) {
    await page.route(pattern, (route) => route.abort());
  }
}
