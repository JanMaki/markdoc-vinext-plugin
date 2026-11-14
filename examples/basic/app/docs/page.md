---
title: App Router Markdoc page
description: Sample App Router page with frontmatter.nextjs metadata
nextjs:
  metadata:
    title: App Router Markdoc page
    description: Sample App Router page with frontmatter.nextjs metadata
  revalidate: 60
---

# {% $markdoc.frontmatter.title %}

{% callout type="info" %}
App Router 向けのサンプルです。`metadata` と `revalidate` は
`frontmatter.nextjs` から export されます。
{% /callout %}

The product variable is {% $product %}. Uppercased greeting: {% upper("hello") %}.

{% tag /%}

{% partial file="footer.md" /%}
