/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_BUCKET_PUBLIC_BASE_URL?: string;
  readonly VITE_ENABLE_DEMO_WORKSPACE?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'qr-scanner/qr-scanner-worker.min.js?url' {
  const src: string;
  export default src;
}
