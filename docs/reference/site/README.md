# Site-wide UI specification

Exact behavior shared by every benchside page. Why: [REQ-SITE-001](../../explanation/requirements/REQ-SITE-001-one-look.md). How it is built: [UI design system](../../explanation/ui-design-system.md).

Each rule has an ID (for example `SITE-3`). Test scenarios cite these IDs.

## Header

| ID | Rule |
|---|---|
| SITE-1 | Every tool page starts with a header. It holds, in order: a link with the text `benchside` to `../` (home), the tool's name as the page's only `h1`, and the tool's privacy line (SITE-2). Lines specific to the tool may follow the privacy line. |
| SITE-2 | The privacy line of each tool is the text below. It states what leaves the browser, opt-in features included ([privacy model](../../explanation/privacy-model.md)). |

| Tool | Privacy line |
|---|---|
| Mail | Your message stays in this browser. Only DNS lookups of domain names go out, over DNS-over-HTTPS. |
| ZIP | Your file stays in this browser. This page cannot connect anywhere. |
| PDF | Your file stays in this browser. This page cannot connect anywhere. |
| DMARC aggregate | Your files never leave this browser. If you turn on host-name lookup, source IP addresses go to the DNS provider you pick. |

## Home

| ID | Rule |
|---|---|
| SITE-3 | Home lists every tool as a card: the tool's name as a link to the tool, then one sentence on what it does. |

## Color and contrast

| ID | Rule |
|---|---|
| SITE-4 | Every page follows `prefers-color-scheme`: the light theme by default, the dark theme when the system asks for dark. |
| SITE-5 | In both themes, against the page surface: text colors reach 4.5:1, control borders and the focus ring reach 3:1 (WCAG 1.4.3, 1.4.11). Status color always sits beside a word that names the status (WCAG 1.4.1). |

## Keyboard and targets

| ID | Rule |
|---|---|
| SITE-6 | Every control is reachable with Tab and shows a 2 px focus ring in the accent color while it has keyboard focus (WCAG 2.1.1, 2.4.7). A label styled as a button shows the ring while its file input has focus. |
| SITE-7 | Buttons and fields are at least 24 px tall. Link-like buttons inside table rows or sentences, and check boxes inside their label, use the inline and label exceptions of WCAG 2.5.8. |
| SITE-10 | A control's accessible name contains the words shown on it, in the same order, so speech users can say what they see (WCAG 2.5.3). It may add words, such as a unit, after them. |

## Tables

| ID | Rule |
|---|---|
| SITE-9 | A table cell wraps between words and never splits a word, except a cell that holds one long token (a file name, a domain name, a finding ID), which may break anywhere. Dates and times never break. A table wider than the page scrolls sideways inside its own area; the page itself never scrolls sideways. While the table is wider than that area, the area takes keyboard focus and is a region named after the table; when the table fits, it is neither (WCAG 1.4.10, 2.1.1). |

## Resources

| ID | Rule |
|---|---|
| SITE-8 | Pages load fonts and styles from their own origin only: system fonts, bundled CSS. Styling uses classes and attributes, never `style` attributes (CSP). |
