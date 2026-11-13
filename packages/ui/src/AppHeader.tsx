import type { ComponentChildren } from 'preact';

/** The top of every tool page (0018): a link home, the title, and what leaves the browser. */
export function AppHeader({
  title,
  privacy,
  children,
}: {
  title: string;
  privacy: string;
  children?: ComponentChildren;
}) {
  return (
    <header class="app-header">
      <a class="home" href="../">
        benchside
      </a>
      <h1>{title}</h1>
      <p class="privacy">{privacy}</p>
      {children}
    </header>
  );
}
