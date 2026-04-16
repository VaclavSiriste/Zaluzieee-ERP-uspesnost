/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    ERP_DB_CONNECTION_STRING: process.env.ERP_DB_CONNECTION_STRING,
    ERP_DB_CA_CERT: process.env.ERP_DB_CA_CERT,
  },
}

module.exports = nextConfig
