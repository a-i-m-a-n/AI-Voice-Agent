/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // edge-tts-universal uses the `ws` package, which relies on the native
  // `bufferutil` / `utf-8-validate` add-ons. Next.js's bundler breaks those
  // native modules if it tries to bundle them, causing
  // "bufferUtil.mask is not a function" at runtime. Keeping them external
  // makes Next.js use Node's native require for them instead.
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate", "edge-tts-universal"],
};

export default nextConfig;
