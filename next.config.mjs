/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  experimental: {
    proxyClientMaxBodySize: "512mb",
    serverActions: {
      bodySizeLimit: "512mb",
    },
  },
};

export default nextConfig;
