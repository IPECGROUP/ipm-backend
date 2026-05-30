/** @type {import('next').NextConfig} */
const NO_UPLOAD_BODY_LIMIT = Number.MAX_SAFE_INTEGER;

const nextConfig = {
  reactCompiler: true,
  experimental: {
    proxyClientMaxBodySize: NO_UPLOAD_BODY_LIMIT,
    serverActions: {
      bodySizeLimit: NO_UPLOAD_BODY_LIMIT,
    },
  },
};

export default nextConfig;
