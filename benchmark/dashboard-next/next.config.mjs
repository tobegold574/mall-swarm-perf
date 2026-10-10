/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === "1";
const nextConfig = {
  reactStrictMode: true,
  // GitHub Pages 静态导出: NEXT_EXPORT=1 npm run build (需挂载 results 至 /data 供路由在构建期取数)
  ...(isExport
    ? {
        output: "export",
        basePath: "/mall-swarm-perf",
        assetPrefix: "/mall-swarm-perf",
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
