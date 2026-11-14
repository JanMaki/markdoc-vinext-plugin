/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vinext は pageExtensions をルート探索に使う。変換は vite.config.ts の markdoc() が行う。
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdoc'],
};

export default nextConfig;
