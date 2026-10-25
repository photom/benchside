// The worker check leaves out vite/client (it brings DOM types), so it declares
// the one Vite import form the worker's code uses: the bundled PSL snapshot.
declare module '*?raw' {
  const text: string;
  export default text;
}
