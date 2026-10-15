import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Para poder probar desde el celular: `next dev -H 0.0.0.0` deja el server
  // escuchando en la red local, pero Next igual bloquea sus recursos de
  // desarrollo (HMR, chunks) cuando el navegador entra por una IP que no es
  // localhost, y entonces la página se ve pero el JavaScript no engancha y
  // ningún botón responde.
  //
  // Se toma de una variable de entorno para no dejar la IP de una máquina
  // hardcodeada en el repo: en .env.local va, por ejemplo,
  // DEV_ORIGEN_LAN=192.168.1.90 (la IP cambia según la red). Solo afecta al
  // server de desarrollo; en Vercel no se usa.
  // Sin la variable, la clave no se define: así en producción el config
  // queda exactamente como antes.
  ...(process.env.DEV_ORIGEN_LAN ? { allowedDevOrigins: [process.env.DEV_ORIGEN_LAN] } : {}),
};

export default nextConfig;
