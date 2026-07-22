/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // El compositor del chat sube fotos por Server Action; el default (1 MB) rebota
    // cualquier foto tomada con el celular. Ver ADR-0075.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
