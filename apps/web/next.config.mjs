/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@rave-run/core", "@rave-run/providers", "@rave-run/db"],
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};
export default nextConfig;
