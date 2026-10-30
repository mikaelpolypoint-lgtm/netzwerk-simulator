/** Version aus package.json, beim Bauen von Vite eingesetzt. */
declare const __APP_VERSION__: string;

declare module '*.svg?raw' {
  const content: string;
  export default content;
}
