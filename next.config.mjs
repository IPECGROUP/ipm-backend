/** @type {import('next').NextConfig} */
// Must match the API validation limit. Never leave an unbounded request body
// in front of routes that parse multipart form data.
const MAX_UPLOAD_BODY_BYTES = 25 * 1024 * 1024;

const nextConfig = {
  reactCompiler: true,
  experimental: {
    proxyClientMaxBodySize: MAX_UPLOAD_BODY_BYTES,
    serverActions: {
      bodySizeLimit: MAX_UPLOAD_BODY_BYTES,
    },
  },
};

export default nextConfig;
