---
title: Imported Markdoc component
---

# {% $markdoc.frontmatter.title %}

This file is **not** under `app/` or `pages/`, so the plugin treats it as an
imported component: no `getStaticProps`, no `metadata` export, and
`getMarkdocData()` is called synchronously inside the default export
(same as the official loader's "import as frontend component" path).

{% callout type="warn" %}
Imported as a component, not as a route.
{% /callout %}
